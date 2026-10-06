// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest";
import {
  asContentDigest,
  createActivityId,
  createCapabilityId,
  createMicroSystemId,
  createMicroSystemInstanceId,
  createProviderId,
  createServiceId,
  digestCanonicalJson,
  parseInstant,
  type ProductGenerationId,
  type CapabilityId,
  type ProviderId,
  type ServiceId,
} from "@heptalogos/foundation-contracts";
import { HOST_RUNTIME_ROLE } from "@heptalogos/host-ownership";
import {
  createExecutionContextRuntime,
  createExecutionLineageService,
  createPersistenceExecutionContextProvider,
} from "@heptalogos/execution-lineage";
import { createPersistenceService } from "@heptalogos/persistence";
import { createFakeTimeService } from "@heptalogos/time-service";
import { createRuntimeSubstrate } from "@heptalogos/runtime-substrate";
import {
  createContractVersion,
  createRuntimeLifecycleLineage,
  exactContract,
  MicroSystemSupervisor,
  type ServiceLease,
  type MicroSystemDefinition,
  type ServiceRequirement,
  type CapabilityProvisionDescriptor,
  type CapabilityRequirement,
} from "@heptalogos/runtime-kernel";
import {
  BOOTSTRAP_PASSWORD,
  boot,
  cleanupCanonicalPostgresFixtures,
  describeRealPostgres,
  expectQueryDenied,
  makeFixture,
  queryAs,
  RUNTIME_PASSWORD,
  stopManagedHostWithoutRuntime,
} from "../support/canonical-postgres.js";

const describePostgres = describeRealPostgres === undefined ? describe.skip : describe;
const settleTimeoutMs = 100;
const contractV1 = createContractVersion("v1");

afterEach(async () => {
  await cleanupCanonicalPostgresFixtures();
});

function generation(productGenerationId: ProductGenerationId) {
  return { productGenerationId };
}

function testProductGenerationId(): ProductGenerationId {
  return asContentDigest(
    "ProductGenerationId",
    digestCanonicalJson("test.product-generation/v1", { generation: "product" }),
  );
}

function serviceRequirement(serviceId: ServiceId): ServiceRequirement {
  return { serviceId, contract: exactContract(contractV1) };
}

function capabilityRequirement(
  capabilityId: CapabilityId,
  required = true,
): CapabilityRequirement {
  return { capabilityId, contract: exactContract(contractV1), required };
}

function desired(
  systems: readonly MicroSystemDefinition[],
  operatingMode: "NORMAL" | "SAFE" = "NORMAL",
  serviceBindings: ReadonlyMap<ServiceId, ProviderId> = new Map(),
  capabilityBindings: ReadonlyMap<CapabilityId, ProviderId> = new Map(),
) {
  return {
    revision: 1,
    operatingMode,
    desired: new Map(
      systems.map((system) => [system.microSystemId, "RUNNING" as const]),
    ),
    serviceBindings,
    capabilityBindings,
  };
}

function capabilityProvider(
  id: string,
  productGenerationId: ProductGenerationId,
  capabilityId: CapabilityId,
  priority: number,
): MicroSystemDefinition {
  const descriptor: CapabilityProvisionDescriptor = {
    capabilityId,
    providerId: createProviderId(`provider.${id}`),
    contractVersion: contractV1,
    priority,
  };
  return {
    microSystemId: createMicroSystemId(`system.${id}`),
    role: "provider",
    generation: generation(productGenerationId),
    operatingModes: ["NORMAL", "SAFE", "MAINTENANCE", "EMERGENCY_READ_ONLY"],
    serviceRequirements: [],
    capabilityRequirements: [],
    serviceProvisions: [],
    capabilityProvisions: [descriptor],
    activate: async (context) => {
      context.publishCapability(descriptor, { read: () => id });
    },
  };
}

function provider(
  id: string,
  productGenerationId: ProductGenerationId,
  serviceId: ServiceId,
  activate: MicroSystemDefinition["activate"] = async (context) => {
    context.publishService(
      {
        serviceId,
        providerId: createProviderId(`provider.${id}`),
        contractVersion: contractV1,
      },
      { read: () => id },
    );
  },
): MicroSystemDefinition {
  return {
    microSystemId: createMicroSystemId(`system.${id}`),
    role: "provider",
    generation: generation(productGenerationId),
    operatingModes: ["NORMAL", "SAFE", "MAINTENANCE", "EMERGENCY_READ_ONLY"],
    serviceRequirements: [],
    capabilityRequirements: [],
    serviceProvisions: [
      {
        serviceId,
        providerId: createProviderId(`provider.${id}`),
        contractVersion: contractV1,
      },
    ],
    capabilityProvisions: [],
    activate,
  };
}

