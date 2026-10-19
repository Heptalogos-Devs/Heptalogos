// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  asContentDigest,
  createMicroSystemId,
  createProviderId,
  createServiceId,
  digestCanonicalJson,
  type MicroSystemId,
  type ProviderId,
  type ServiceId,
} from "@heptalogos/foundation-contracts";
import { describe, expect, it } from "vitest";
import {
  createContractVersion,
  exactContract,
  RuntimeGraph,
  ServiceRegistry,
  type MicroSystemDefinition,
  type ServiceProvisionDescriptor,
  type ServiceRequirement,
} from "../../src/index.js";

const contractV1 = createContractVersion("v1");
const contractV2 = createContractVersion("v2");
const generation = {
  productGenerationId: asContentDigest(
    "ProductGenerationId",
    digestCanonicalJson("runtime-kernel/test-generation/v1", { id: "test" }),
  ),
};

function serviceRequirement(serviceId: ServiceId): ServiceRequirement {
  return { serviceId, contract: exactContract(contractV1) };
}

function serviceProvision(
  serviceId: ServiceId,
  providerId: ProviderId,
  contractVersion: typeof contractV1 = contractV1,
): ServiceProvisionDescriptor {
  return { serviceId, providerId, contractVersion };
}

function definition(
  microSystemId: MicroSystemId,
  options: Partial<
    Pick<
      MicroSystemDefinition,
      | "serviceRequirements"
      | "serviceProvisions"
      | "capabilityRequirements"
      | "capabilityProvisions"
    >
  > = {},
): MicroSystemDefinition {
  return {
    microSystemId,
    role: "provider",
    generation,
    operatingModes: ["NORMAL", "SAFE", "MAINTENANCE", "EMERGENCY_READ_ONLY"],
    serviceRequirements: options.serviceRequirements ?? [],
    capabilityRequirements: options.capabilityRequirements ?? [],
    serviceProvisions: options.serviceProvisions ?? [],
    capabilityProvisions: options.capabilityProvisions ?? [],
    activate: async () => undefined,
  };
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

describe("RuntimeKernel contract compatibility and Service registry", () => {
  it("rejects ambiguous providers without using registration order", () => {
    const registry = new ServiceRegistry();
    const serviceId = createServiceId("test.ambiguous");
    registry.register(serviceProvision(serviceId, createProviderId("provider.b")), {});
    registry.register(serviceProvision(serviceId, createProviderId("provider.a")), {});
    expect(() => registry.resolve(serviceRequirement(serviceId))).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "runtime.service.ambiguous_provider",
        }),
      }),
    );
  });

  it("retained fenced Proxy cannot call after retirement", async () => {
    const registry = new ServiceRegistry();
    const serviceId = createServiceId("test.proxy");
    const providerId = createProviderId("provider.proxy");
    const fence = registry.register(serviceProvision(serviceId, providerId), {
      read: () => "proxy",
    });
    const lease = registry.resolve<{ read(): Promise<string> }>(
      serviceRequirement(serviceId),
    );
    let retained: { read(): Promise<string> } | undefined;
    await lease.invoke("capture", (service) => {
      retained = service;
    });
    await registry.retireGeneration(fence, 50);
    expect(() => retained!.read()).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({ problemCode: "runtime.generation.retired" }),
      }),
    );
  });

  it("lets an admitted provider call drain through the real provider identity", async () => {
    const registry = new ServiceRegistry();
    const serviceId = createServiceId("test.nested-proxy");
    const providerId = createProviderId("provider.nested-proxy");
    const started = deferred<void>();
    const released = deferred<void>();
    const fence = registry.register(serviceProvision(serviceId, providerId), {
      async read() {
        started.resolve();
        await released.promise;
        return this.nested();
      },
      nested() {
        return "nested";
      },
    });
    const lease = registry.resolve<{ read(): Promise<string> }>(
      serviceRequirement(serviceId),
    );
    const call = lease.invoke("read", (service) => service.read());
    await started.promise;
    const retirement = registry.retireGeneration(fence, 50);
    released.resolve();
    await expect(call).resolves.toBe("nested");
    await expect(retirement).resolves.toBeUndefined();
  });

  it("fences objects returned by provider methods after retirement", async () => {
    const registry = new ServiceRegistry();
    const serviceId = createServiceId("test.returned-object");
    const providerId = createProviderId("provider.returned-object");
    const fence = registry.register(serviceProvision(serviceId, providerId), {
      getSession: () => ({ read: () => "session" }),
    });
    const lease = registry.resolve<{
      getSession(): { read(): string };
    }>(serviceRequirement(serviceId));
    let session!: { read(): string };
    await lease.invoke("capture", (service) => {
      session = service.getSession();
    });
    await registry.retireGeneration(fence, 50);
    expect(() => session.read()).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({ problemCode: "runtime.generation.retired" }),
      }),
    );
  });

  it("rejects an executable getter at provider registration", () => {
    const registry = new ServiceRegistry();
    const serviceId = createServiceId("test.unsupported-getter");
    const providerId = createProviderId("provider.unsupported-getter");

    expect(() =>
      registry.register(serviceProvision(serviceId, providerId), {
        get value(): string {
          return "unsupported";
        },
      }),
    ).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "runtime.contract.unsupported_accessor",
        }),
      }),
    );
  });

  it("preserves provider identity for private fields and native internal slots", async () => {
    class PrivateClient {
      #state = "ok";
      #date = new Date(0);

      read(): string {
        return `${this.#state}:${this.#date.getTime()}`;
      }
    }

    const registry = new ServiceRegistry();
    const serviceId = createServiceId("test.class-provider");
    const providerId = createProviderId("provider.class-provider");
    registry.register(serviceProvision(serviceId, providerId), new PrivateClient());
    const lease = registry.resolve<{ read(): string }>(serviceRequirement(serviceId));

    await expect(lease.invoke("read", (service) => service.read())).resolves.toBe(
      "ok:0",
    );
  });

  it("generation-fences a descriptor-obtained method after retirement", async () => {
    const registry = new ServiceRegistry();
    const serviceId = createServiceId("test.reflection-retirement");
    const providerId = createProviderId("provider.reflection-retirement");
    const fence = registry.register(serviceProvision(serviceId, providerId), {
      read: () => "raw",
    });
    const lease = registry.resolve<{ read(): string }>(serviceRequirement(serviceId));
    let reflected!: () => string;
    await lease.invoke("descriptor", (service) => {
      reflected = Object.getOwnPropertyDescriptor(service, "read")!
        .value as () => string;
    });

    await registry.retireGeneration(fence, 50);

    expect(() => reflected()).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "runtime.generation.retired",
        }),
      }),
    );
  });

  it("projects frozen providers without violating Proxy invariants", async () => {
    const registry = new ServiceRegistry();
    const serviceId = createServiceId("test.reflection-frozen");
    const providerId = createProviderId("provider.reflection-frozen");
    const child = { read: () => "child" };
    const implementation = Object.freeze({ child });
    registry.register(serviceProvision(serviceId, providerId), implementation);
    const lease = registry.resolve<{ child: { read(): string } }>(
      serviceRequirement(serviceId),
    );

    await expect(
      lease.invoke("child", (service) => service.child.read()),
    ).resolves.toBe("child");
  });
});

