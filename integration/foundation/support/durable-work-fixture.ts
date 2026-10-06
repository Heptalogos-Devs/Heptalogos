// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe } from "vitest";
import {
  asDurableCodeVersion,
  asContentDigest,
  createContributionId,
  createMicroSystemId,
  digestCanonicalJson,
  parseInstant,
  type Instant,
  type PackageGenerationId,
  type ProductGenerationId,
} from "@heptalogos/foundation-contracts";
import {
  createDurableExecutionRuntime,
  createDurableExecutionSchemaProvisioner,
  createDurableDispatchPort,
  type DurableExecutionRuntime,
} from "@heptalogos/durable-execution";
import {
  createExecutionContextRuntime,
  createExecutionLineageService,
  createPersistenceExecutionContextProvider,
  type ExecutionContext,
} from "@heptalogos/execution-lineage";
import { createPersistenceService } from "@heptalogos/persistence";
import { createFakeTimeService, type FakeTimeService } from "@heptalogos/time-service";
import {
  createRuntimeLifecycleLineage,
  MicroSystemSupervisor,
  type MicroSystemDefinition,
  type RuntimeWorkHandler,
  type RuntimeWorkHandlerInvocation,
  type WorkHandlerPayloadContract,
  type WorkHandlerProvisionDescriptor,
  type WorkHandlerTarget,
  type WorkQueueProfileId,
  type ResourceAdmissionClassId,
} from "@heptalogos/runtime-kernel";
import { createRuntimeSubstrate } from "@heptalogos/runtime-substrate";
import { HOST_DURABLE_EXECUTION_ROLE } from "@heptalogos/host-ownership";
import {
  createWorkAttemptExecutor,
  createDispatchAttemptId,
  createWorkQueueProfileCatalog,
  createWorkQueueReconciler,
  createWorkQueueService,
  type WorkAdmissionPort,
  type DurableDispatchRequest,
  type WorkErrorClassifier,
  type WorkItem,
  type WorkQueueProfileCatalog,
  type WorkQueueRuntimeOptions,
} from "@heptalogos/work-queue";
import { createWorkQueueRepository } from "@heptalogos/work-queue/repository";
import {
  createPostgresSignalService,
  postgresSignalPublisher,
  type SignalService,
} from "@heptalogos/signal";
import {
  BOOTSTRAP_PASSWORD,
  CANONICAL_OPTIONS,
  DURABLE_EXECUTION_PASSWORD,
  MIGRATION_PASSWORD,
  boot,
  cleanupCanonicalPostgresFixtures,
  describeRealPostgres,
  makeFixture,
  queryAs,
  stopManagedHostWithoutRuntime,
} from "../support/canonical-postgres.js";
import { createCanonicalSchemaInitializer } from "@heptalogos/canonical-schema";

export const describePostgres =
  describeRealPostgres === undefined ? describe.skip : describe;
export const initialTime = "2026-08-26T12:00:00.000Z" as Instant;
export const futureTime = "2026-08-26T12:05:00.000Z" as Instant;
const settleTimeoutMs = 100;
export const queueProfileId = createMicroSystemId(
  "work.default",
) as unknown as WorkQueueProfileId;
export const resourceAdmissionClass = createMicroSystemId(
  "work.default",
) as unknown as ResourceAdmissionClassId;
export const PROFILE_CATALOG = createWorkQueueProfileCatalog([
  { profileId: queueProfileId, minPollingIntervalMs: 100 },
]);
export const DURABLE_CODE_VERSION = asDurableCodeVersion(
  digestCanonicalJson("test.durable-execution-code/v1", { version: "current" }),
);
export const DURABLE_OPTIONS = {
  durableCodeVersion: DURABLE_CODE_VERSION,
  systemPool: {
    maxConnections: 4,
    idleTimeoutMs: 5_000,
    connectionTimeoutMs: 10_000,
    statementTimeoutMs: 10_000,
    idleInTransactionSessionTimeoutMs: 30_000,
  },
  systemDatabasePollingConcurrency: 2,
  maxConcurrentQueueDispatches: 4,
  workflowMaxRecoveryAttempts: 4,
  shutdownDrainTimeoutMs: 10_000,
  profiles: PROFILE_CATALOG,
  onTerminalFailure() {},
  onBackgroundError() {},
} as const;
const durableSchemaProvisioner = createDurableExecutionSchemaProvisioner({
  processTimeoutMs: 120_000,
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
});
const canonicalInitializer = createCanonicalSchemaInitializer(CANONICAL_OPTIONS);
const initializeCanonicalAndDurable = async (
  context: Parameters<typeof canonicalInitializer>[0],
): Promise<void> => {
  await canonicalInitializer(context);
  await durableSchemaProvisioner.ensureCurrent(context.authority);
};