function consumer(
  id: string,
  productGenerationId: ProductGenerationId,
  serviceId: ServiceId,
  activate: MicroSystemDefinition["activate"],
): MicroSystemDefinition {
  return {
    microSystemId: createMicroSystemId(`system.${id}`),
    role: "feature",
    generation: generation(productGenerationId),
    operatingModes: ["NORMAL", "SAFE", "MAINTENANCE", "EMERGENCY_READ_ONLY"],
    serviceRequirements: [serviceRequirement(serviceId)],
    capabilityRequirements: [],
    serviceProvisions: [],
    capabilityProvisions: [],
    activate,
  };
}

function independent(
  id: string,
  productGenerationId: ProductGenerationId,
  operatingModes: MicroSystemDefinition["operatingModes"] = ["NORMAL", "SAFE"],
  activate: MicroSystemDefinition["activate"] = async () => undefined,
): MicroSystemDefinition {
  return {
    microSystemId: createMicroSystemId(`system.${id}`),
    role: "feature",
    generation: generation(productGenerationId),
    operatingModes,
    serviceRequirements: [],
    capabilityRequirements: [],
    serviceProvisions: [],
    capabilityProvisions: [],
    activate,
  };
}

async function createComposition(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  productGenerationId: ProductGenerationId,
  definitions: readonly MicroSystemDefinition[],
) {
  const bootResult = await boot(fixture);
  const time = createFakeTimeService(parseInstant("2026-08-25T15:00:00.000Z")!);
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
    {
      maxConnections: 1,
      idleTimeoutMs: 5_000,
      connectionTimeoutMs: 10_000,
      statementTimeoutMs: 10_000,
      lockTimeoutMs: 10_000,
      idleInTransactionSessionTimeoutMs: 30_000,
      onBackgroundError() {},
    },
    createPersistenceExecutionContextProvider(runtime),
  );
  const lineage = createExecutionLineageService();
  const lifecycleLineage = createRuntimeLifecycleLineage({
    execution: runtime,
    persistence,
    lineage,
    time,
  });
  const supervisor = new MicroSystemSupervisor({
    substrate: createRuntimeSubstrate({ settleTimeoutMs }),
    settleTimeoutMs,
    definitions,
    lifecycleLineage,
    rootRuntimeOrigin: { productGenerationId },
  });
  return { bootResult, persistence, supervisor, runtime, lineage };
}

async function closeComposition(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  composition: Awaited<ReturnType<typeof createComposition>>,
): Promise<void> {
  await composition.supervisor.close().catch(() => undefined);
  await composition.persistence.close().catch(() => undefined);
  await stopManagedHostWithoutRuntime(composition.bootResult.host).catch(
    () => undefined,
  );
}

