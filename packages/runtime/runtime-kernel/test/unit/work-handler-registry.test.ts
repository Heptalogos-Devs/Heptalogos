// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  asContentDigest,
  createBootId,
  createContinuityEpochId,
  createContributionId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  createMicroSystemId,
  createMicroSystemInstanceId,
  createWorkItemId,
  digestCanonicalJson,
} from "@heptalogos/foundation-contracts";
import {
  createExecutionContextRuntime,
  type HostExecutionOrigin,
} from "@heptalogos/execution-lineage";
import {
  bindRuntimeExecutionOrigin,
  type RuntimeExecutionOrigin,
} from "@heptalogos/execution-lineage/runtime-kernel";
import { describe, expect, it } from "vitest";
import {
  GenerationFence,
  createContractVersion,
  WorkHandlerRegistry,
  type RuntimeWorkHandler,
  type WorkHandlerPayloadContract,
  type WorkHandlerProvisionDescriptor,
  type WorkHandlerTarget,
  type WorkQueueProfileId,
  type ResourceAdmissionClassId,
} from "../../src/index.js";

const productGenerationId = asContentDigest(
  "ProductGenerationId",
  digestCanonicalJson("runtime-kernel/work-handler/product/v1", { id: "product" }),
);
const packageGenerationA = asContentDigest(
  "PackageGenerationId",
  digestCanonicalJson("runtime-kernel/work-handler/package/v1", { id: "a" }),
);
const packageGenerationB = asContentDigest(
  "PackageGenerationId",
  digestCanonicalJson("runtime-kernel/work-handler/package/v1", { id: "b" }),
);
const microSystemId = createMicroSystemId("system.work-handler");
const contributionId = createContributionId("system.work-handler.execute");
const contractVersion = createContractVersion("v1");
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
  contractVersion,
  payloadContracts,
  outcomeSchema: {
    type: "object",
    properties: { accepted: { type: "boolean" } },
    required: ["accepted"],
    additionalProperties: false,
  },
  queueProfileId: "work.default" as WorkQueueProfileId,
  resourceAdmissionClass: "work.default" as ResourceAdmissionClassId,
  configurationBindingPolicy: "LATEST_COMPATIBLE_AT_ATTEMPT",
  restoreReplayClass: "RECONCILE_REQUIRED",
};

function target(packageGenerationId: typeof packageGenerationA): WorkHandlerTarget {
  return {
    productGenerationId,
    microSystemId,
    contributionId,
    packageGenerationId,
    payloadVersion: 1,
  };
}

function owner(packageGenerationId: typeof packageGenerationA) {
  return { microSystemId, productGenerationId, packageGenerationId };
}

function handler(
  result: RuntimeWorkHandler["execute"] = async () => ({
    outcome: { accepted: true },
  }),
): RuntimeWorkHandler {
  return { execute: result };
}

function invocation(signal = new AbortController().signal) {
  return {
    workItemId: createWorkItemId(),
    dispatchRevision: 1,
    payloadVersion: 1,
    payload: { value: "ok" },
    signal,
  };
}