const PERSISTENCE_OPTIONS = {
  maxConnections: 2,
  idleTimeoutMs: 5_000,
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  lockTimeoutMs: 10_000,
  idleInTransactionSessionTimeoutMs: 30_000,
  onBackgroundError() {},
} as const;

export const WORK_OPTIONS: WorkQueueRuntimeOptions = {
  maxInlinePayloadBytes: 4_096,
  maxOutcomeBytes: 4_096,
  reconciliationBatchSize: 32,
  antiEntropyIntervalMs: 100,
};

const SIGNAL_OPTIONS = {
  connectionTimeoutMs: 10_000,
  reconnectBaseDelayMs: 25,
  reconnectMaxDelayMs: 200,
  onBackgroundError() {},
} as const;

export function generation<T extends "ProductGenerationId" | "PackageGenerationId">(
  brand: T,
  label: string,
): T extends "ProductGenerationId" ? ProductGenerationId : PackageGenerationId {
  return asContentDigest(
    brand,
    digestCanonicalJson(`durable-work/${label}/v1`, { label }),
  ) as unknown as T extends "ProductGenerationId"
    ? ProductGenerationId
    : PackageGenerationId;
}

export interface Composition {
  readonly fixture: Awaited<ReturnType<typeof makeFixture>>;
  readonly bootResult: Awaited<ReturnType<typeof boot>>;
  readonly time: FakeTimeService;
  readonly runtime: ReturnType<typeof createExecutionContextRuntime>;
  readonly persistence: ReturnType<typeof createPersistenceService>;
  readonly lineage: ReturnType<typeof createExecutionLineageService>;
  readonly supervisor: MicroSystemSupervisor;
  readonly signal: SignalService;
  readonly repository: ReturnType<typeof createWorkQueueRepository>;
  readonly work: ReturnType<typeof createWorkQueueService>;
  readonly reconciler: ReturnType<typeof createWorkQueueReconciler>;
  readonly executor: ReturnType<typeof createWorkAttemptExecutor>;
  readonly durable?: DurableExecutionRuntime;
  readonly durableDispatch: {
    dispatch(request: DurableDispatchRequest): Promise<void>;
  };
  readonly target: WorkHandlerTarget;
  readonly descriptor: WorkHandlerProvisionDescriptor;
  readonly handlerCalls: RuntimeWorkHandlerInvocation[];
  readonly contributionContexts: ExecutionContext[];
  readonly admission: WorkAdmissionPort;
  readonly dispatches: Array<{
    readonly workItemId: WorkItem["workItemId"];
    readonly dispatchRevision: number;
    readonly dispatchAttemptId: string;
  }>;
  readonly setDispatchUnavailable: (value: boolean) => void;
}