describe("RuntimeGraph", () => {
  it("orders hard Service providers before consumers and keeps independent branches", () => {
    const serviceId = createServiceId("test.graph-service");
    const providerA = createProviderId("provider.a");
    const providerD = createProviderId("provider.d");
    const a = definition(createMicroSystemId("system.a"), {
      serviceProvisions: [serviceProvision(serviceId, providerA)],
    });
    const b = definition(createMicroSystemId("system.b"), {
      serviceRequirements: [serviceRequirement(serviceId)],
    });
    const c = definition(createMicroSystemId("system.c"));
    const d = definition(createMicroSystemId("system.d"), {
      serviceProvisions: [serviceProvision(serviceId, providerD)],
    });
    const plan = new RuntimeGraph(
      [a, b, c, d],
      new Map([[serviceId, providerD]]),
    ).plan();
    const order = plan.startOrder.map((item) => item.microSystemId);
    expect(order.indexOf(d.microSystemId)).toBeLessThan(order.indexOf(b.microSystemId));
    const shutdownOrder = plan.shutdownOrder.map((item) => item.microSystemId);
    expect(shutdownOrder.indexOf(b.microSystemId)).toBeLessThan(
      shutdownOrder.indexOf(d.microSystemId),
    );
    expect(plan.edges).toMatchObject([{ provider: d, consumer: b, serviceId }]);
  });

  it("rejects a hard Service cycle before activation", () => {
    const x = createServiceId("test.x");
    const y = createServiceId("test.y");
    const a = definition(createMicroSystemId("system.a"), {
      serviceRequirements: [serviceRequirement(y)],
      serviceProvisions: [serviceProvision(x, createProviderId("provider.a"))],
    });
    const b = definition(createMicroSystemId("system.b"), {
      serviceRequirements: [serviceRequirement(x)],
      serviceProvisions: [serviceProvision(y, createProviderId("provider.b"))],
    });
    expect(() => new RuntimeGraph([a, b]).plan()).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "runtime.graph.hard_service_cycle",
        }),
      }),
    );
  });

  it("counts eligible Service bindings rather than MicroSystems for ambiguity", () => {
    const serviceId = createServiceId("test.binding-ambiguity");
    const provider = definition(createMicroSystemId("system.one-provider"), {
      serviceProvisions: [
        serviceProvision(serviceId, createProviderId("provider.a")),
        serviceProvision(serviceId, createProviderId("provider.b")),
      ],
    });
    const consumer = definition(createMicroSystemId("system.consumer"), {
      serviceRequirements: [serviceRequirement(serviceId)],
    });

    expect(() => new RuntimeGraph([provider, consumer]).plan()).toThrow(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "runtime.service.ambiguous_provider",
        }),
      }),
    );
  });

  it("carries the exact selected Service binding through a graph edge", () => {
    const serviceId = createServiceId("test.binding-edge");
    const providerB = createProviderId("provider.binding-b");
    const provider = definition(createMicroSystemId("system.binding-provider"), {
      serviceProvisions: [
        serviceProvision(serviceId, createProviderId("provider.binding-a")),
        serviceProvision(serviceId, providerB, contractV2),
      ],
    });
    const consumer = definition(createMicroSystemId("system.binding-consumer"), {
      serviceRequirements: [{ serviceId, contract: exactContract(contractV2) }],
    });

    const plan = new RuntimeGraph([provider, consumer]).plan();

    expect(plan.edges).toContainEqual({
      provider,
      consumer,
      serviceId,
      providerId: providerB,
      contractVersion: contractV2,
    });
  });
});
