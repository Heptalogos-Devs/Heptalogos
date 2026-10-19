// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Headless product management composition; native execution is independently supervised.
 * @module host
 */
import { createCanonicalSchemaInitializer } from "@heptalogos/canonical-schema";
import {
  prepareBootstrapPrelude,
  loadBootstrapLocator,
  resolveBootstrapPathProfile,
  resolveRuntimeLocations,
  type BootstrapManagedHostContext,
} from "@heptalogos/bootstrap-runtime";
import { createPersistenceService } from "@heptalogos/persistence";
import {
  createExecutionContextRuntime,
  createExecutionLineageService,
  createPersistenceExecutionContextProvider,
  type ExecutionContext,
} from "@heptalogos/execution-lineage";
import { createEvidenceService } from "@heptalogos/evidence";
import { join } from "node:path";
import { createSystemTimeService } from "@heptalogos/time-service";
import { createConfigurationService } from "@heptalogos/configuration";
import {
  createManagementAuthentication,
  ProductManagement,
  productSettingsDefinition,
  managementProblem,
  type ProductSettings,
} from "@heptalogos/management";
import type {
  BootId,
  InstallationId,
  InstanceId,
  ProductGenerationId,
} from "@heptalogos/foundation-contracts";
import {
  BOOTSTRAP_RUNTIME_GENERATION_ID,
  PRODUCT_GENERATION_ID,
} from "./generated/build-identities.js";
import { createProductionBootstrapKeyProvider } from "./credentials.js";
import { startFirstClaimMaintenance } from "./claim-maintenance.js";
import {
  readFirstClaimMaterial,
  removeCurrentEndpointDescriptor,
  removeFirstClaimMaterial,
  writeFirstClaimMaterial,
  writeManagementEndpointDescriptor,
} from "./files.js";
import { createProductHttpApp, closeProductHttpApp } from "./product-http.js";
import { createOperatorOperations } from "./operator.js";
import { createCalendarMomentOperations } from "./calendar-moment.js";
import { getNousSubject, createNousSubject, connectProductNous } from "./nous.js";
import { createWorldClockManagement } from "./world-clock.js";
import type { ReactorProjection } from "./reactor-http.js";
import { inspectProductDependencies } from "./dependencies.js";
import { createGatewayRuntime } from "./gateway-runtime.js";
import { parseProductHostInputs, type ProductHostInputs } from "./inputs.js";
import {
  createInstalledWorldScheduler,
  createInstalledAgentSelector,
  createInstalledGatewayReader,
  type NativeAgentSelect,
  type NativeWorldSchedule,
  createInstalledNativeDispatcher,
  createInstalledExpressionSender,
} from "./native-dispatch.js";

/** Handle to the independently usable management process. */
export interface ProductHostHandle {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly productGeneration: ProductGenerationId;
  readonly origin: string;
  readonly signal: AbortSignal;
  /** Stops admission and releases every resource owned by this Host. */
  close(): Promise<void>;
}
/** Installed lifecycle roots and private PostgreSQL location. */
export type ProductHostStartOptions = ProductHostInputs & {
  readonly dispatchNativeActivity?: import("./activity-dispatch-contracts.js").NativeActivityDispatch;
  readonly scheduleWorld?: NativeWorldSchedule;
  readonly selectNativeAgent?: NativeAgentSelect;
};

async function runRetainedManagementMutation<T>(
  runtime: ReturnType<typeof createExecutionContextRuntime>,
  persistence: ReturnType<typeof createPersistenceService>,
  lineage: ReturnType<typeof createExecutionLineageService>,
  evidence: ReturnType<typeof createEvidenceService>,
  time: ReturnType<typeof createSystemTimeService>,
  kind: string,
  operation: () => Promise<T>,
): Promise<T> {
  return runtime.runActivity(
    {
      kind,
      importance: "significant",
      retentionClass: "retained",
      sensitivity: "operational",
    },
    async (context: ExecutionContext) => {
      await persistence.mutate((transaction) =>
        lineage.retainCurrent(transaction, context),
      );
      let result: T;
      try {
        result = await operation();
      } catch (error) {
        try {
          await persistence.mutate((transaction) =>
            lineage.completeCurrent(transaction, context, {
              endedAt: time.now(),
              outcome: "FAILED",
            }),
          );
        } catch (completionError) {
          throw new AggregateError(
            [error, completionError],
            "Management mutation and Activity failure completion both failed",
          );
        }
        throw error;
      }

      await persistence.mutate((transaction) =>
        evidence.recordRequired(transaction, {
          evidenceKind: "management.mutation",
          evidenceContractVersion: "management.v1",
          subjectRef: kind,
          retentionClass: "retained",
          sensitivity: "operational",
        }),
      );
      await persistence.mutate((transaction) =>
        lineage.completeCurrent(transaction, context, {
          endedAt: time.now(),
          outcome: "SUCCEEDED",
        }),
      );
      return result;
    },
  );
}