export async function createComposition(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  options: {
    readonly durableExecution?: boolean;
    readonly profiles?: WorkQueueProfileCatalog;
    readonly admission?: WorkAdmissionPort;
    readonly handler?: RuntimeWorkHandler;
    readonly runtimeOptions?: WorkQueueRuntimeOptions;
  } = {},
): Promise<Composition> {
  const bootResult = await boot(
    fixture,
    options.durableExecution ? initializeCanonicalAndDurable : undefined,
  );
  const profileCatalog = options.profiles ?? PROFILE_CATALOG;
  const workOptions = options.runtimeOptions ?? WORK_OPTIONS;
  const time = createFakeTimeService(parseInstant(initialTime)!);
  const runtime = createExecutionContextRuntime(
    {
      installationId: bootResult.host.installationId,
      instanceId: bootResult.host.instanceId,
      bootId: bootResult.host.bootId,
      continuityEpochId: bootResult.host.continuityEpochId,
      hostOwnershipToken: bootResult.host.token,
    },
    time,
  );
  const persistence = createPersistenceService(
    bootResult.host.persistence,
    PERSISTENCE_OPTIONS,
    createPersistenceExecutionContextProvider(runtime),
  );
  const lineage = createExecutionLineageService();
  const lifecycleLineage = createRuntimeLifecycleLineage({
    execution: runtime,
    persistence,
    lineage,
    time,
  });
  const productGenerationId = generation("ProductGenerationId", "product-a");
  const packageGenerationId = generation("PackageGenerationId", "package-a");
  const microSystemId = createMicroSystemId("qualification.work");
  const contributionId = createContributionId("qualification.work.execute");
  const target: WorkHandlerTarget = {
    productGenerationId,
    microSystemId,
    contributionId,
    packageGenerationId,
    payloadVersion: 1,
  };
  const contributionContexts: ExecutionContext[] = [];
  let observeRuntime: typeof runtime | undefined;
  const handlerCalls: RuntimeWorkHandlerInvocation[] = [];
  const defaultHandler: RuntimeWorkHandler = {
    async execute(input) {
      handlerCalls.push(input);
      const current = observeRuntime?.current();
      if (current !== undefined) contributionContexts.push(current);
      return { outcome: { accepted: true } };
    },
  };
  const payloadContracts: readonly WorkHandlerPayloadContract[] = [
    {
      version: 1,
      schema: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
        additionalProperties: false,
      },
    },
  ];
  const descriptor: WorkHandlerProvisionDescriptor = {
    contributionId,
    contractVersion: "v1" as never,
    payloadContracts,
    outcomeSchema: {
      type: "object",
      properties: { accepted: { type: "boolean" } },
      required: ["accepted"],
      additionalProperties: false,
    },
    queueProfileId,
    resourceAdmissionClass,
    configurationBindingPolicy: "LATEST_COMPATIBLE_AT_ATTEMPT",
    restoreReplayClass: "RECONCILE_REQUIRED",
  };
  const definition: MicroSystemDefinition = {
    microSystemId,
    role: "system-service",
    generation: { productGenerationId, packageGenerationId },
    operatingModes: ["NORMAL", "SAFE", "MAINTENANCE", "EMERGENCY_READ_ONLY"],
    serviceRequirements: [],
    capabilityRequirements: [],
    serviceProvisions: [],
    capabilityProvisions: [],
    workHandlerProvisions: [descriptor],
    activate: async (context) => {
      context.publishWorkHandler(descriptor, options.handler ?? defaultHandler);
    },
  };
  const supervisor = new MicroSystemSupervisor({
    substrate: createRuntimeSubstrate({ settleTimeoutMs }),
    settleTimeoutMs,
    definitions: [definition],
    lifecycleLineage,
    rootRuntimeOrigin: { productGenerationId },
  });
  await supervisor.reconcile({
    revision: 1,
    operatingMode: "NORMAL",
    desired: new Map([[microSystemId, "RUNNING"]]),
    serviceBindings: new Map(),
    capabilityBindings: new Map(),
  });
  observeRuntime = runtime;
  const signal = createPostgresSignalService(
    bootResult.host.persistence,
    SIGNAL_OPTIONS,
  );
  const repository = createWorkQueueRepository(persistence);
  const defaultAdmission: WorkAdmissionPort = {
    beforeCreate: async () => ({ decision: "ALLOW" }),
    beforeDispatch: async () => ({ decision: "ALLOW" }),
  };
  const admission = options.admission ?? defaultAdmission;
  const classifier: WorkErrorClassifier = {
    classify: () => ({
      kind: "TERMINAL",
      retryClass: "permanent",
      reasonCode: "handler-exception",
    }),
  };
  const work = createWorkQueueService({
    persistence,
    handlerRegistry: supervisor.workHandlers,
    execution: runtime,
    lineage,
    time,
    signalPublisher: postgresSignalPublisher,
    admission,
    profiles: profileCatalog,
    runtimeOptions: workOptions,
    onBackgroundError() {},
  });
  const executor = createWorkAttemptExecutor({
    repository,
    handlerRegistry: supervisor.workHandlers,
    execution: runtime,
    lineage,
    time,
    classifier,
    runtimeOptions: workOptions,
  });
  const durable = options.durableExecution
    ? createDurableExecutionRuntime(
        bootResult.host.durableExecution,
        { ...DURABLE_OPTIONS, profiles: profileCatalog },
        executor,
      )
    : undefined;
  const realDurableDispatch = durable
    ? createDurableDispatchPort({
        authority: bootResult.host.durableExecution,
        lifecycle: durable,
        durableCodeVersion: DURABLE_CODE_VERSION,
        profiles: profileCatalog,
        now: () => time.now(),
      })
    : undefined;
  const dispatches: Composition["dispatches"] = [];
  let dispatchUnavailable = false;
  const durableDispatch = {
    async dispatch(request: DurableDispatchRequest) {
      dispatches.push(request);
      if (dispatchUnavailable) throw new Error("dispatch adapter unavailable");
      await realDurableDispatch?.dispatch(request);
    },
  };
  const reconciler = createWorkQueueReconciler({
    repository,
    durableDispatch,
    handlerRegistry: supervisor.workHandlers,
    admission,
    signal,
    execution: runtime,
    time,
    runtimeOptions: workOptions,
    onBackgroundError() {},
  });
  return {
    fixture,
    bootResult,
    time,
    runtime,
    persistence,
    lineage,
    supervisor,
    signal,
    repository,
    work,
    reconciler,
    executor,
    durable,
    durableDispatch,
    target,
    descriptor,
    handlerCalls,
    contributionContexts,
    admission,
    dispatches,
    setDispatchUnavailable: (value) => {
      dispatchUnavailable = value;
    },
  };
}

