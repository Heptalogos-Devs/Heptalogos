// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  asContentDigest,
  createCapabilityId,
  createContributionId,
  createMicroSystemId,
  createWorkItemId,
  createProviderId,
  createServiceId,
  digestCanonicalJson,
  type CapabilityId,
  type ProviderId,
  type ServiceId,
} from "@heptalogos/foundation-contracts";
import {
  createRuntimeSubstrate,
  type RuntimeSubstrate,
} from "@heptalogos/runtime-substrate";
import {
  createContractVersion,
  evaluateReadiness,
  exactContract,
  MicroSystemSupervisor,
  type RuntimeLifecycleLineage,
  type MicroSystemDesiredState,
  type MicroSystemDefinition,
  type CapabilityProvisionDescriptor,
  type CapabilityRequirement,
  type ServiceProvisionDescriptor,
  type RuntimeGenerationRef,
  type WorkHandlerProvisionDescriptor,
} from "../../src/index.js";

const contractV1 = createContractVersion("v1");
const contractV2 = createContractVersion("v2");
const generation = {
  productGenerationId: asContentDigest(
    "ProductGenerationId",
    digestCanonicalJson("supervisor-test-generation/v1", { id: "test" }),
  ),
};
const workHandlerGeneration: RuntimeGenerationRef = {
  ...generation,
  packageGenerationId: asContentDigest(
    "PackageGenerationId",
    digestCanonicalJson("supervisor-test-package/v1", { id: "work-handler" }),
  ),
};

function workHandlerDescriptor(
  contributionId = createContributionId("system.work-handler.execute"),
): WorkHandlerProvisionDescriptor {
  return {
    contributionId,
    contractVersion: contractV1,
    payloadContracts: [
      {
        version: 1,
        schema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
          additionalProperties: false,
        },
      },
    ],
    outcomeSchema: {
      type: "object",
      properties: { accepted: { type: "boolean" } },
      required: ["accepted"],
      additionalProperties: false,
    },
    queueProfileId: "work.default" as never,
    resourceAdmissionClass: "work.default" as never,
    configurationBindingPolicy: "LATEST_COMPATIBLE_AT_ATTEMPT",
    restoreReplayClass: "RECONCILE_REQUIRED",
  };
}

function serviceRequirement(serviceId: ServiceId) {
  return { serviceId, contract: exactContract(contractV1) };
}

function serviceProvision(
  serviceId: ServiceId,
  providerId: ProviderId,
  contractVersion: typeof contractV1 = contractV1,
): ServiceProvisionDescriptor {
  return { serviceId, providerId, contractVersion };
}

function capabilityRequirement(
  capabilityId: CapabilityId,
  required = false,
): CapabilityRequirement {
  return { capabilityId, contract: exactContract(contractV1), required };
}

function capabilityProvision(
  capabilityId: CapabilityId,
  providerId: ProviderId,
  priority = 0,
): CapabilityProvisionDescriptor {
  return { capabilityId, providerId, contractVersion: contractV1, priority };
}

function desired(
  systems: readonly MicroSystemDefinition[],
  operatingMode: "NORMAL" | "SAFE" = "NORMAL",
  serviceBindings = new Map<ServiceId, ProviderId>(),
  capabilityBindings = new Map(),
) {
  return {
    revision: 1,
    operatingMode,
    desired: new Map<MicroSystemDefinition["microSystemId"], MicroSystemDesiredState>(
      systems.map((system) => [system.microSystemId, "RUNNING" as const]),
    ),
    serviceBindings,
    capabilityBindings,
  };
}

function system(
  id: string,
  activate: MicroSystemDefinition["activate"],
  options: Partial<
    Pick<
      MicroSystemDefinition,
      | "operatingModes"
      | "serviceRequirements"
      | "serviceProvisions"
      | "capabilityRequirements"
      | "capabilityProvisions"
    >
  > & {
    readonly generation?: RuntimeGenerationRef;
    readonly workHandlerProvisions?: readonly WorkHandlerProvisionDescriptor[];
  } = {},
): MicroSystemDefinition {
  return {
    microSystemId: createMicroSystemId(id),
    role: "provider",
    generation: options.generation ?? generation,
    operatingModes: options.operatingModes ?? ["NORMAL", "SAFE"],
    serviceRequirements: options.serviceRequirements ?? [],
    capabilityRequirements: options.capabilityRequirements ?? [],
    serviceProvisions: options.serviceProvisions ?? [],
    capabilityProvisions: options.capabilityProvisions ?? [],
    ...(options.workHandlerProvisions
      ? { workHandlerProvisions: options.workHandlerProvisions }
      : {}),
    activate,
  };
}

function provider(
  id: string,
  serviceId: ServiceId,
  activate: MicroSystemDefinition["activate"] = async (context) => {
    context.publishService(
      serviceProvision(serviceId, createProviderId(`provider.${id}`)),
      {
        read: () => id,
      },
    );
  },
): MicroSystemDefinition {
  const providerId = createProviderId(`provider.${id}`);
  const descriptor = serviceProvision(serviceId, providerId);
  return system(`system.${id}`, activate, { serviceProvisions: [descriptor] });
}

function consumer(
  id: string,
  serviceId: ServiceId,
  activate: MicroSystemDefinition["activate"] = async (context) => {
    const lease = context.requireService<{ read(): string }>(
      serviceRequirement(serviceId),
    );
    await lease.invoke("read", (service) => service.read());
  },
): MicroSystemDefinition {
  return system(`system.${id}`, activate, {
    serviceRequirements: [serviceRequirement(serviceId)],
  });
}

function createSupervisorWithSubstrate(
  definitions: readonly MicroSystemDefinition[],
  substrate: RuntimeSubstrate,
) {
  return new MicroSystemSupervisor({
    substrate,
    settleTimeoutMs: 50,
    definitions,
  });
}