describe("WorkHandlerRegistry", () => {
  it("resolves an exact generation and validates payload and outcome at the lease", async () => {
    const registry = new WorkHandlerRegistry();
    registry.register(
      owner(packageGenerationA),
      descriptor,
      handler(),
      new GenerationFence(),
    );

    const lease = registry.resolve(target(packageGenerationA));

    expect(lease).toBeDefined();
    expect(lease?.validatePayload(1, { value: "ok" })).toEqual({ value: "ok" });
    expect(() => lease?.validatePayload(1, { value: 1 })).toThrow();
    expect(() => lease?.validatePayload(2, { value: "ok" })).toThrow();
    await expect(lease?.reserveInvocation().execute(invocation())).resolves.toEqual({
      outcome: { accepted: true },
    });
    const invalidRegistry = new WorkHandlerRegistry();
    invalidRegistry.register(
      owner(packageGenerationA),
      descriptor,
      handler(async () => ({ outcome: { accepted: "yes" } as never })),
      new GenerationFence(),
    );
    await expect(
      invalidRegistry
        .resolve(target(packageGenerationA))!
        .reserveInvocation()
        .execute(invocation()),
    ).rejects.toThrow();
  });

  it("does not resolve an exact registration for an unsupported payload version", () => {
    const registry = new WorkHandlerRegistry();
    registry.register(
      owner(packageGenerationA),
      descriptor,
      handler(),
      new GenerationFence(),
    );

    expect(
      registry.resolve({ ...target(packageGenerationA), payloadVersion: 2 }),
    ).toBeUndefined();
  });

  it("normalizes payload contract order and keeps a deep descriptor snapshot", async () => {
    const mutablePayloadSchema = {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    };
    const mutableOutcomeSchema = {
      type: "object",
      properties: { accepted: { type: "boolean" } },
      required: ["accepted"],
      additionalProperties: false,
    };
    const sourceDescriptor: WorkHandlerProvisionDescriptor = {
      ...descriptor,
      payloadContracts: [
        { version: 2, schema: { type: "object" } },
        { version: 1, schema: mutablePayloadSchema },
      ],
      outcomeSchema: mutableOutcomeSchema,
    };
    const registry = new WorkHandlerRegistry();
    registry.register(
      owner(packageGenerationA),
      sourceDescriptor,
      handler(),
      new GenerationFence(),
    );

    mutablePayloadSchema.properties.value.type = "number";
    mutableOutcomeSchema.properties.accepted.type = "string";

    const lease = registry.resolve(target(packageGenerationA))!;
    expect(
      lease.descriptor.payloadContracts.map((contract) => contract.version),
    ).toEqual([1, 2]);
    expect(lease.descriptor.payloadContracts[0]?.schema).toEqual({
      additionalProperties: false,
      properties: { value: { type: "string" } },
      required: ["value"],
      type: "object",
    });
    expect(lease.descriptor.outcomeSchema).toEqual({
      additionalProperties: false,
      properties: { accepted: { type: "boolean" } },
      required: ["accepted"],
      type: "object",
    });
    expect(lease.validatePayload(1, { value: "ok" })).toEqual({ value: "ok" });
    await expect(lease.reserveInvocation().execute(invocation())).resolves.toEqual({
      outcome: { accepted: true },
    });
  });

  it("never falls from a missing generation to another registered generation", () => {
    const registry = new WorkHandlerRegistry();
    registry.register(
      owner(packageGenerationB),
      descriptor,
      handler(),
      new GenerationFence(),
    );

    expect(registry.resolve(target(packageGenerationA))).toBeUndefined();
  });

  it("rejects duplicate exact registration and configuration pinned without a resolver", () => {
    const registry = new WorkHandlerRegistry();
    const fence = new GenerationFence();
    registry.register(owner(packageGenerationA), descriptor, handler(), fence);

    expect(() =>
      registry.register(
        owner(packageGenerationA),
        descriptor,
        handler(),
        new GenerationFence(),
      ),
    ).toThrow();
    expect(() =>
      registry.register(
        owner(packageGenerationB),
        { ...descriptor, configurationBindingPolicy: "CONFIG_PINNED" },
        handler(),
        new GenerationFence(),
      ),
    ).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "runtime.work-handler.configuration-binding-unavailable",
        }),
      }),
    );
  });

  it("rejects payload contract versions outside the PostgreSQL integer range", () => {
    const registry = new WorkHandlerRegistry();

    expect(() =>
      registry.register(
        owner(packageGenerationA),
        {
          ...descriptor,
          payloadContracts: [{ version: 2_147_483_648, schema: {} }],
        },
        handler(),
        new GenerationFence(),
      ),
    ).toThrow();
  });

  it("closes new admission while an admitted generation invocation settles", async () => {
    const registry = new WorkHandlerRegistry();
    const fence = new GenerationFence();
    let resolveHandler!: (value: { outcome: { accepted: boolean } }) => void;
    const pending = new Promise<{ outcome: { accepted: boolean } }>((resolve) => {
      resolveHandler = resolve;
    });
    registry.register(
      owner(packageGenerationA),
      descriptor,
      handler(async () => pending),
      fence,
    );
    const lease = registry.resolve(target(packageGenerationA))!;
    const running = lease.reserveInvocation().execute(invocation());

    fence.beginRetirement();
    expect(registry.resolve(target(packageGenerationA))).toBeUndefined();
    resolveHandler({ outcome: { accepted: true } });
    await expect(running).resolves.toEqual({ outcome: { accepted: true } });
  });

  it("returns a detached deeply frozen outcome snapshot", async () => {
    let handlerOutcome: { accepted: boolean } | undefined;
    const registry = new WorkHandlerRegistry();
    registry.register(
      owner(packageGenerationA),
      descriptor,
      handler(async () => {
        handlerOutcome = { accepted: true };
        return { outcome: handlerOutcome };
      }),
      new GenerationFence(),
    );

    const result = await registry
      .resolve(target(packageGenerationA))!
      .reserveInvocation()
      .execute(invocation());
    handlerOutcome!.accepted = false;

    expect(result.outcome).toEqual({ accepted: true });
    expect(Object.isFrozen(result.outcome)).toBe(true);
  });

  it("passes the cooperative signal and records contribution.invoke with Host-bound origin", async () => {
    const hostOrigin: HostExecutionOrigin = {
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      bootId: createBootId(),
      continuityEpochId: createContinuityEpochId(),
      hostOwnershipToken: createHostOwnershipToken(),
    };
    const runtime = createExecutionContextRuntime(hostOrigin, {
      now: () => "2026-08-26T00:00:00.000Z" as never,
      monotonicNow: () => 0n as never,
      elapsedSince: () => 0n as never,
    });
    const runtimeOrigin: RuntimeExecutionOrigin = {
      productGenerationId,
      packageGenerationId: packageGenerationA,
      microSystemId,
      microSystemInstanceId: createMicroSystemInstanceId(),
      contributionId,
    };
    const bound = bindRuntimeExecutionOrigin(runtime, runtimeOrigin);
    let seenKind: string | undefined;
    let seenContributionId: unknown;
    let seenSignal: AbortSignal | undefined;
    const registry = new WorkHandlerRegistry();
    registry.register(
      owner(packageGenerationA),
      descriptor,
      handler(async (input) => {
        seenKind = runtime.current()?.kind;
        seenContributionId = runtime.current()?.origin.runtime?.contributionId;
        seenSignal = input.signal;
        return { outcome: { accepted: true } };
      }),
      new GenerationFence(),
      bound,
    );

    const controller = new AbortController();
    await registry
      .resolve(target(packageGenerationA))!
      .reserveInvocation()
      .execute(invocation(controller.signal));

    expect(seenKind).toBe("contribution.invoke");
    expect(seenContributionId).toBe(contributionId);
    expect(seenSignal).toBe(controller.signal);
  });
});