/** Starts Management without initializing a model, Nous, QQ or an in-process runtime graph. */
export async function startProductHost(
  options: ProductHostStartOptions,
): Promise<ProductHostHandle> {
  const startedAt = new Date().toISOString();
  const prepared = await prepareBootstrapPrelude(options.anchorRoot);
  let owned: Awaited<ReturnType<typeof prepared.acquireOwnership>> | undefined;
  let ready:
    | Awaited<ReturnType<NonNullable<typeof owned>["preparePrivatePostgres"]>>
    | undefined;
  let host: BootstrapManagedHostContext | undefined;
  let persistence: ReturnType<typeof createPersistenceService> | undefined;
  let app: Awaited<ReturnType<typeof createProductHttpApp>> | undefined;
  let claim: Awaited<ReturnType<typeof startFirstClaimMaintenance>> | undefined;
  let runRoot: string | undefined;
  let closing: Promise<void> | undefined;
  let stopWorldClock: (() => Promise<void>) | undefined;
  const dispatchController = new AbortController();
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      dispatchController.abort();
      const failures: unknown[] = [];
      const settle = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
        } catch (error) {
          failures.push(error);
        }
      };
      claim?.close();
      await settle(async () => {
        if (app) await closeProductHttpApp(app);
      });
      await settle(async () => stopWorldClock?.());
      if (runRoot && host)
        await settle(() => removeCurrentEndpointDescriptor(runRoot!, host!.bootId));
      await settle(async () => persistence?.close());
      if (host) {
        if (host.state === "ACTIVE")
          await settle(async () => {
            const maintenance = await host!.preparePrivatePostgresMaintenance({
              kind: "STOP_PRIVATE_POSTGRES",
            });
            await maintenance.execute({ async retire() {} });
          });
      } else if (ready) await settle(() => ready!.stop());
      await settle(async () => owned?.close());
      if (failures.length)
        throw new AggregateError(
          failures,
          "Product shutdown could not finish every owned cleanup",
        );
    })();
    return closing;
  };
  try {
    owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const locations = resolveRuntimeLocations(owned.paths);
    runRoot = locations.runRoot;
    const state = await owned.ensureBootstrapStateInitialized({
      activeBootstrapRuntimeGeneration: BOOTSTRAP_RUNTIME_GENERATION_ID,
      activeProductGeneration: PRODUCT_GENERATION_ID,
    });
    const existingInstallation = state.state.privatePostgres !== undefined;
    const keyProvider = await createProductionBootstrapKeyProvider({
      installationId: owned.installationId,
      instanceId: owned.instanceId,
      existingInstallation,
    });
    ready = await owned.preparePrivatePostgres({
      toolchainBinDirectory: options.postgresBinDirectory,
      ...(existingInstallation ? {} : { initialPort: options.initialPostgresPort }),
      lifecycle: {
        startupTimeoutMs: 60_000,
        shutdownTimeoutMs: 30_000,
        readinessPollIntervalMs: 100,
      },
      keyProvider,
    });
    host = await owned.handoffPrivatePostgresToHost(ready, {
      initializeCanonicalHost: createCanonicalSchemaInitializer({
        connectionTimeoutMs: 10_000,
        statementTimeoutMs: 10_000,
        lockTimeoutMs: 10_000,
        idleInTransactionSessionTimeoutMs: 30_000,
        onBackgroundError() {},
      }),
      keyProvider,
      timing: {
        connectionTimeoutMs: 10_000,
        statementTimeoutMs: 10_000,
        fenceLockTimeoutMs: 10_000,
        keepAliveInitialDelayMs: 1_000,
      },
    });
    const currentHost = host;
    const time = createSystemTimeService();
    const runtime = createExecutionContextRuntime(
      {
        installationId: host.installationId,
        instanceId: host.instanceId,
        bootId: host.bootId,
        continuityEpochId: host.continuityEpochId,
        hostOwnershipToken: host.token,
        runtime: { productGenerationId: PRODUCT_GENERATION_ID },
      },
      time,
    );
    const currentPersistence = createPersistenceService(
      host.persistence,
      {
        maxConnections: 4,
        idleTimeoutMs: 5_000,
        connectionTimeoutMs: 10_000,
        statementTimeoutMs: 10_000,
        lockTimeoutMs: 10_000,
        idleInTransactionSessionTimeoutMs: 30_000,
        onBackgroundError() {},
      },
      createPersistenceExecutionContextProvider(runtime),
    );
    persistence = currentPersistence;
    const lineage = createExecutionLineageService();
    const evidence = createEvidenceService(time);
    const runMutationActivity = <T>(kind: string, operation: () => Promise<T>) =>
      runRetainedManagementMutation(
        runtime,
        currentPersistence,
        lineage,
        evidence,
        time,
        kind,
        operation,
      );
    const configuration = createConfigurationService({
      definitions: [productSettingsDefinition],
      persistence,
      time,
      execution: runtime,
      evidence,
    });
    const authentication = createManagementAuthentication({
      persistence,
      time,
      runMutationActivity,
    });
    const product = new ProductManagement({
      configuration,
      installationId: host.installationId,
      bootId: host.bootId,
      startedAt,
      dependencies: inspectProductDependencies,
      runMutation: runMutationActivity,
      subjects: { get: getNousSubject, create: createNousSubject },
    });
    const secretPaths = await resolveBootstrapPathProfile(
      await loadBootstrapLocator(options.anchorRoot),
      ["SECRET"],
    );
    if (
      secretPaths.installationId !== owned.installationId ||
      secretPaths.instanceId !== owned.instanceId
    )
      throw new Error("Installation identity changed while resolving channel secrets");
    const gateway = await createGatewayRuntime({
      persistence: currentPersistence,
      product,
      secretRoot: secretPaths.resolve("SECRET").canonicalPath,
      dataRoot: locations.stateRoot,
      now: () => new Date().toISOString(),
      runMutation: runMutationActivity,
      selectNativeAgent:
        options.selectNativeAgent ??
        createInstalledAgentSelector({
          anchorRoot: options.anchorRoot,
          configurationRoot: owned.paths.resolve("CONFIGURATION").canonicalPath,
          installationId: owned.installationId,
          signal: AbortSignal.any([host.signal, dispatchController.signal]),
        }),
      scheduleWorld:
        options.scheduleWorld ??
        createInstalledWorldScheduler({
          anchorRoot: options.anchorRoot,
          configurationRoot: owned.paths.resolve("CONFIGURATION").canonicalPath,
          installationId: owned.installationId,
          serviceCredentialFile: join(
            secretPaths.resolve("SECRET").canonicalPath,
            "channel-service-token",
          ),
          signal: AbortSignal.any([host.signal, dispatchController.signal]),
        }),
      dispatchNativeActivity:
        options.dispatchNativeActivity ??
        createInstalledNativeDispatcher({
          anchorRoot: options.anchorRoot,
          configurationRoot: owned.paths.resolve("CONFIGURATION").canonicalPath,
          installationId: owned.installationId,
          signal: AbortSignal.any([host.signal, dispatchController.signal]),
        }),
      sendRetainedExpression: createInstalledExpressionSender({
        anchorRoot: options.anchorRoot,
        configurationRoot: owned.paths.resolve("CONFIGURATION").canonicalPath,
        installationId: owned.installationId,
        signal: AbortSignal.any([host.signal, dispatchController.signal]),
      }),
    });
    const recoveryConfiguration = await product.configuration();
    const recoverySubjectId = recoveryConfiguration.settings?.subject?.id;
    if (recoverySubjectId) {
      if (recoveryConfiguration.settings?.subject.enabled) {
        stopWorldClock = () =>
          runMutationActivity("subject.world.host_stop", () =>
            gateway.worldHostLifecycle.stop(),
          );
        await runMutationActivity("subject.world.host_start", () =>
          gateway.worldHostLifecycle.start(),
        ).catch(() => {});
      }
      await runMutationActivity("subject.life.recover", () =>
        gateway.life.recover(recoverySubjectId),
      );
    }
    const currentRunRoot = runRoot;
    const configuredSettings = async (): Promise<ProductSettings> => {
      const configuration = await product.configuration();
      if (!configuration.settings)
        throw managementProblem(
          "management.unconfigured",
          "Product settings are unavailable",
          "Configure the current installation",
          "unavailable",
        );
      return configuration.settings;
    };
    let opportunityProjection: ReactorProjection = { state: "not_requested" };
    const projectOpportunity = async (input: {
      subjectId: string;
      operationRef: string;
    }) => {
      const attempt = {
        operationRef: input.operationRef,
        attemptedAt: new Date().toISOString(),
      };
      try {
        await runMutationActivity("subject.reactor.schedule", () =>
          gateway.requestReactorOpportunity(input),
        );
        opportunityProjection = { ...attempt, state: "projected" };
      } catch (error) {
        opportunityProjection = { ...attempt, state: "unavailable" };
        throw error;
      }
    };
    const readNative = createInstalledGatewayReader({
      anchorRoot: options.anchorRoot,
      configurationRoot: owned.paths.resolve("CONFIGURATION").canonicalPath,
      installationId: owned.installationId,
      signal: host.signal,
    });
    app = await createProductHttpApp({
      calendarMoment: createCalendarMomentOperations({ product, gateway, persistence: currentPersistence }),
      operator: createOperatorOperations({
        anchorRoot: options.anchorRoot,
        product,
        gateway,
        readNativeChannels: () => readNative("channels.status"),
        readProviderAttempts: (params) => readNative("nous.provider-attempts", params),
      }),
      authentication,
      product,
      gateway: gateway.http,
      pursuit: gateway.pursuitHttp,
      world: {
        ...gateway.worldHttp,
        clock: createWorldClockManagement({
          nous: async () => connectProductNous(await configuredSettings()),
        }),
        onProfileAdopted: async (profile) => {
          const configuration = await product.configuration();
          if (
            !configuration.settings ||
            configuration.settings.subject.id !== profile.subjectId
          )
            throw managementProblem(
              "world.profile_binding_changed",
              "Subject binding changed",
              "Read the current binding before activating this profile",
              "conflict",
            );
          if (configuration.settings.subject.worldId !== profile.worldId)
            await product.configure(
              {
                ...configuration.settings,
                subject: {
                  ...configuration.settings.subject,
                  worldId: profile.worldId,
                },
              },
              configuration.revision,
            );
        },
      },
      worldOpportunity: gateway.worldOpportunityHttp,
      narrative: gateway.narrativeHttp,
      reactor: {
        authenticate: gateway.http.authenticate,
        currentSubject: async () => {
          const settings = await configuredSettings();
          if (!settings.subject.id)
            throw managementProblem(
              "management.subject_unbound",
              "Subject is not bound",
              "Bind a Subject before reading Reactor state",
              "conflict",
            );
          return settings.subject.id;
        },
        settings: configuredSettings,
        foreground: gateway.foreground,
        attention: gateway.attention,
        runMutation: runMutationActivity,
        wake: projectOpportunity,
        projection: () => opportunityProjection,
      },
      identity: {
        installationId: currentHost.installationId,
        bootId: currentHost.bootId,
      },
      onAdministratorClaimed: () => removeFirstClaimMaterial(currentRunRoot),
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string")
      throw new Error("Management listener has no local port");
    const origin = `http://127.0.0.1:${address.port}`;
    await writeManagementEndpointDescriptor(runRoot, {
      schemaVersion: 1,
      installationId: host.installationId,
      bootId: host.bootId,
      origin,
    });
    claim = await startFirstClaimMaintenance({
      readLocalClaim: () => readFirstClaimMaterial(currentRunRoot),
      ensureClaim: (local) => authentication.ensureFirstAdministratorClaim(local),
      publishClaim: (material) => writeFirstClaimMaterial(currentRunRoot, material),
      removeClaim: () => removeFirstClaimMaterial(currentRunRoot),
    });
    host.signal.addEventListener(
      "abort",
      () => {
        void close().catch(() => {
          process.exitCode = 1;
        });
      },
      { once: true },
    );
    return {
      installationId: currentHost.installationId,
      instanceId: currentHost.instanceId,
      bootId: currentHost.bootId,
      productGeneration: PRODUCT_GENERATION_ID,
      origin,
      signal: currentHost.signal,
      close,
    };
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "Product startup and cleanup failed");
    }
    throw error;
  }
}
/** Uses the same installed startup path as service and CLI. */
export function startProductHostFromArgv(
  argv: readonly string[],
): Promise<ProductHostHandle> {
  return startProductHost(parseProductHostInputs(argv));
}