function createSupervisor(definitions: readonly MicroSystemDefinition[]) {
  return createSupervisorWithSubstrate(
    definitions,
    createRuntimeSubstrate({ settleTimeoutMs: 50 }),
  );
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe("MicroSystemSupervisor and RuntimeReconciler", () => {
  it("publishes a declared WorkHandler and retires its generation-bound lease", async () => {
    const descriptor = workHandlerDescriptor();
    const definition = system(
      "work-handler",
      async (context) => {
        context.publishWorkHandler(descriptor, {
          async execute() {
            return { outcome: { accepted: true } };
          },
        });
      },
      {
        generation: workHandlerGeneration,
        workHandlerProvisions: [descriptor],
      },
    );
    const supervisor = createSupervisor([definition]);
    const target = {
      productGenerationId: workHandlerGeneration.productGenerationId,
      microSystemId: definition.microSystemId,
      contributionId: descriptor.contributionId,
      packageGenerationId: workHandlerGeneration.packageGenerationId!,
      payloadVersion: 1,
    };

    try {
      await supervisor.reconcile(desired([definition]));
      const lease = supervisor.workHandlers.resolve(target);
      expect(lease).toBeDefined();
      await expect(
        lease!.reserveInvocation().execute({
          workItemId: createWorkItemId(),
          dispatchRevision: 1,
          payloadVersion: 1,
          payload: { value: "ok" },
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ outcome: { accepted: true } });
      expect(supervisor.workHandlers.size()).toBe(1);
    } finally {
      await supervisor.close();
    }

    expect(supervisor.workHandlers.resolve(target)).toBeUndefined();
  });

  it("matches WorkHandler declarations by canonical structure and payload version", async () => {
    const declared = workHandlerDescriptor();
    const declaredPayloadV1 = declared.payloadContracts[0]!;
    const declaredPayloadV2 = {
      version: 2,
      schema: {
        type: "object",
        properties: { count: { type: "integer" } },
        required: ["count"],
        additionalProperties: false,
      },
    };
    const published: WorkHandlerProvisionDescriptor = {
      ...declared,
      payloadContracts: [
        {
          version: declaredPayloadV2.version,
          schema: {
            required: ["count"],
            additionalProperties: false,
            properties: { count: { type: "integer" } },
            type: "object",
          },
        },
        {
          version: declaredPayloadV1.version,
          schema: {
            required: ["value"],
            additionalProperties: false,
            properties: { value: { type: "string" } },
            type: "object",
          },
        },
      ],
      outcomeSchema: {
        required: ["accepted"],
        additionalProperties: false,
        properties: { accepted: { type: "boolean" } },
        type: "object",
      },
    };
    const definition = system(
      "canonical-work-handler",
      async (context) => {
        context.publishWorkHandler(published, {
          async execute() {
            return { outcome: { accepted: true } };
          },
        });
      },
      {
        generation: workHandlerGeneration,
        workHandlerProvisions: [
          {
            ...declared,
            payloadContracts: [declaredPayloadV1, declaredPayloadV2],
          },
        ],
      },
    );
    const supervisor = createSupervisor([definition]);

    try {
      await supervisor.reconcile(desired([definition]));
      expect(
        supervisor.workHandlers.resolve({
          productGenerationId: workHandlerGeneration.productGenerationId,
          microSystemId: definition.microSystemId,
          contributionId: declared.contributionId,
          packageGenerationId: workHandlerGeneration.packageGenerationId!,
          payloadVersion: 2,
        }),
      ).toBeDefined();
    } finally {
      await supervisor.close();
    }
  });

  it("starts provider before dependent and keeps independent systems running", async () => {
    const serviceId = createServiceId("test.x");
    const a = provider("a", serviceId);
    const b = consumer("b", serviceId);
    const c = system("system.c", async () => undefined);
    const supervisor = createSupervisor([a, b, c]);
    try {
      await supervisor.reconcile(desired([a, b, c]));
      expect(supervisor.getActualState(a.microSystemId)).toBe("RUNNING");
      expect(supervisor.getActualState(b.microSystemId)).toBe("RUNNING");
      expect(supervisor.getActualState(c.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("leaves a missing hard Service consumer BLOCKED", async () => {
    const b = consumer("b", createServiceId("test.missing"));
    const supervisor = createSupervisor([b]);
    try {
      const plan = await supervisor.reconcile(desired([b]));
      expect(plan.blocked.get(b.microSystemId)).toBe("runtime.service.missing");
      expect(supervisor.getActualState(b.microSystemId)).toBe("BLOCKED");
    } finally {
      await supervisor.close();
    }
  });

  it("adding a provider later starts the consumer without changing Desired State", async () => {
    const serviceId = createServiceId("test.later");
    const b = consumer("b", serviceId);
    const supervisor = createSupervisor([b]);
    const firstDesired = desired([b]);
    try {
      await supervisor.reconcile(firstDesired);
      const a = provider("a", serviceId);
      supervisor.register(a);
      await supervisor.reconcile(desired([a, b]));
      expect(supervisor.getActualState(b.microSystemId)).toBe("RUNNING");
      expect(firstDesired.desired.get(b.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("replaces a hard Service provider by stopping and restarting dependents", async () => {
    const serviceId = createServiceId("test.replace");
    let bActivations = 0;
    const a = provider("a", serviceId);
    const b = consumer("b", serviceId, async (context) => {
      bActivations += 1;
      await context
        .requireService<{ read(): string }>(serviceRequirement(serviceId))
        .invoke("read", (service) => service.read());
    });
    const d = provider("d", serviceId);
    const supervisor = createSupervisor([a, b, d]);
    try {
      await supervisor.reconcile(desired([a, b]));
      const replacementPlan = await supervisor.reconcile(
        desired(
          [b, d],
          "NORMAL",
          new Map([[serviceId, createProviderId("provider.d")]]),
        ),
      );
      expect(replacementPlan.actions).toContainEqual({
        kind: "START",
        microSystemId: b.microSystemId,
        reason: "desired-running",
      });
      expect(supervisor.getActualState(a.microSystemId)).toBe("STOPPED");
      expect(supervisor.getActualState(d.microSystemId)).toBe("RUNNING");
      expect(supervisor.getActualState(b.microSystemId)).toBe("RUNNING");
      expect(bActivations).toBe(2);
    } finally {
      await supervisor.close();
    }
  });

  it("releases an explicit Service binding when the desired snapshot removes it", async () => {
    const serviceId = createServiceId("test.binding-removal");
    let bActivations = 0;
    const reads: string[] = [];
    const a = provider("a", serviceId);
    const b = consumer("b", serviceId, async (context) => {
      bActivations += 1;
      const value = await context
        .requireService<{ read(): string }>(serviceRequirement(serviceId))
        .invoke("read", (service) => service.read());
      reads.push(value);
    });
    const d = provider("d", serviceId);
    const supervisor = createSupervisor([a, b, d]);
    try {
      await supervisor.reconcile(
        desired(
          [a, b],
          "NORMAL",
          new Map([[serviceId, createProviderId("provider.a")]]),
        ),
      );
      await supervisor.reconcile(desired([b, d]));

      expect(supervisor.getActualState(d.microSystemId)).toBe("RUNNING");
      expect(supervisor.getActualState(b.microSystemId)).toBe("RUNNING");
      expect(bActivations).toBe(2);
      expect(reads.at(-1)).toBe("d");
    } finally {
      await supervisor.close();
    }
  });

  it("uses the Desired Service binding during consumer activation", async () => {
    const serviceId = createServiceId("test.desired-service-binding");
    const reads: string[] = [];
    const a = provider("a", serviceId);
    const d = provider("d", serviceId);
    const b = consumer("b", serviceId, async (context) => {
      const value = await context
        .requireService<{ read(): string }>(serviceRequirement(serviceId))
        .invoke("read", (service) => service.read());
      reads.push(value);
    });
    const supervisor = createSupervisor([a, b, d]);
    try {
      await supervisor.reconcile(
        desired(
          [a, b, d],
          "NORMAL",
          new Map([[serviceId, createProviderId("provider.d")]]),
        ),
      );

      expect(supervisor.getActualState(b.microSystemId)).toBe("RUNNING");
      expect(reads).toEqual(["d"]);
    } finally {
      await supervisor.close();
    }
  });

  it("restarts a dependent when an implicit Service provider is replaced", async () => {
    const serviceId = createServiceId("test.implicit-service-replacement");
    let bActivations = 0;
    const reads: string[] = [];
    const a = provider("a", serviceId);
    const d = provider("d", serviceId);
    const b = consumer("b", serviceId, async (context) => {
      bActivations += 1;
      const value = await context
        .requireService<{ read(): string }>(serviceRequirement(serviceId))
        .invoke("read", (service) => service.read());
      reads.push(value);
    });
    const supervisor = createSupervisor([a, b, d]);
    try {
      await supervisor.reconcile(desired([a, b]));
      await supervisor.reconcile(desired([b, d]));

      expect(supervisor.getActualState(a.microSystemId)).toBe("STOPPED");
      expect(supervisor.getActualState(d.microSystemId)).toBe("RUNNING");
      expect(supervisor.getActualState(b.microSystemId)).toBe("RUNNING");
      expect(bActivations).toBe(2);
      expect(reads).toEqual(["a", "d"]);
    } finally {
      await supervisor.close();
    }
  });

  it("blocks a dependent when a replaced provider generation cannot drain", async () => {
    const serviceId = createServiceId("test.replacement-timeout");
    const started = deferred<void>();
    const released = deferred<string>();
    let holdNextCall = false;
    const a = provider("replacement-timeout-a", serviceId, async (context) => {
      context.publishService(
        serviceProvision(serviceId, createProviderId("provider.replacement-timeout-a")),
        {
          async read() {
            if (!holdNextCall) return "a";
            holdNextCall = false;
            started.resolve();
            return released.promise;
          },
        },
      );
    });
    const b = consumer("replacement-timeout-b", serviceId);
    const d = provider("replacement-timeout-d", serviceId);
    const c = system("system.replacement-timeout-independent", async () => undefined);
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 5 }),
      settleTimeoutMs: 5,
      definitions: [a, b, d, c],
    });

    try {
      await supervisor.reconcile(desired([a, b, d, c]));
      holdNextCall = true;
      const lease = supervisor.services.resolve<{ read(): Promise<string> }>(
        serviceRequirement(serviceId),
        createProviderId("provider.replacement-timeout-a"),
      );
      const oldCall = lease.invoke("held-call", (service) => service.read());
      await started.promise;

      await expect(
        supervisor.reconcile(
          desired(
            [b, d, c],
            "NORMAL",
            new Map([[serviceId, createProviderId("provider.replacement-timeout-d")]]),
          ),
        ),
      ).rejects.toMatchObject({
        problem: expect.objectContaining({
          problemCode: "runtime.generation.settlement_timeout",
        }),
      });
      expect(supervisor.getActualState(d.microSystemId)).toBe("RUNNING");
      expect(supervisor.getActualState(b.microSystemId)).toBe("BLOCKED");
      expect(supervisor.getActualState(c.microSystemId)).toBe("RUNNING");

      released.resolve("late");
      await expect(oldCall).resolves.toBe("late");
    } finally {
      released.resolve("cleanup");
      await supervisor.close();
    }
  });

  it("reports unresolved generation retirement instead of resolving close", async () => {
    const serviceId = createServiceId("test.close-retirement-timeout");
    const started = deferred<void>();
    const released = deferred<string>();
    const providerDefinition = provider(
      "close-retirement-timeout",
      serviceId,
      async (context) => {
        context.publishService(
          serviceProvision(
            serviceId,
            createProviderId("provider.close-retirement-timeout"),
          ),
          {
            async read() {
              started.resolve();
              return released.promise;
            },
          },
        );
      },
    );
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 5 }),
      settleTimeoutMs: 5,
      definitions: [providerDefinition],
    });

    const serviceCall = {
      promise: undefined as Promise<string> | undefined,
    };
    try {
      await supervisor.reconcile(desired([providerDefinition]));
      const lease = supervisor.services.resolve<{ read(): Promise<string> }>(
        serviceRequirement(serviceId),
      );
      serviceCall.promise = lease.invoke("held-close-call", (service) =>
        service.read(),
      );
      await started.promise;

      await expect(supervisor.close()).rejects.toMatchObject({
        problem: expect.objectContaining({
          problemCode: "runtime.supervisor.close_failed",
        }),
      });
      released.resolve("late");
      await expect(serviceCall.promise).resolves.toBe("late");
    } finally {
      released.resolve("cleanup");
    }
  });

  it("reports substrate shutdown failures instead of resolving close", async () => {
    const definition = system("system.close-failure", async () => undefined);
    const supervisor = createSupervisorWithSubstrate([definition], {
      async activate() {
        return {
          state: "ACTIVE",
          dispose: async () => undefined,
        };
      },
      close: async () => {
        throw new Error("substrate close failed");
      },
    });

    await supervisor.reconcile(desired([definition]));
    await expect(supervisor.close()).rejects.toMatchObject({
      problem: expect.objectContaining({
        problemCode: "runtime.supervisor.close_failed",
      }),
    });
  });

  it("uses the exact selected Service binding when one MicroSystem has multiple bindings", async () => {
    const serviceId = createServiceId("test.multiple-bindings.one-system");
    const providerA = createProviderId("provider.multiple-bindings.a");
    const providerB = createProviderId("provider.multiple-bindings.b");
    const reads: string[] = [];
    const providerDefinition = system(
      "system.multiple-bindings-provider",
      async (context) => {
        context.publishService(serviceProvision(serviceId, providerA), {
          read: () => "v1",
        });
        context.publishService(serviceProvision(serviceId, providerB, contractV2), {
          read: () => "v2",
        });
      },
      {
        serviceProvisions: [
          serviceProvision(serviceId, providerA),
          serviceProvision(serviceId, providerB, contractV2),
        ],
      },
    );
    const consumerDefinition = system(
      "system.multiple-bindings-consumer",
      async (context) => {
        const lease = context.requireService<{ read(): string }>({
          serviceId,
          contract: exactContract(contractV2),
        });
        reads.push(await lease.invoke("read", (service) => service.read()));
      },
      {
        serviceRequirements: [{ serviceId, contract: exactContract(contractV2) }],
      },
    );
    const supervisor = createSupervisor([providerDefinition, consumerDefinition]);

    try {
      const plan = await supervisor.reconcile(
        desired([providerDefinition, consumerDefinition]),
      );
      expect(plan.serviceBindings.get(serviceId)).toBe(providerB);
      expect(reads).toEqual(["v2"]);
      expect(supervisor.getActualState(consumerDefinition.microSystemId)).toBe(
        "RUNNING",
      );
    } finally {
      await supervisor.close();
    }
  });

  it("forgets a removed explicit Capability binding before reintroducing it", async () => {
    const capabilityId = createCapabilityId("test.binding-removal");
    const providerId = createProviderId("provider.capability");
    const definition = system("system.capability-binding", async () => undefined);
    const supervisor = createSupervisor([definition]);
    const binding = new Map([[capabilityId, providerId]]);
    try {
      await supervisor.reconcile(desired([definition], "NORMAL", new Map(), binding));
      await supervisor.reconcile(desired([definition]));
      const reintroduced = await supervisor.reconcile(
        desired([definition], "NORMAL", new Map(), binding),
      );

      expect(reintroduced.actions).toContainEqual({
        kind: "REBIND_CAPABILITY",
        capabilityId,
        providerId,
      });
    } finally {
      await supervisor.close();
    }
  });

  it("applies a removed Capability binding before a same-reconcile restart", async () => {
    const serviceId = createServiceId("test.capability-unbind.service");
    const capabilityId = createCapabilityId("test.capability-unbind.capability");
    const serviceProviderA = provider("capability-unbind-a", serviceId);
    const serviceProviderD = provider("capability-unbind-d", serviceId);
    const capabilityProviderA = system(
      "system.a-capability",
      async (context) => {
        context.publishCapability(
          capabilityProvision(capabilityId, createProviderId("provider.capability-a")),
          { read: () => "a" },
        );
      },
      {
        capabilityProvisions: [
          capabilityProvision(capabilityId, createProviderId("provider.capability-a")),
        ],
      },
    );
    const capabilityProviderB = system(
      "system.b-capability",
      async (context) => {
        context.publishCapability(
          capabilityProvision(capabilityId, createProviderId("provider.capability-b")),
          { read: () => "b" },
        );
      },
      {
        capabilityProvisions: [
          capabilityProvision(capabilityId, createProviderId("provider.capability-b")),
        ],
      },
    );
    const reads: string[] = [];
    const consumerDefinition = system(
      "system.z-capability-consumer",
      async (context) => {
        await context
          .requireService<{ read(): string }>(serviceRequirement(serviceId))
          .invoke("read", (service) => service.read());
        const lease = context.resolveCapability<{ read(): string }>(
          capabilityRequirement(capabilityId),
        );
        reads.push(
          lease === undefined
            ? "missing"
            : await lease.invoke("read", (capability) => capability.read()),
        );
      },
      {
        serviceRequirements: [serviceRequirement(serviceId)],
        capabilityRequirements: [capabilityRequirement(capabilityId)],
      },
    );
    const supervisor = createSupervisor([
      serviceProviderA,
      serviceProviderD,
      capabilityProviderA,
      capabilityProviderB,
      consumerDefinition,
    ]);

    try {
      await supervisor.reconcile(
        desired(
          [
            serviceProviderA,
            serviceProviderD,
            capabilityProviderA,
            capabilityProviderB,
            consumerDefinition,
          ],
          "NORMAL",
          new Map([[serviceId, createProviderId("provider.capability-unbind-a")]]),
          new Map([[capabilityId, createProviderId("provider.capability-a")]]),
        ),
      );
      const replacementPlan = await supervisor.reconcile(
        desired(
          [serviceProviderD, capabilityProviderB, consumerDefinition],
          "NORMAL",
          new Map([[serviceId, createProviderId("provider.capability-unbind-d")]]),
        ),
      );

      expect(replacementPlan.actions).toContainEqual({
        kind: "REBIND_CAPABILITY",
        capabilityId,
        providerId: undefined,
      });
      expect(reads).toEqual(["a", "b"]);
      expect(supervisor.getActualState(consumerDefinition.microSystemId)).toBe(
        "RUNNING",
      );
    } finally {
      await supervisor.close();
    }
  });

  it("keeps first activation RUNNING when an explicit Capability is unavailable", async () => {
    const capabilityId = createCapabilityId("test.first-activation-capability");
    const availableProviderId = createProviderId("provider.available-capability");
    const missingProviderId = createProviderId("provider.missing-capability");
    let resolved: unknown = "not-run";
    const providerDefinition = system(
      "system.a-available-capability",
      async (context) => {
        context.publishCapability(
          capabilityProvision(capabilityId, availableProviderId),
          { read: () => "available" },
        );
      },
      {
        capabilityProvisions: [capabilityProvision(capabilityId, availableProviderId)],
      },
    );
    const consumerDefinition = system(
      "system.z-required-capability-consumer",
      async (context) => {
        resolved = context.resolveCapability<{ read(): string }>(
          capabilityRequirement(capabilityId, true),
        );
      },
      {
        capabilityRequirements: [capabilityRequirement(capabilityId, true)],
      },
    );
    const supervisor = createSupervisor([providerDefinition, consumerDefinition]);
    const requirement = capabilityRequirement(capabilityId, true);

    try {
      await supervisor.reconcile(
        desired(
          [providerDefinition, consumerDefinition],
          "NORMAL",
          new Map(),
          new Map([[capabilityId, missingProviderId]]),
        ),
      );

      expect(resolved).toBeUndefined();
      expect(supervisor.getActualState(consumerDefinition.microSystemId)).toBe(
        "RUNNING",
      );
      expect(
        evaluateReadiness(
          {
            profileId: "required-capability",
            requiredServices: [],
            requiredCapabilities: [requirement],
            optionalCapabilities: [],
          },
          supervisor.services,
          supervisor.capabilities,
          new Map(),
          new Map([[capabilityId, missingProviderId]]),
        ).state,
      ).toBe("BLOCKED");
    } finally {
      await supervisor.close();
    }
  });

  it("evaluates Readiness from the Supervisor's authoritative binding maps", async () => {
    const capabilityId = createCapabilityId("test.authoritative-readiness");
    const availableProviderId = createProviderId("provider.authoritative-available");
    const unavailableProviderId = createProviderId(
      "provider.authoritative-unavailable",
    );
    const providerDefinition = system(
      "system.authoritative-readiness-provider",
      async (context) => {
        context.publishCapability(
          capabilityProvision(capabilityId, availableProviderId),
          { read: () => "available" },
        );
      },
      {
        capabilityProvisions: [capabilityProvision(capabilityId, availableProviderId)],
      },
    );
    const supervisor = createSupervisor([providerDefinition]);

    try {
      await supervisor.reconcile(
        desired(
          [providerDefinition],
          "NORMAL",
          new Map(),
          new Map([[capabilityId, unavailableProviderId]]),
        ),
      );

      expect(
        supervisor.evaluateReadiness({
          profileId: "authoritative-readiness",
          requiredServices: [],
          requiredCapabilities: [capabilityRequirement(capabilityId, true)],
          optionalCapabilities: [],
        }).state,
      ).toBe("BLOCKED");
    } finally {
      await supervisor.close();
    }
  });

  it("retains explicit Service Readiness authority without a hard graph edge", async () => {
    const serviceId = createServiceId("test.authoritative-service-readiness");
    const providerA = createProviderId("provider.authoritative-service-a");
    const providerD = createProviderId("provider.authoritative-service-d");
    const missingProvider = createProviderId("provider.authoritative-service-missing");
    const providerDefinitionA = system(
      "system.authoritative-service-a",
      async (context) => {
        context.publishService(serviceProvision(serviceId, providerA), {
          read: () => "a",
        });
      },
      { serviceProvisions: [serviceProvision(serviceId, providerA)] },
    );
    const providerDefinitionD = system(
      "system.authoritative-service-d",
      async (context) => {
        context.publishService(serviceProvision(serviceId, providerD), {
          read: () => "d",
        });
      },
      { serviceProvisions: [serviceProvision(serviceId, providerD)] },
    );
    const profile = {
      profileId: "authoritative-service-readiness",
      requiredServices: [serviceRequirement(serviceId)],
      requiredCapabilities: [],
      optionalCapabilities: [],
    };
    const supervisor = createSupervisor([providerDefinitionA, providerDefinitionD]);

    try {
      await supervisor.reconcile(
        desired(
          [providerDefinitionA, providerDefinitionD],
          "NORMAL",
          new Map([[serviceId, providerA]]),
        ),
      );
      expect(supervisor.evaluateReadiness(profile).state).toBe("READY");

      await supervisor.reconcile(desired([providerDefinitionA, providerDefinitionD]));
      expect(supervisor.evaluateReadiness(profile).state).toBe("BLOCKED");

      await supervisor.reconcile(
        desired(
          [providerDefinitionA, providerDefinitionD],
          "NORMAL",
          new Map([[serviceId, missingProvider]]),
        ),
      );
      expect(supervisor.evaluateReadiness(profile).state).toBe("BLOCKED");
    } finally {
      await supervisor.close();
    }
  });

  it("isolates a provider activation failure from an independent branch", async () => {
    const serviceId = createServiceId("test.failure");
    let bActivations = 0;
    const a = provider("a", serviceId, async () => {
      throw new Error("provider activation failed");
    });
    const b = consumer("b", serviceId, async (context) => {
      bActivations += 1;
      await context
        .requireService<{ read(): string }>(serviceRequirement(serviceId))
        .invoke("read", (service) => service.read());
    });
    const c = system("system.c", async () => undefined);
    const supervisor = createSupervisor([a, b, c]);
    try {
      await expect(supervisor.reconcile(desired([a, b, c]))).rejects.toBeDefined();
      expect(supervisor.getActualState(a.microSystemId)).toBe("FAILED");
      expect(supervisor.getActualState(b.microSystemId)).toBe("BLOCKED");
      expect(bActivations).toBe(0);
      expect(supervisor.getActualState(c.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("records a lifecycle failure when activation fails", async () => {
    const events: string[] = [];
    const lifecycleLineage = {
      runner: () => ({
        current: () => undefined,
        runActivity: async <T>(
          _request: never,
          operation: (context: never) => Promise<T>,
        ) => operation(undefined as never),
      }),
      runRetained: async <T>(
        _origin: never,
        request: { kind: string },
        operation: (context: never) => Promise<T>,
      ) => {
        events.push(request.kind);
        return operation(undefined as never);
      },
    } as unknown as RuntimeLifecycleLineage;
    const failing = system("system.lifecycle-failure", async () => {
      throw new Error("activation failed");
    });
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [failing],
      lifecycleLineage,
    });

    try {
      await expect(supervisor.reconcile(desired([failing]))).rejects.toBeDefined();
      expect(events).toContain("runtime.lifecycle.failure");
    } finally {
      await supervisor.close();
    }
  });

  it("records a retained lifecycle failure for a post-activation background crash", async () => {
    const events: Array<{ kind: string; microSystemId?: unknown }> = [];
    const lifecycleLineage = {
      runner: () => ({
        current: () => undefined,
        runActivity: async <T>(
          _request: never,
          operation: (context: never) => Promise<T>,
        ) => operation(undefined as never),
      }),
      runRetained: async <T>(
        origin: { microSystemId?: unknown },
        request: { kind: string },
        operation: (context: never) => Promise<T>,
      ) => {
        events.push({ kind: request.kind, microSystemId: origin.microSystemId });
        return operation(undefined as never);
      },
    } as unknown as RuntimeLifecycleLineage;
    const background = new Promise<void>((_resolve, reject) => {
      setTimeout(() => reject(new Error("post-activation background failure")), 0);
    });
    const failing = system(
      "system.post-activation-background-failure",
      async (context) => {
        context.scope.track("worker", background);
      },
    );
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [failing],
      lifecycleLineage,
    });

    try {
      await supervisor.reconcile(desired([failing]));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(supervisor.getActualState(failing.microSystemId)).toBe("FAILED");
      expect(
        events.some(
          (event) =>
            event.kind === "runtime.lifecycle.failure" &&
            event.microSystemId === failing.microSystemId,
        ),
      ).toBe(true);
    } finally {
      await supervisor.close();
    }
  });

  it("compensates an activated system when lifecycle success completion fails", async () => {
    let activations = 0;
    let disposals = 0;
    const lifecycleLineage = {
      runner: () => ({
        current: () => undefined,
        runActivity: async <T>(
          _request: never,
          operation: (context: never) => Promise<T>,
        ) => operation(undefined as never),
      }),
      runRetained: async <T>(
        _origin: never,
        request: { kind: string },
        operation: (context: never) => Promise<T>,
      ) => {
        const result = await operation(undefined as never);
        if (request.kind === "runtime.lifecycle.activate") {
          throw new Error("activation completion persistence failed");
        }
        return result;
      },
    } as unknown as RuntimeLifecycleLineage;
    const systemDefinition = system(
      "system.activation-completion-failure",
      async (context) => {
        activations += 1;
        context.scope.defer("resource", () => {
          disposals += 1;
        });
      },
    );
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [systemDefinition],
      lifecycleLineage,
    });
    try {
      await expect(supervisor.reconcile(desired([systemDefinition]))).rejects.toThrow(
        "activation completion persistence failed",
      );
      expect(supervisor.getActualState(systemDefinition.microSystemId)).toBe("FAILED");
      expect(activations).toBe(1);
      expect(disposals).toBe(1);

      await expect(supervisor.reconcile(desired([systemDefinition]))).rejects.toThrow(
        "activation completion persistence failed",
      );
      expect(activations).toBe(2);
    } finally {
      await supervisor.close();
    }
  });

  it("preserves STOPPED when deactivation success completion persistence fails", async () => {
    let disposals = 0;
    const lifecycleLineage = {
      runner: () => ({
        current: () => undefined,
        runActivity: async <T>(
          _request: never,
          operation: (context: never) => Promise<T>,
        ) => operation(undefined as never),
      }),
      runRetained: async <T>(
        _origin: never,
        request: { kind: string },
        operation: (context: never) => Promise<T>,
      ) => {
        const result = await operation(undefined as never);
        if (request.kind === "runtime.lifecycle.deactivate") {
          throw new Error("deactivation completion persistence failed");
        }
        return result;
      },
    } as unknown as RuntimeLifecycleLineage;
    const systemDefinition = system(
      "system.deactivation-completion-failure",
      async (context) => {
        context.scope.defer("resource", () => {
          disposals += 1;
        });
      },
    );
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [systemDefinition],
      lifecycleLineage,
    });
    try {
      await supervisor.reconcile(desired([systemDefinition]));
      await expect(
        supervisor.reconcile({
          ...desired([systemDefinition]),
          desired: new Map([[systemDefinition.microSystemId, "STOPPED" as const]]),
        }),
      ).rejects.toThrow("deactivation completion persistence failed");
      expect(supervisor.getActualState(systemDefinition.microSystemId)).toBe("STOPPED");
      expect(disposals).toBe(1);
    } finally {
      await supervisor.close();
    }
  });

  it("tracks background failure and withdraws provider bindings", async () => {
    const serviceId = createServiceId("test.background");
    let rejectBackground!: (reason: unknown) => void;
    const background = new Promise<void>((_resolve, reject) => {
      rejectBackground = reject;
    });
    const a = provider("a", serviceId, async (context) => {
      context.scope.track("worker", background);
      context.publishService(
        serviceProvision(serviceId, createProviderId("provider.a")),
        {
          read: () => "a",
        },
      );
    });
    const b = consumer("b", serviceId);
    const c = system("system.c", async () => undefined);
    const supervisor = createSupervisor([a, b, c]);
    try {
      await supervisor.reconcile(desired([a, b, c]));
      rejectBackground(new Error("worker failed"));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(supervisor.getActualState(a.microSystemId)).toBe("FAILED");
      await expect(supervisor.reconcile(desired([a, b, c]))).rejects.toBeDefined();
      expect(supervisor.getActualState(b.microSystemId)).toBe("BLOCKED");
      expect(supervisor.getActualState(c.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("propagates background hard-Service failure through the transitive dependent closure", async () => {
    const serviceX = createServiceId("test.background-transitive.x");
    const serviceY = createServiceId("test.background-transitive.y");
    const providerAId = createProviderId("provider.background-transitive.a");
    const providerBId = createProviderId("provider.background-transitive.b");
    let rejectBackground!: (reason: unknown) => void;
    const background = new Promise<void>((_resolve, reject) => {
      rejectBackground = reject;
    });
    const a = system(
      "system.background-transitive-a",
      async (context) => {
        context.scope.track("worker", background);
        context.publishService(serviceProvision(serviceX, providerAId), {
          read: () => "x",
        });
      },
      { serviceProvisions: [serviceProvision(serviceX, providerAId)] },
    );
    const b = system(
      "system.background-transitive-b",
      async (context) => {
        await context
          .requireService<{ read(): string }>(serviceRequirement(serviceX))
          .invoke("read", (service) => service.read());
        context.publishService(serviceProvision(serviceY, providerBId), {
          read: () => "y",
        });
      },
      {
        serviceRequirements: [serviceRequirement(serviceX)],
        serviceProvisions: [serviceProvision(serviceY, providerBId)],
      },
    );
    const c = consumer("background-transitive-c", serviceY);
    const d = system("system.background-transitive-independent", async () => undefined);
    const supervisor = createSupervisor([a, b, c, d]);

    try {
      await supervisor.reconcile(desired([a, b, c, d]));
      rejectBackground(new Error("transitive worker failed"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(supervisor.getActualState(a.microSystemId)).toBe("FAILED");
      expect(supervisor.getActualState(b.microSystemId)).toBe("BLOCKED");
      expect(supervisor.getActualState(c.microSystemId)).toBe("BLOCKED");
      expect(supervisor.getActualState(d.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("recovers a failed provider and its dependent in one later reconcile", async () => {
    const serviceId = createServiceId("test.recover-failed-provider");
    let attempts = 0;
    const a = provider("recover-failed-provider", serviceId, async (context) => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient provider failure");
      context.publishService(
        serviceProvision(
          serviceId,
          createProviderId("provider.recover-failed-provider"),
        ),
        { read: () => "recovered" },
      );
    });
    const b = consumer("recover-failed-consumer", serviceId);
    const supervisor = createSupervisor([a, b]);

    try {
      await expect(supervisor.reconcile(desired([a, b]))).rejects.toBeDefined();
      expect(supervisor.getActualState(b.microSystemId)).toBe("BLOCKED");

      await supervisor.reconcile(desired([a, b]));

      expect(attempts).toBe(2);
      expect(supervisor.getActualState(a.microSystemId)).toBe("RUNNING");
      expect(supervisor.getActualState(b.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("handles capability changes without a hard consumer restart", async () => {
    const supervisor = createSupervisor([]);
    const capabilityId = createCapabilityId("test.dynamic");
    const providerId = createProviderId("provider.capability");
    try {
      const fence = supervisor.capabilities.register(
        {
          capabilityId,
          providerId,
          contractVersion: contractV1,
          priority: 0,
        },
        { read: () => "capability" },
      );
      expect(supervisor.capabilities.providerIds(capabilityId)).toEqual([providerId]);
      await supervisor.capabilities.retireGeneration(fence, 50);
      expect(supervisor.capabilities.providerIds(capabilityId)).toEqual([]);
    } finally {
      await supervisor.close();
    }
  });

  it("allows one MicroSystem to publish multiple bindings for one provider", async () => {
    const serviceA = createServiceId("test.multi-provider.service.a");
    const serviceB = createServiceId("test.multi-provider.service.b");
    const providerId = createProviderId("provider.multi-binding");
    const definition = system(
      "system.multi-binding",
      async (context) => {
        context.publishService(serviceProvision(serviceA, providerId), {
          read: () => "a",
        });
        context.publishService(serviceProvision(serviceB, providerId), {
          read: () => "b",
        });
      },
      {
        serviceProvisions: [
          serviceProvision(serviceA, providerId),
          serviceProvision(serviceB, providerId),
        ],
      },
    );
    const supervisor = createSupervisor([definition]);
    try {
      await supervisor.reconcile(desired([definition]));
      expect(supervisor.services.providerIds(serviceA)).toEqual([providerId]);
      expect(supervisor.services.providerIds(serviceB)).toEqual([providerId]);
      await supervisor.reconcile({
        ...desired([definition]),
        desired: new Map([[definition.microSystemId, "STOPPED" as const]]),
      });
      expect(supervisor.services.providerIds(serviceA)).toEqual([]);
      expect(supervisor.services.providerIds(serviceB)).toEqual([]);
    } finally {
      await supervisor.close();
    }
  });

  it("stops mode-ineligible systems without mutating Desired State", async () => {
    const safeOnly = system("system.normal-only", async () => undefined, {
      operatingModes: ["NORMAL"],
    });
    const supervisor = createSupervisor([safeOnly]);
    const normalDesired = desired([safeOnly]);
    try {
      await supervisor.reconcile(normalDesired);
      await supervisor.reconcile(desired([safeOnly], "SAFE"));
      expect(supervisor.getActualState(safeOnly.microSystemId)).toBe("BLOCKED");
      expect(normalDesired.desired.get(safeOnly.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("reactivates the original Desired State", async () => {
    const systemDefinition = system("system.resume", async () => undefined, {
      operatingModes: ["NORMAL"],
    });
    const supervisor = createSupervisor([systemDefinition]);
    try {
      await supervisor.reconcile(desired([systemDefinition], "SAFE"));
      await supervisor.reconcile(desired([systemDefinition], "NORMAL"));
      expect(supervisor.getActualState(systemDefinition.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("recovers a SAFE-blocked dependency chain in one NORMAL reconcile", async () => {
    const serviceId = createServiceId("test.safe-recovery-chain");
    const providerId = createProviderId("provider.safe-recovery");
    const a = system(
      "system.safe-recovery-provider",
      async (context) => {
        context.publishService(serviceProvision(serviceId, providerId), {
          read: () => "safe-recovered",
        });
      },
      {
        operatingModes: ["NORMAL"],
        serviceProvisions: [serviceProvision(serviceId, providerId)],
      },
    );
    const b = system(
      "system.safe-recovery-consumer",
      async (context) => {
        await context
          .requireService<{ read(): string }>(serviceRequirement(serviceId))
          .invoke("read", (service) => service.read());
      },
      {
        operatingModes: ["NORMAL"],
        serviceRequirements: [serviceRequirement(serviceId)],
      },
    );
    const supervisor = createSupervisor([a, b]);

    try {
      await supervisor.reconcile(desired([a, b], "SAFE"));
      expect(supervisor.getActualState(a.microSystemId)).toBe("BLOCKED");
      expect(supervisor.getActualState(b.microSystemId)).toBe("BLOCKED");
      await supervisor.reconcile(desired([a, b], "NORMAL"));
      expect(supervisor.getActualState(a.microSystemId)).toBe("RUNNING");
      expect(supervisor.getActualState(b.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("does not commit OperatingMode when planning fails", async () => {
    const serviceA = createServiceId("test.mode-cycle.a");
    const serviceB = createServiceId("test.mode-cycle.b");
    const a = system("system.mode-cycle-a", async () => undefined, {
      serviceRequirements: [serviceRequirement(serviceB)],
      serviceProvisions: [
        serviceProvision(serviceA, createProviderId("provider.mode-cycle-a")),
      ],
    });
    const b = system("system.mode-cycle-b", async () => undefined, {
      serviceRequirements: [serviceRequirement(serviceA)],
      serviceProvisions: [
        serviceProvision(serviceB, createProviderId("provider.mode-cycle-b")),
      ],
    });
    const supervisor = createSupervisor([a, b]);
    try {
      await expect(supervisor.reconcile(desired([a, b], "SAFE"))).rejects.toMatchObject(
        {
          problem: { problemCode: "runtime.graph.hard_service_cycle" },
        },
      );
      expect((supervisor as unknown as { operatingMode: string }).operatingMode).toBe(
        "NORMAL",
      );
    } finally {
      await supervisor.close();
    }
  });

  it("uses current hard dependency topology when desired state removes all systems", async () => {
    const serviceId = createServiceId("test.current-shutdown");
    const order: string[] = [];
    const providerDefinition = provider("a", serviceId, async (context) => {
      context.publishService(
        serviceProvision(serviceId, createProviderId("provider.a")),
        { read: () => "a" },
      );
      context.scope.defer("provider-dispose", () => {
        order.push("provider");
      });
    });
    const consumerDefinition = consumer("z", serviceId, async (context) => {
      context.scope.defer("consumer-dispose", () => {
        order.push("consumer");
      });
      await context
        .requireService<{ read(): string }>(serviceRequirement(serviceId))
        .invoke("read", (service) => service.read());
    });
    const supervisor = createSupervisor([providerDefinition, consumerDefinition]);
    try {
      await supervisor.reconcile(desired([providerDefinition, consumerDefinition]));
      expect(supervisor.getActualState(providerDefinition.microSystemId)).toBe(
        "RUNNING",
      );
      expect(supervisor.getActualState(consumerDefinition.microSystemId)).toBe(
        "RUNNING",
      );
      await supervisor.reconcile({
        ...desired([providerDefinition, consumerDefinition]),
        desired: new Map([
          [providerDefinition.microSystemId, "STOPPED" as const],
          [consumerDefinition.microSystemId, "STOPPED" as const],
        ]),
      });
      expect(order).toEqual(["consumer", "provider"]);
    } finally {
      await supervisor.close();
    }
  });

  it("uses current topology for multi-level shutdown when target graph is empty", async () => {
    const serviceX = createServiceId("test.current-shutdown.x");
    const serviceY = createServiceId("test.current-shutdown.y");
    const order: string[] = [];
    const providerA = provider("a", serviceX, async (context) => {
      context.publishService(
        serviceProvision(serviceX, createProviderId("provider.a")),
        { read: () => "a" },
      );
      context.scope.defer("a-dispose", () => {
        order.push("a");
      });
    });
    const providerB = system(
      "system.b",
      async (context) => {
        await context
          .requireService<{ read(): string }>(serviceRequirement(serviceX))
          .invoke("read", (service) => service.read());
        context.publishService(
          serviceProvision(serviceY, createProviderId("provider.b")),
          { read: () => "b" },
        );
        context.scope.defer("b-dispose", () => {
          order.push("b");
        });
      },
      {
        serviceRequirements: [serviceRequirement(serviceX)],
        serviceProvisions: [serviceProvision(serviceY, createProviderId("provider.b"))],
      },
    );
    const consumerC = consumer("c", serviceY, async (context) => {
      await context
        .requireService<{ read(): string }>(serviceRequirement(serviceY))
        .invoke("read", (service) => service.read());
      context.scope.defer("c-dispose", () => {
        order.push("c");
      });
    });
    const systems = [providerA, providerB, consumerC];
    const supervisor = createSupervisor(systems);
    try {
      await supervisor.reconcile(desired(systems));
      await supervisor.reconcile({
        ...desired(systems),
        desired: new Map(
          systems.map((definition) => [definition.microSystemId, "STOPPED" as const]),
        ),
      });
      expect(order).toEqual(["c", "b", "a"]);
    } finally {
      await supervisor.close();
    }
  });

  it("shuts down scopes in hard dependency order", async () => {
    const serviceId = createServiceId("test.shutdown");
    const order: string[] = [];
    const a = provider("a", serviceId, async (context) => {
      context.publishService(
        serviceProvision(serviceId, createProviderId("provider.a")),
        {
          read: () => "a",
        },
      );
      context.scope.defer("a-dispose", () => {
        order.push("a");
      });
    });
    const b = consumer("b", serviceId, async (context) => {
      context.scope.defer("b-dispose", () => {
        order.push("b");
      });
      await context
        .requireService<{ read(): string }>(serviceRequirement(serviceId))
        .invoke("read", (service) => service.read());
    });
    const supervisor = createSupervisor([a, b]);
    await supervisor.reconcile(desired([a, b]));
    await supervisor.close();
    expect(order).toEqual(["b", "a"]);
  });

  it("does not automatically retry failed activation", async () => {
    let attempts = 0;
    const failing = system("system.once", async () => {
      attempts += 1;
      throw new Error("once");
    });
    const supervisor = createSupervisor([failing]);
    try {
      await expect(supervisor.reconcile(desired([failing]))).rejects.toBeDefined();
      expect(attempts).toBe(1);
    } finally {
      await supervisor.close();
    }
  });

  it("serializes concurrent reconcile requests", async () => {
    let activations = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const systemDefinition = system("system.serial", async () => {
      activations += 1;
      await gate;
    });
    const supervisor = createSupervisor([systemDefinition]);
    try {
      const target = desired([systemDefinition]);
      const first = supervisor.reconcile(target);
      const second = supervisor.reconcile(target);
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(activations).toBe(1);
      release();
      await Promise.all([first, second]);
      expect(activations).toBe(1);
    } finally {
      release();
      await supervisor.close();
    }
  });

  it("preserves a background failure that races activation registration", async () => {
    const failing = system(
      "system.immediate-background-failure",
      async () => undefined,
    );
    const substrate: RuntimeSubstrate = {
      async activate(request) {
        request.onFailure({
          phase: "BACKGROUND",
          label: "immediate-background-failure",
          cause: new Error("background boom"),
        });
        return {
          state: "ACTIVE",
          dispose: async () => undefined,
        };
      },
      close: async () => undefined,
    };
    const supervisor = createSupervisorWithSubstrate([failing], substrate);
    try {
      await expect(supervisor.reconcile(desired([failing]))).rejects.toBeDefined();
      expect(supervisor.getActualState(failing.microSystemId)).toBe("FAILED");
    } finally {
      await supervisor.close();
    }
  });

  it("fails the activation lifecycle when background failure occurs during registration", async () => {
    const events: Array<{ kind: string; outcome: "SUCCEEDED" | "FAILED" }> = [];
    const lifecycleLineage = {
      runner: () => ({
        current: () => undefined,
        runActivity: async <T>(
          _request: never,
          operation: (context: never) => Promise<T>,
        ) => operation(undefined as never),
      }),
      runRetained: async <T>(
        _origin: never,
        request: { kind: string },
        operation: (context: never) => Promise<T>,
      ) => {
        try {
          const result = await operation(undefined as never);
          events.push({ kind: request.kind, outcome: "SUCCEEDED" });
          return result;
        } catch (error) {
          events.push({ kind: request.kind, outcome: "FAILED" });
          throw error;
        }
      },
    } as unknown as RuntimeLifecycleLineage;
    const failing = system(
      "system.immediate-background-lineage",
      async () => undefined,
    );
    const substrate: RuntimeSubstrate = {
      async activate(request) {
        request.onFailure({
          phase: "BACKGROUND",
          label: "immediate-background-lineage",
          cause: new Error("background boom"),
        });
        return {
          state: "ACTIVE",
          dispose: async () => undefined,
        };
      },
      close: async () => undefined,
    };
    const supervisor = new MicroSystemSupervisor({
      substrate,
      settleTimeoutMs: 50,
      definitions: [failing],
      lifecycleLineage,
    });

    try {
      await expect(supervisor.reconcile(desired([failing]))).rejects.toBeDefined();
      expect(supervisor.getActualState(failing.microSystemId)).toBe("FAILED");
      expect(
        events.find((event) => event.kind === "runtime.lifecycle.activate")?.outcome,
      ).toBe("FAILED");
    } finally {
      await supervisor.close();
    }
  });

  it("serializes background failure transition ahead of a queued reconcile", async () => {
    const definition = system(
      "system.serialized-background-failure",
      async () => undefined,
    );
    const substrateBase = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    let activationRequest!: Parameters<RuntimeSubstrate["activate"]>[0];
    const substrate: RuntimeSubstrate = {
      async activate(request) {
        activationRequest = request;
        return substrateBase.activate(request);
      },
      close: () => substrateBase.close(),
    };
    const failureStarted = deferred<void>();
    const releaseFailure = deferred<void>();
    const lifecycleLineage = {
      runner: () => ({
        current: () => undefined,
        runActivity: async <T>(
          _request: never,
          operation: (context: never) => Promise<T>,
        ) => operation(undefined as never),
      }),
      runRetained: async <T>(
        _origin: never,
        request: { kind: string },
        operation: (context: never) => Promise<T>,
      ) => {
        if (request.kind === "runtime.lifecycle.failure") {
          failureStarted.resolve();
          await releaseFailure.promise;
        }
        return operation(undefined as never);
      },
    } as unknown as RuntimeLifecycleLineage;
    const supervisor = new MicroSystemSupervisor({
      substrate,
      settleTimeoutMs: 50,
      definitions: [definition],
      lifecycleLineage,
    });

    try {
      await supervisor.reconcile(desired([definition]));
      activationRequest.onFailure({
        phase: "BACKGROUND",
        label: "serialized-background-failure",
        cause: new Error("background boom"),
      });
      await failureStarted.promise;

      let stopSettled = false;
      const stopPromise = supervisor.reconcile({
        ...desired([definition]),
        desired: new Map([[definition.microSystemId, "STOPPED" as const]]),
      });
      void stopPromise.then(
        () => {
          stopSettled = true;
        },
        () => {
          stopSettled = true;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(stopSettled).toBe(false);

      releaseFailure.resolve();
      await stopPromise;
    } finally {
      releaseFailure.resolve();
      await supervisor.close().catch(() => undefined);
    }
  });

  it("ignores a background failure callback from a retired runtime generation", async () => {
    const definition = system("system.stale-background-failure", async () => undefined);
    const substrateBase = createRuntimeSubstrate({ settleTimeoutMs: 50 });
    const activationRequests: Array<Parameters<RuntimeSubstrate["activate"]>[0]> = [];
    const substrate: RuntimeSubstrate = {
      async activate(request) {
        activationRequests.push(request);
        return substrateBase.activate(request);
      },
      close: () => substrateBase.close(),
    };
    const supervisor = createSupervisorWithSubstrate([definition], substrate);

    try {
      await supervisor.reconcile(desired([definition]));
      await supervisor.reconcile({
        ...desired([definition]),
        desired: new Map([[definition.microSystemId, "STOPPED" as const]]),
      });
      await supervisor.reconcile(desired([definition]));
      expect(activationRequests).toHaveLength(2);

      activationRequests[0].onFailure({
        phase: "BACKGROUND",
        label: "stale-background-failure",
        cause: new Error("stale background boom"),
      });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(supervisor.getActualState(definition.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("revokes provider admission before background failure lineage cleanup", async () => {
    const serviceId = createServiceId("test.background-admission");
    const providerId = createProviderId("provider.background-admission");
    let rejectWorker!: (reason: unknown) => void;
    const worker = new Promise<void>((_resolve, reject) => {
      rejectWorker = reject;
    });
    const definition = system(
      "system.background-admission",
      async (context) => {
        context.scope.track("worker", worker);
        context.publishService(serviceProvision(serviceId, providerId), {
          read: () => "active",
        });
      },
      { serviceProvisions: [serviceProvision(serviceId, providerId)] },
    );
    const failureStarted = deferred<void>();
    const releaseFailure = deferred<void>();
    const lifecycleLineage = {
      runner: () => ({
        current: () => undefined,
        runActivity: async <T>(
          _request: never,
          operation: (context: never) => Promise<T>,
        ) => operation(undefined as never),
      }),
      runRetained: async <T>(
        _origin: never,
        request: { kind: string },
        operation: (context: never) => Promise<T>,
      ) => {
        if (request.kind === "runtime.lifecycle.failure") {
          failureStarted.resolve();
          await releaseFailure.promise;
        }
        return operation(undefined as never);
      },
    } as unknown as RuntimeLifecycleLineage;
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [definition],
      lifecycleLineage,
    });

    try {
      await supervisor.reconcile(desired([definition]));
      const lease = supervisor.services.resolve<{ read(): string }>(
        serviceRequirement(serviceId),
      );
      rejectWorker(new Error("background boom"));
      await failureStarted.promise;

      await expect(
        lease.invoke("read", (service) => service.read()),
      ).rejects.toMatchObject({
        problem: expect.objectContaining({
          problemCode: "runtime.generation.retired",
        }),
      });
    } finally {
      releaseFailure.resolve();
      await supervisor.close().catch(() => undefined);
    }
  });

  it("blocks a hard dependent when its provider fails during START", async () => {
    const serviceId = createServiceId("test.background-start-race");
    const providerId = createProviderId("provider.background-start-race");
    let rejectWorker!: (reason: unknown) => void;
    const worker = new Promise<void>((_resolve, reject) => {
      rejectWorker = reject;
    });
    const providerDefinition = system(
      "system.background-start-race-provider",
      async (context) => {
        context.scope.track("worker", worker);
        context.publishService(serviceProvision(serviceId, providerId), {
          read: () => "provider",
        });
      },
      { serviceProvisions: [serviceProvision(serviceId, providerId)] },
    );
    const dependentEntered = deferred<void>();
    const releaseDependent = deferred<void>();
    const dependentDefinition = system(
      "system.background-start-race-dependent",
      async (context) => {
        dependentEntered.resolve();
        await releaseDependent.promise;
        await context
          .requireService<{ read(): string }>(serviceRequirement(serviceId))
          .invoke("read", (service) => service.read());
      },
      { serviceRequirements: [serviceRequirement(serviceId)] },
    );
    const independentDefinition = system(
      "system.background-start-race-independent",
      async () => undefined,
    );
    const supervisor = createSupervisor([
      providerDefinition,
      dependentDefinition,
      independentDefinition,
    ]);

    try {
      const reconciliation = supervisor.reconcile(
        desired([providerDefinition, dependentDefinition, independentDefinition]),
      );
      await dependentEntered.promise;
      rejectWorker(new Error("provider background failure"));
      await Promise.resolve();
      releaseDependent.resolve();

      await expect(reconciliation).rejects.toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(supervisor.getActualState(providerDefinition.microSystemId)).toBe(
        "FAILED",
      );
      expect(supervisor.getActualState(dependentDefinition.microSystemId)).toBe(
        "BLOCKED",
      );
      expect(supervisor.getActualState(independentDefinition.microSystemId)).toBe(
        "RUNNING",
      );
    } finally {
      releaseDependent.resolve();
      await supervisor.close().catch(() => undefined);
    }
  });

  it("captures DesiredRuntimeSnapshot before queued reconciliation reads it", async () => {
    const systemDefinition = system("system.snapshot", async () => undefined);
    const supervisor = createSupervisor([systemDefinition]);
    const snapshot = desired([systemDefinition]);
    try {
      const reconcile = supervisor.reconcile(snapshot);
      snapshot.desired.set(systemDefinition.microSystemId, "STOPPED");
      await reconcile;
      expect(supervisor.getActualState(systemDefinition.microSystemId)).toBe("RUNNING");
    } finally {
      await supervisor.close();
    }
  });

  it("rejects negative or unsafe DesiredRuntimeSnapshot revisions", async () => {
    const systemDefinition = system("system.invalid-revision", async () => undefined);
    const supervisor = createSupervisor([systemDefinition]);
    try {
      await expect(
        supervisor.reconcile({ ...desired([systemDefinition]), revision: -1 }),
      ).rejects.toMatchObject({
        problem: { problemCode: "runtime.supervisor.invalid_revision" },
      });
    } finally {
      await supervisor.close();
    }
  });

  it("contains cleanup failures from asynchronous background failure handling", async () => {
    const failing = system("system.background-cleanup-failure", async () => undefined);
    const substrate: RuntimeSubstrate = {
      async activate(request) {
        setTimeout(() => {
          request.onFailure({
            phase: "BACKGROUND",
            label: "background-cleanup-failure",
            cause: new Error("background boom"),
          });
        }, 0);
        return {
          state: "ACTIVE",
          dispose: async () => {
            throw new Error("cleanup boom");
          },
        };
      },
      close: async () => undefined,
    };
    const supervisor = createSupervisorWithSubstrate([failing], substrate);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      await supervisor.reconcile(desired([failing]));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(supervisor.getActualState(failing.microSystemId)).toBe("FAILED");
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await supervisor.close();
    }
  });

  it("binds Service call Activities to the provider runtime origin", async () => {
    const serviceId = createServiceId("test.provider-origin-activity");
    const a = provider("activity-a", serviceId);
    const b = consumer("activity-b", serviceId);
    const events: Array<{
      request: { kind: string; semantic?: Record<string, unknown> };
      origin: { microSystemId?: unknown };
    }> = [];
    const lifecycleLineage = {
      runner: (origin: { microSystemId: unknown }) => ({
        current: () => undefined,
        runActivity: async <T>(
          request: { kind: string; semantic?: Record<string, unknown> },
          operation: (context: never) => Promise<T>,
        ) => {
          events.push({ request, origin });
          return operation(undefined as never);
        },
      }),
      runRetained: async <T>(
        _origin: unknown,
        _request: unknown,
        operation: (context: never) => Promise<T>,
      ) => operation(undefined as never),
    } as unknown as RuntimeLifecycleLineage;
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [a, b],
      lifecycleLineage,
    });
    try {
      await supervisor.reconcile(desired([a, b]));
      const event = events.find((entry) => entry.request.kind === "service.call");
      expect(event?.request.semantic).toMatchObject({
        serviceId,
        providerId: createProviderId("provider.activity-a"),
      });
      expect(event?.origin.microSystemId).toBe(a.microSystemId);
    } finally {
      await supervisor.close();
    }
  });

  it("does not retain a no-op reconcile Activity", async () => {
    const systemDefinition = system("system.no-op-reconcile", async () => undefined);
    const reconcileKinds: string[] = [];
    const lifecycleLineage = {
      runner: () => ({
        current: () => undefined,
        runActivity: async <T>(
          _request: unknown,
          operation: (context: never) => Promise<T>,
        ) => operation(undefined as never),
      }),
      runRetained: async <T>(
        _origin: unknown,
        request: { kind: string },
        operation: (context: never) => Promise<T>,
      ) => {
        reconcileKinds.push(request.kind);
        return operation(undefined as never);
      },
    } as unknown as RuntimeLifecycleLineage;
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [systemDefinition],
      lifecycleLineage,
      rootRuntimeOrigin: { productGenerationId: generation.productGenerationId },
    });
    try {
      await supervisor.reconcile(desired([systemDefinition]));
      await supervisor.reconcile(desired([systemDefinition]));
      expect(
        reconcileKinds.filter((kind) => kind === "runtime.reconcile"),
      ).toHaveLength(1);
    } finally {
      await supervisor.close();
    }
  });

  it("does not retain repeated already-BLOCKED reconcile plans", async () => {
    const blocked = consumer(
      "repeated-blocked",
      createServiceId("test.repeated-missing"),
    );
    const reconcileKinds: string[] = [];
    const lifecycleLineage = {
      runner: () => ({
        current: () => undefined,
        runActivity: async <T>(
          _request: unknown,
          operation: (context: never) => Promise<T>,
        ) => operation(undefined as never),
      }),
      runRetained: async <T>(
        _origin: unknown,
        request: { kind: string },
        operation: (context: never) => Promise<T>,
      ) => {
        reconcileKinds.push(request.kind);
        return operation(undefined as never);
      },
    } as unknown as RuntimeLifecycleLineage;
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [blocked],
      lifecycleLineage,
      rootRuntimeOrigin: { productGenerationId: generation.productGenerationId },
    });

    try {
      await supervisor.reconcile(desired([blocked]));
      await supervisor.reconcile(desired([blocked]));
      expect(
        reconcileKinds.filter((kind) => kind === "runtime.reconcile"),
      ).toHaveLength(1);
    } finally {
      await supervisor.close();
    }
  });

  it("terminalizes the supervisor when its owner signal aborts", async () => {
    const owner = new AbortController();
    const terminalFailures: unknown[] = [];
    const definition = system("system.owner-abort", async () => undefined);
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [definition],
      ownerLifecycle: {
        signal: owner.signal,
        onTerminalFailure: (error) => terminalFailures.push(error),
      },
    });
    expect(supervisor.isActive()).toBe(true);
    await supervisor.reconcile(desired([definition]));
    owner.abort();
    await expect(supervisor.close()).resolves.toBeUndefined();
    expect(supervisor.isActive()).toBe(false);
    await expect(supervisor.reconcile(desired([definition]))).rejects.toMatchObject({
      problem: { problemCode: "runtime.supervisor.not_active" },
    });
    expect(terminalFailures).toEqual([]);
  });

  it("does not double-retire or resurrect during an owner/background-failure race", async () => {
    const owner = new AbortController();
    let activationRequest!: Parameters<RuntimeSubstrate["activate"]>[0];
    let disposeCount = 0;
    let closeCount = 0;
    const definition = system("system.owner-background-race", async () => undefined);
    const substrate: RuntimeSubstrate = {
      async activate(request) {
        activationRequest = request;
        return {
          state: "ACTIVE",
          dispose: async () => {
            disposeCount += 1;
          },
        };
      },
      async close() {
        closeCount += 1;
      },
    };
    const supervisor = new MicroSystemSupervisor({
      substrate,
      settleTimeoutMs: 50,
      definitions: [definition],
      ownerLifecycle: {
        signal: owner.signal,
        onTerminalFailure: () => undefined,
      },
    });
    try {
      await supervisor.reconcile(desired([definition]));
      activationRequest.onFailure({
        phase: "BACKGROUND",
        label: "background-failure",
        cause: new Error("background failure"),
      });
      owner.abort();
      await expect(supervisor.close()).resolves.toBeUndefined();
      expect(disposeCount).toBe(1);
      expect(closeCount).toBe(1);
      await expect(supervisor.reconcile(desired([definition]))).rejects.toMatchObject({
        problem: { problemCode: "runtime.supervisor.not_active" },
      });
    } finally {
      await supervisor.close().catch(() => undefined);
    }
  });

  it("owner abort cancels STARTING activation and cannot reopen", async () => {
    const owner = new AbortController();
    const activationStarted = deferred<void>();
    const activationAborted = deferred<void>();
    const definition = system("system.start-owner-abort-cancel", async (context) => {
      activationStarted.resolve();
      await new Promise<void>((resolve) => {
        if (context.signal.aborted) {
          activationAborted.resolve();
          resolve();
          return;
        }
        context.signal.addEventListener(
          "abort",
          () => {
            activationAborted.resolve();
            resolve();
          },
          { once: true },
        );
      });
    });
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [definition],
      ownerLifecycle: { signal: owner.signal, onTerminalFailure: () => undefined },
    });
    try {
      const reconcile = supervisor.reconcile(desired([definition]));
      await activationStarted.promise;
      owner.abort();
      await activationAborted.promise;
      await expect(reconcile).rejects.toMatchObject({
        problem: { problemCode: "runtime.supervisor.not_active" },
      });
      await expect(supervisor.close()).resolves.toBeUndefined();
      await expect(supervisor.reconcile(desired([definition]))).rejects.toMatchObject({
        problem: { problemCode: "runtime.supervisor.not_active" },
      });
    } finally {
      await supervisor.close().catch(() => undefined);
    }
  });

  it("rejects a delayed activation after owner abort closes admission", async () => {
    const owner = new AbortController();
    const activationPreludeStarted = deferred<void>();
    const releaseActivationPrelude = deferred<void>();
    let activations = 0;
    const definition = system("system.delayed-activation-owner-abort", async () => {
      activations += 1;
    });
    const lifecycleLineage = {
      runner: () => ({
        current: () => undefined,
        runActivity: async <T>(
          _request: never,
          operation: (context: never) => Promise<T>,
        ) => operation(undefined as never),
      }),
      runRetained: async <T>(
        _origin: never,
        request: { kind: string },
        operation: (context: never) => Promise<T>,
      ) => {
        if (request.kind === "runtime.lifecycle.activate") {
          activationPreludeStarted.resolve();
          await releaseActivationPrelude.promise;
        }
        return operation(undefined as never);
      },
    } as unknown as RuntimeLifecycleLineage;
    const supervisor = new MicroSystemSupervisor({
      substrate: createRuntimeSubstrate({ settleTimeoutMs: 50 }),
      settleTimeoutMs: 50,
      definitions: [definition],
      lifecycleLineage,
      ownerLifecycle: { signal: owner.signal, onTerminalFailure: () => undefined },
    });

    try {
      const reconciliation = supervisor.reconcile(desired([definition]));
      await activationPreludeStarted.promise;
      owner.abort();
      releaseActivationPrelude.resolve();

      await expect(reconciliation).rejects.toMatchObject({
        problem: { problemCode: "runtime.supervisor.not_active" },
      });
      await expect(supervisor.close()).resolves.toBeUndefined();
      expect(activations).toBe(0);
    } finally {
      releaseActivationPrelude.resolve();
      await supervisor.close().catch(() => undefined);
    }
  });

  it("admits no work when the owner signal is already aborted", async () => {
    const owner = new AbortController();
    owner.abort();
    let activations = 0;
    let closeCount = 0;
    const definition = system("system.pre-aborted", async () => {
      activations += 1;
    });
    const supervisor = new MicroSystemSupervisor({
      substrate: {
        async activate() {
          throw new Error("activation must not be admitted");
        },
        async close() {
          closeCount += 1;
        },
      },
      settleTimeoutMs: 50,
      definitions: [definition],
      ownerLifecycle: { signal: owner.signal, onTerminalFailure: () => undefined },
    });
    await expect(supervisor.reconcile(desired([definition]))).rejects.toMatchObject({
      problem: { problemCode: "runtime.supervisor.not_active" },
    });
    await expect(supervisor.close()).resolves.toBeUndefined();
    expect(activations).toBe(0);
    expect(closeCount).toBe(1);
  });

  it("returns the same idempotent terminal close outcome", async () => {
    let closeCount = 0;
    const supervisor = createSupervisorWithSubstrate([], {
      async activate() {
        throw new Error("no activation expected");
      },
      async close() {
        closeCount += 1;
      },
    });
    const firstClose = supervisor.close();
    const secondClose = supervisor.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    await expect(supervisor.close()).resolves.toBeUndefined();
    expect(closeCount).toBe(1);
  });
});