export async function createWork(
  composition: Composition,
  target: WorkHandlerTarget = composition.target,
  options: {
    readonly dedupKey?: string;
    readonly notBefore?: Instant;
    readonly partitionKey?: string;
    readonly priority?: number;
  } = {},
) {
  return composition.runtime.runActivity(
    {
      kind: "qualification.work.request",
      importance: "significant",
      retentionClass: "operational",
      sensitivity: "operational",
    },
    () =>
      composition.work.create({
        target,
        payload: { value: "work-qualification" },
        queueProfileId,
        resourceAdmissionClass,
        priority: options.priority ?? 100,
        ...(options.dedupKey === undefined ? {} : { dedupKey: options.dedupKey }),
        ...(options.notBefore === undefined ? {} : { notBefore: options.notBefore }),
        ...(options.partitionKey === undefined
          ? {}
          : { partitionKey: options.partitionKey }),
      }),
  );
}

export async function runCanonicalMutation<T>(
  composition: Composition,
  kind: string,
  operation: () => Promise<T>,
): Promise<T> {
  return composition.runtime.runActivity(
    {
      kind,
      importance: "significant",
      retentionClass: "operational",
      sensitivity: "operational",
    },
    operation,
  );
}

export async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 20));
  }
  throw new Error("qualification condition was not reached before timeout");
}

export async function closeComposition(composition: Composition): Promise<void> {
  await composition.reconciler.stop().catch(() => undefined);
  await composition.durable?.close().catch(() => undefined);
  await composition.supervisor.close().catch(() => undefined);
  await composition.persistence.close().catch(() => undefined);
  await stopManagedHostWithoutRuntime(composition.bootResult.host).catch(
    () => undefined,
  );
}

// Intentional duplication: the fixture mirrors the private WorkQueue request
// shape to inspect durable rows without widening the production helper API.
/* jscpd:ignore-start */
export function durableRequest(item: WorkItem): DurableDispatchRequest {
  return {
    workItemId: item.workItemId,
    dispatchRevision: item.dispatchRevision,
    dispatchAttemptId: createDispatchAttemptId(item.workItemId, item.dispatchRevision),
    queueProfileId: item.queueProfileId,
    priority: item.priority,
    ...(item.partitionKey === undefined ? {} : { partitionKey: item.partitionKey }),
    ...(item.notBefore === undefined ? {} : { notBefore: item.notBefore }),
  };
}
/* jscpd:ignore-end */