describePostgres.sequential("Runtime Kernel Runtime Kernel on the managed Host", () => {
  it("persists runtime lifecycle lineage and keeps direct runtime UPDATE denied", async () => {
    const fixture = await makeFixture();
    const productGenerationId = testProductGenerationId();
    const serviceId = createServiceId("runtime.integration.service");
    const a = provider("a", productGenerationId, serviceId);
    const b = consumer("b", productGenerationId, serviceId, async (context) => {
      await context
        .requireService<{ read(): string }>(serviceRequirement(serviceId))
        .invoke("read", (service) => service.read());
    });
    const c = independent("c", productGenerationId);
    const composition = await createComposition(fixture, productGenerationId, [
      a,
      b,
      c,
    ]);

    try {
      await composition.supervisor.reconcile(desired([a, b, c]));
      expect(composition.supervisor.getActualState(b.microSystemId)).toBe("RUNNING");

      const activityRows = await queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT kind, product_generation_id, micro_system_id,
                micro_system_instance_id, ended_at, outcome
           FROM "heptalogos"."activity_record"
          WHERE kind LIKE 'runtime.%'
          ORDER BY started_at, activity_id`,
      );
      expect(activityRows.rows.length).toBeGreaterThanOrEqual(4);
      expect(activityRows.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "runtime.reconcile",
            product_generation_id: productGenerationId,
            ended_at: expect.anything(),
            outcome: "SUCCEEDED",
          }),
          expect.objectContaining({
            kind: "runtime.lifecycle.activate",
            micro_system_id: a.microSystemId,
            micro_system_instance_id: expect.anything(),
            outcome: "SUCCEEDED",
          }),
        ]),
      );

      await expectQueryDenied(
        fixture,
        HOST_RUNTIME_ROLE,
        RUNTIME_PASSWORD,
        `UPDATE "heptalogos"."activity_record"
            SET ended_at = clock_timestamp(), outcome = 'FAILED'
          WHERE activity_id = (SELECT activity_id FROM "heptalogos"."activity_record" LIMIT 1)`,
      );

      const host = composition.bootResult.host;
      const insertConstraintProbe = (values: readonly unknown[]) =>
        queryAs(
          fixture,
          "heptalogos_bootstrap",
          BOOTSTRAP_PASSWORD,
          `INSERT INTO "heptalogos"."activity_record" (
             activity_id, kind, started_at, installation_id, instance_id,
             boot_id, continuity_epoch_id, importance, retention_class,
             sensitivity, product_generation_id, package_generation_id,
             micro_system_id, micro_system_instance_id
           ) VALUES ($1, 'runtime.constraint.test', $2, $3, $4, $5, $6,
                     'routine', 'retained', 'operational', $7, $8, $9, $10)`,
          [
            createActivityId(),
            "2026-08-25T15:00:00.000Z",
            host.installationId,
            host.instanceId,
            host.bootId,
            host.continuityEpochId,
            ...values,
          ],
        );
      await expect(
        insertConstraintProbe(["A".repeat(64), null, null, null]),
      ).rejects.toBeDefined();
      await expect(
        insertConstraintProbe([null, "b".repeat(64), null, null]),
      ).rejects.toBeDefined();
      await expect(
        insertConstraintProbe([
          productGenerationId,
          null,
          "Bad.System",
          createMicroSystemInstanceId(),
        ]),
      ).rejects.toBeDefined();
      const invalidCompletion = await queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT "heptalogos"."complete_activity_record"(
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
         ) AS result`,
        [
          createActivityId(),
          host.installationId,
          host.instanceId,
          host.bootId,
          host.continuityEpochId,
          host.token,
          productGenerationId,
          null,
          null,
          null,
          null,
          null,
          "SUCCEEDED",
          null,
        ],
      );
      expect(invalidCompletion.rows).toEqual([{ result: "INVALID_COMPLETION" }]);
    } finally {
      await closeComposition(fixture, composition);
    }
  }, 180_000);

  it("replaces a hard Service and fences the old ServiceLease", async () => {
    const fixture = await makeFixture();
    const productGenerationId = testProductGenerationId();
    const serviceId = createServiceId("runtime.integration.replace");
    let activations = 0;
    let oldLease: ServiceLease<{ read(): string }> | undefined;
    const a = provider("a", productGenerationId, serviceId);
    const d = provider("d", productGenerationId, serviceId);
    const b = consumer("b", productGenerationId, serviceId, async (context) => {
      activations += 1;
      const lease = context.requireService<{ read(): string }>(
        serviceRequirement(serviceId),
      );
      if (oldLease === undefined) oldLease = lease;
      await lease.invoke("read", (service) => service.read());
    });
    const composition = await createComposition(fixture, productGenerationId, [
      a,
      b,
      d,
    ]);

    try {
      await composition.supervisor.reconcile(desired([a, b]));
      await composition.supervisor.reconcile(
        desired(
          [d, b],
          "NORMAL",
          new Map([[serviceId, createProviderId("provider.d")]]),
        ),
      );
      expect(composition.supervisor.getActualState(b.microSystemId)).toBe("RUNNING");
      expect(activations).toBe(2);
      await expect(
        oldLease!.invoke("read", (service) => service.read()),
      ).rejects.toMatchObject({
        problem: { problemCode: "runtime.generation.retired" },
      });
    } finally {
      await closeComposition(fixture, composition);
    }
  }, 180_000);

  it("proves Capability provider activation, rebind, readiness, and fail-closed explicit binding", async () => {
    const fixture = await makeFixture();
    const productGenerationId = testProductGenerationId();
    const capabilityId = createCapabilityId("runtime.integration.capability");
    const highProvider = capabilityProvider(
      "capability-high",
      productGenerationId,
      capabilityId,
      10,
    );
    const lowProvider = capabilityProvider(
      "capability-low",
      productGenerationId,
      capabilityId,
      1,
    );
    const requirement = capabilityRequirement(capabilityId, true);
    let consumerActivations = 0;
    const selectedProviders: ProviderId[] = [];
    const consumerDefinition: MicroSystemDefinition = {
      microSystemId: createMicroSystemId("system.capability-consumer"),
      role: "feature",
      generation: generation(productGenerationId),
      operatingModes: ["NORMAL", "SAFE", "MAINTENANCE", "EMERGENCY_READ_ONLY"],
      serviceRequirements: [],
      capabilityRequirements: [requirement],
      serviceProvisions: [],
      capabilityProvisions: [],
      activate: async (context) => {
        consumerActivations += 1;
        const lease = context.resolveCapability<{ read(): string }>(requirement);
        if (lease === undefined) throw new Error("Capability was not resolved");
        selectedProviders.push(lease.providerId);
        await lease.invoke("read", (capability) => capability.read());
      },
    };
    const profile = {
      profileId: "runtime.integration.capability-profile",
      requiredServices: [],
      requiredCapabilities: [requirement],
      optionalCapabilities: [],
    };
    const composition = await createComposition(fixture, productGenerationId, [
      highProvider,
      lowProvider,
      consumerDefinition,
    ]);

    try {
      await composition.supervisor.reconcile(desired([highProvider, lowProvider]));
      await composition.supervisor.reconcile(
        desired([highProvider, lowProvider, consumerDefinition]),
      );
      expect(selectedProviders).toEqual([createProviderId("provider.capability-high")]);
      expect(consumerActivations).toBe(1);
      expect(composition.supervisor.evaluateReadiness(profile).state).toBe("READY");

      await composition.supervisor.reconcile(
        desired([lowProvider, consumerDefinition]),
      );
      expect(
        composition.supervisor.getActualState(consumerDefinition.microSystemId),
      ).toBe("RUNNING");
      expect(consumerActivations).toBe(1);
      expect(composition.supervisor.capabilities.resolve(requirement)?.providerId).toBe(
        createProviderId("provider.capability-low"),
      );
      expect(composition.supervisor.evaluateReadiness(profile).state).toBe("READY");

      await composition.supervisor.reconcile(desired([consumerDefinition]));
      expect(
        composition.supervisor.getActualState(consumerDefinition.microSystemId),
      ).toBe("RUNNING");
      expect(consumerActivations).toBe(1);
      expect(composition.supervisor.evaluateReadiness(profile).state).toBe("BLOCKED");

      await composition.supervisor.reconcile(
        desired(
          [lowProvider, consumerDefinition],
          "NORMAL",
          new Map(),
          new Map([[capabilityId, createProviderId("provider.capability-high")]]),
        ),
      );
      expect(composition.supervisor.evaluateReadiness(profile).state).toBe("BLOCKED");
      expect(
        composition.supervisor.capabilities.resolve(
          requirement,
          createProviderId("provider.capability-high"),
        ),
      ).toBeUndefined();
    } finally {
      await closeComposition(fixture, composition);
    }
  }, 180_000);

  it("completes only the current Activity, idempotently, without wall-clock ordering", async () => {
    const fixture = await makeFixture();
    const productGenerationId = testProductGenerationId();
    const serviceId = createServiceId("runtime.integration.completion");
    const composition = await createComposition(fixture, productGenerationId, [
      provider("completion-provider", productGenerationId, serviceId),
    ]);

    try {
      await composition.runtime.runActivity(
        {
          kind: "runtime.completion.test",
          importance: "significant",
          retentionClass: "retained",
          sensitivity: "operational",
        },
        async (activity) => {
          const endedAt = parseInstant("2020-01-01T00:00:00.000Z")!;
          await composition.persistence.mutate((transaction) =>
            composition.lineage.retainCurrent(transaction, activity),
          );
          await composition.persistence.mutate((transaction) =>
            composition.lineage.completeCurrent(transaction, activity, {
              endedAt,
              outcome: "SUCCEEDED",
            }),
          );
          const mismatchedOriginActivity = {
            ...activity,
            origin: {
              ...activity.origin,
              runtime: {
                productGenerationId: asContentDigest(
                  "ProductGenerationId",
                  digestCanonicalJson("runtime.integration.other-generation/v1", {
                    generation: "other",
                  }),
                ),
              },
            },
          };
          await expect(
            composition.persistence.mutate((transaction) =>
              composition.lineage.completeCurrent(
                transaction,
                mismatchedOriginActivity,
                {
                  endedAt,
                  outcome: "SUCCEEDED",
                },
              ),
            ),
          ).rejects.toMatchObject({
            problem: { problemCode: "lineage.persistence.origin_mismatch" },
          });
          await composition.persistence.mutate((transaction) =>
            composition.lineage.completeCurrent(transaction, activity, {
              endedAt,
              outcome: "SUCCEEDED",
            }),
          );
          await expect(
            composition.persistence.mutate((transaction) =>
              composition.lineage.completeCurrent(transaction, activity, {
                endedAt,
                outcome: "FAILED",
              }),
            ),
          ).rejects.toMatchObject({
            problem: { problemCode: "lineage.persistence.completion_conflict" },
          });
        },
      );

      const row = await queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        `SELECT ended_at, outcome
           FROM "heptalogos"."activity_record"
          WHERE kind = 'runtime.completion.test'`,
      );
      expect(row.rows).toEqual([expect.objectContaining({ outcome: "SUCCEEDED" })]);
    } finally {
      await closeComposition(fixture, composition);
    }
  }, 180_000);

  it("isolates provider failure, preserves mode Desired State, and shuts down scopes", async () => {
    const fixture = await makeFixture();
    const productGenerationId = testProductGenerationId();
    const serviceId = createServiceId("runtime.integration.failure");
    let rejectWorker!: (reason: unknown) => void;
    const worker = new Promise<void>((_resolve, reject) => {
      rejectWorker = reject;
    });
    const a = provider("failure", productGenerationId, serviceId, async (context) => {
      context.publishService(
        {
          serviceId,
          providerId: createProviderId("provider.failure"),
          contractVersion: contractV1,
        },
        { read: () => "failure" },
      );
      context.scope.track("worker", worker);
    });
    const b = consumer(
      "dependent",
      productGenerationId,
      serviceId,
      async () => undefined,
    );
    const safeOnly = independent("safe-only", productGenerationId, ["NORMAL"]);
    const shutdownEvents: string[] = [];
    const c = independent(
      "independent",
      productGenerationId,
      ["NORMAL", "SAFE"],
      async (context) => {
        context.scope.defer("independent-dispose", () => {
          shutdownEvents.push("independent");
        });
      },
    );
    const composition = await createComposition(fixture, productGenerationId, [
      a,
      b,
      safeOnly,
      c,
    ]);

    try {
      const initialDesired = desired([a, b, safeOnly, c]);
      await composition.supervisor.reconcile(initialDesired);
      await composition.supervisor.reconcile(desired([a, b, safeOnly, c], "SAFE"));
      expect(composition.supervisor.getActualState(safeOnly.microSystemId)).toBe(
        "BLOCKED",
      );
      expect(initialDesired.desired.get(safeOnly.microSystemId)).toBe("RUNNING");
      expect(composition.supervisor.getActualState(c.microSystemId)).toBe("RUNNING");

      rejectWorker(new Error("background failure"));
      await new Promise((resolve) => setTimeout(resolve, 20));
      await expect(
        composition.supervisor.reconcile(desired([a, b, safeOnly, c], "SAFE")),
      ).rejects.toBeDefined();
      expect(composition.supervisor.getActualState(b.microSystemId)).toBe("BLOCKED");
      expect(composition.supervisor.getActualState(c.microSystemId)).toBe("RUNNING");

      await expect(
        composition.supervisor.reconcile(desired([a, b, safeOnly, c], "NORMAL")),
      ).rejects.toBeDefined();
      expect(composition.supervisor.getActualState(safeOnly.microSystemId)).toBe(
        "RUNNING",
      );
      await composition.supervisor.close();
      expect(shutdownEvents).toEqual(["independent"]);
    } finally {
      await closeComposition(fixture, composition);
    }
  }, 180_000);
});
