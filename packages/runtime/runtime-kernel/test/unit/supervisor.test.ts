// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  asContentDigest,
  createMicroSystemId,
  createProviderId,
  createServiceId,
  digestCanonicalJson,
  type ProviderId,
  type ServiceId,
} from "@heptalogos/foundation-contracts";
import {
  createRuntimeSubstrate,
  type RuntimeSubstrate,
} from "@heptalogos/runtime-substrate";
import { describe, expect, it } from "vitest";
import {
  createContractVersion,
  exactContract,
  MicroSystemSupervisor,
  type MicroSystemDefinition,
  type MicroSystemDesiredState,
  type RuntimeGenerationRef,
  type RuntimeLifecycleLineage,
  type ServiceProvisionDescriptor,
  type WorkHandlerProvisionDescriptor,
} from "../../src/index.js";

const contractV1 = createContractVersion("v1");
const generation = {
  productGenerationId: asContentDigest(
    "ProductGenerationId",
    digestCanonicalJson("supervisor-test-generation/v1", { id: "test" }),
  ),
};

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
});