export async function durableWorkflowRow(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  workflowID: string,
): Promise<Record<string, unknown> | undefined> {
  return (
    await queryAs(
      fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT workflow_uuid, status, application_version, executor_id, queue_name,
              priority, queue_partition_key, delay_until_epoch_ms
         FROM "dbos"."workflow_status"
        WHERE workflow_uuid = $1`,
      [workflowID],
    )
  ).rows[0];
}

interface DurableProductRelationPrivilegeRow {
  readonly relation_name: string;
  readonly relkind: string;
  readonly can_read: boolean;
  readonly can_insert: boolean;
  readonly can_update: boolean;
  readonly can_delete: boolean;
  readonly can_usage: boolean;
}

interface DurableProductRoutinePrivilegeRow {
  readonly routine_name: string;
  readonly prokind: "f" | "p";
  readonly can_execute: boolean;
}

export async function durableProductPrivilegeSnapshot(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
): Promise<{
  readonly schema: Record<string, unknown>;
  readonly relations: readonly DurableProductRelationPrivilegeRow[];
  readonly routines: readonly DurableProductRoutinePrivilegeRow[];
  readonly dbos: Record<string, unknown>;
}> {
  const role = HOST_DURABLE_EXECUTION_ROLE;
  const schema = (
    await queryAs(
      fixture,
      "heptalogos_durable_execution",
      DURABLE_EXECUTION_PASSWORD,
      `SELECT has_schema_privilege($1, 'heptalogos', 'USAGE') AS product_schema_usage,
              has_schema_privilege($1, 'heptalogos', 'CREATE') AS product_schema_create,
              has_schema_privilege($1, 'dbos', 'USAGE') AS dbos_schema_usage,
              has_schema_privilege($1, 'dbos', 'CREATE') AS dbos_schema_create`,
      [role],
    )
  ).rows[0] as Record<string, unknown> | undefined;
  if (schema === undefined) throw new Error("schema privilege snapshot is empty");

  const relations = (
    await queryAs(
      fixture,
      "heptalogos_durable_execution",
      DURABLE_EXECUTION_PASSWORD,
      `SELECT c.relname AS relation_name,
              c.relkind,
              CASE WHEN c.relkind = 'S'
                   THEN has_sequence_privilege($1, c.oid, 'SELECT')
                   ELSE has_table_privilege($1, c.oid, 'SELECT')
              END AS can_read,
              CASE WHEN c.relkind = 'S'
                   THEN false
                   ELSE has_table_privilege($1, c.oid, 'INSERT')
              END AS can_insert,
              CASE WHEN c.relkind = 'S'
                   THEN has_sequence_privilege($1, c.oid, 'UPDATE')
                   ELSE has_table_privilege($1, c.oid, 'UPDATE')
              END AS can_update,
              CASE WHEN c.relkind = 'S'
                   THEN false
                   ELSE has_table_privilege($1, c.oid, 'DELETE')
              END AS can_delete,
              CASE WHEN c.relkind = 'S'
                   THEN has_sequence_privilege($1, c.oid, 'USAGE')
                   ELSE false
              END AS can_usage
         FROM pg_catalog.pg_class AS c
         JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'heptalogos'
          AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
        ORDER BY c.relkind, c.relname`,
      [role],
    )
  ).rows as unknown as DurableProductRelationPrivilegeRow[];

  const routines = (
    await queryAs(
      fixture,
      "heptalogos_durable_execution",
      DURABLE_EXECUTION_PASSWORD,
      `SELECT p.oid::regprocedure::text AS routine_name,
              p.prokind,
              has_function_privilege($1, p.oid, 'EXECUTE') AS can_execute
         FROM pg_catalog.pg_proc AS p
         JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'heptalogos'
          AND p.prokind IN ('f', 'p')
        ORDER BY routine_name`,
      [role],
    )
  ).rows as unknown as DurableProductRoutinePrivilegeRow[];

  const dbos = (
    await queryAs(
      fixture,
      "heptalogos_durable_execution",
      DURABLE_EXECUTION_PASSWORD,
      `SELECT has_table_privilege($1, 'dbos.workflow_status', 'SELECT') AS dbos_select,
              has_table_privilege($1, 'dbos.workflow_status', 'INSERT') AS dbos_insert,
              has_table_privilege($1, 'dbos.workflow_status', 'UPDATE') AS dbos_update,
              has_table_privilege($1, 'dbos.workflow_status', 'DELETE') AS dbos_delete`,
      [role],
    )
  ).rows[0] as Record<string, unknown> | undefined;
  if (dbos === undefined) throw new Error("DBOS privilege snapshot is empty");

  return { schema, relations, routines, dbos };
}

export async function requireDurable(
  composition: Composition,
): Promise<DurableExecutionRuntime> {
  if (composition.durable === undefined) {
    throw new Error("durable execution was not enabled for this composition");
  }
  await composition.durable.start();
  return composition.durable;
}

export {
  BOOTSTRAP_PASSWORD,
  DURABLE_EXECUTION_PASSWORD,
  MIGRATION_PASSWORD,
  cleanupCanonicalPostgresFixtures,
  makeFixture,
  queryAs,
};
