// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it, vi } from "vitest";
import {
  asContentDigest,
  createActivityId,
  createContinuityEpochId,
  createContributionId,
  createInstanceId,
  createMicroSystemId,
  createUuidV7Id,
  createWorkItemId,
  digestCanonicalJson,
  ProblemError,
  type ActivityId,
  type ContinuityEpochId,
  type Instant,
  type PackageGenerationId,
  type ProductGenerationId,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionContext,
  ExecutionContextRuntime,
  ExecutionLineageService,
  LineageContextRefV1,
} from "@heptalogos/execution-lineage";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";
import { GenerationFence } from "@heptalogos/runtime-kernel";
import type {
  ContractVersion,
  ResourceAdmissionClassId,
  RuntimeWorkHandler,
  RuntimeWorkHandlerLease,
  WorkHandlerProvisionDescriptor,
  WorkQueueProfileId,
} from "@heptalogos/runtime-kernel";
import type { TimeService } from "@heptalogos/time-service";
import {
  createDispatchAttemptId,
  createWorkAttemptExecutor,
  type WorkErrorClassifier,
  type WorkHandlerResolver,
  type WorkItem,
  type WorkQueueRepository,
  type WorkQueueRuntimeOptions,
} from "../../src/index.js";

const now = "2026-08-26T12:00:00.000Z" as Instant;
const future = "2026-08-26T12:05:00.000Z" as Instant;
const queueProfileId = createMicroSystemId(
  "default-work",
) as unknown as WorkQueueProfileId;
const resourceAdmissionClass = createMicroSystemId(
  "normal",
) as unknown as ResourceAdmissionClassId;

function digest<T extends "ProductGenerationId" | "PackageGenerationId">(
  brand: T,
  value: string,
): T extends "ProductGenerationId" ? ProductGenerationId : PackageGenerationId {
  return asContentDigest(
    brand,
    digestCanonicalJson(`test/${value}`, { value }),
  ) as unknown as T extends "ProductGenerationId"
    ? ProductGenerationId
    : PackageGenerationId;
}

function target(packageName = "package-a") {
  return {
    productGenerationId: digest("ProductGenerationId", "product-a"),
    microSystemId: createMicroSystemId("subject"),
    contributionId: createContributionId("subject.reply"),
    packageGenerationId: digest("PackageGenerationId", packageName),
    payloadVersion: 1,
  };
}

function context(): ExecutionContext {
  const continuityEpochId = createContinuityEpochId();
  return {
    activityId: createActivityId(),
    kind: "test.attempt",
    startedAt: now,
    links: [],
    origin: {
      installationId: createUuidV7Id("InstallationId"),
      instanceId: createInstanceId(),
      bootId: createUuidV7Id("BootId"),
      continuityEpochId,
      hostOwnershipToken: createUuidV7Id("HostOwnershipToken"),
    },
    semantic: {},
    importance: "routine",
    retentionClass: "operational",
    sensitivity: "operational",
  };
}

function refFor(value: ExecutionContext): LineageContextRefV1 {
  return {
    schemaVersion: 1,
    sourceActivityId: value.activityId,
    sourceInstanceId: value.origin.instanceId,
    sourceContinuityEpochId: value.origin.continuityEpochId,
  };
}

function item(value: ExecutionContext, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    schemaVersion: 1,
    workItemId: createWorkItemId(),
    handler: target(),
    payload: { value: "hello" },
    queueProfileId,
    resourceAdmissionClass,
    priority: 100,
    createdContinuityEpochId: value.origin.continuityEpochId,
    lineageContextRef: refFor(value),
    configurationBinding: { policy: "LATEST_COMPATIBLE_AT_ATTEMPT" },
    restoreReplayClass: "RECONCILE_REQUIRED",
    dispatchRevision: 1,
    state: "PENDING",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function terminalItem(
  value: WorkItem,
  kind: "SUCCEEDED" | "FAILED" | "CANCELLED" | "SUPERSEDED" = "SUCCEEDED",
): WorkItem {
  const outcome =
    kind === "SUCCEEDED"
      ? { schemaVersion: 1 as const, kind, value: { ok: true } }
      : kind === "FAILED"
        ? {
            schemaVersion: 1 as const,
            kind,
            retryClass: "permanent" as const,
            reasonCode: "failed",
          }
        : kind === "CANCELLED"
          ? { schemaVersion: 1 as const, kind, reasonCode: "cancelled" }
          : { schemaVersion: 1 as const, kind, reasonCode: "superseded" };
  return {
    ...value,
    state: kind,
    activeAttemptId: undefined,
    retryClass: kind === "FAILED" ? "permanent" : undefined,
    outcome,
    updatedAt: now,
  };
}

function leaseFor(
  value: WorkItem,
  execute: RuntimeWorkHandler["execute"] = vi.fn(async () => ({
    outcome: { ok: true } as never,
  })),
): RuntimeWorkHandlerLease {
  const descriptor: WorkHandlerProvisionDescriptor = {
    contributionId: value.handler.contributionId,
    contractVersion: "v1" as ContractVersion,
    payloadContracts: [{ version: 1, schema: {} }],
    outcomeSchema: {},
    queueProfileId,
    resourceAdmissionClass,
    configurationBindingPolicy: "LATEST_COMPATIBLE_AT_ATTEMPT",
    restoreReplayClass: "RECONCILE_REQUIRED",
  };
  return {
    target: value.handler,
    descriptor,
    validatePayload: (_version, payload) => payload as never,
    reserveInvocation: vi.fn(() => ({
      execute,
      release: vi.fn(),
    })),
  };
}

function fixture(
  value: WorkItem = item(context()),
  execute: RuntimeWorkHandler["execute"] = vi.fn(async () => ({
    outcome: { ok: true } as never,
  })),
) {
  const executionContext = context();
  const activity = context();
  const lease = leaseFor(value, execute);
  const transaction: PersistenceMutationTransactionContext = {
    mode: "MUTATION",
    execution: {
      activityId: activity.activityId,
      installationId: activity.origin.installationId,
      instanceId: activity.origin.instanceId,
      bootId: activity.origin.bootId,
      continuityEpochId: activity.origin.continuityEpochId,
      hostOwnershipToken: activity.origin.hostOwnershipToken,
    },
  };
  const repository: WorkQueueRepository = {
    getWorkItem: vi.fn(async () => value),
    markRunning: vi.fn(async (input) => {
      const running = {
        ...value,
        state: "RUNNING" as const,
        activeAttemptId: input.activeAttemptId,
      };
      await input.onApplied?.(transaction, running);
      return { status: "APPLIED" as const, item: running };
    }),
    markWaitingDependency: vi.fn(async (input) => {
      const waiting = { ...value, state: "WAITING_DEPENDENCY" as const };
      await input.onApplied?.(transaction, waiting);
      return { status: "APPLIED" as const, item: waiting };
    }),
    markRetryWait: vi.fn(async (input) => {
      const waiting = {
        ...value,
        state: "RETRY_WAIT" as const,
        retryClass: input.retryClass,
        stateReasonCode: input.reasonCode,
        notBefore: input.notBefore,
      };
      await input.onApplied?.(transaction, waiting);
      return { status: "APPLIED" as const, item: waiting };
    }),
    commitTerminal: vi.fn(async (input) => {
      const completed = {
        ...terminalItem(value, input.outcome.kind),
        outcome: input.outcome,
        retryClass:
          input.outcome.kind === "FAILED" ? input.outcome.retryClass : undefined,
      };
      await input.onApplied?.(transaction, completed);
      return { status: "APPLIED" as const, item: completed };
    }),
    insertWorkItem: vi.fn(),
    findNonTerminalDedup: vi.fn(),
    snapshotProjectionCeiling: vi.fn(),
    listProjectionCandidates: vi.fn(),
    listDueRetry: vi.fn(),
    snapshotWaitingDependencyCeiling: vi.fn(),
    listWaitingDependency: vi.fn(),
    wakeDependency: vi.fn(),
    wakeDueRetry: vi.fn(),
    requestCancel: vi.fn(),
    requestSupersede: vi.fn(),
  } as unknown as WorkQueueRepository;
  const handlerRegistry: WorkHandlerResolver = {
    resolve: vi.fn(() => lease),
  };
  const runtime: ExecutionContextRuntime = {
    current: () => executionContext,
    runActivity: vi.fn(async (_request, operation) => operation(activity)),
    runFromLineageContextRef: vi.fn(async (_ref, _request, operation) =>
      operation(activity),
    ),
    capture: (callback) => callback as never,
    createLineageContextRef: () => refFor(executionContext),
  };
  const retainCurrent = vi.fn(async () => undefined);
  const completeCurrent = vi.fn(async () => undefined);
  const lineage: ExecutionLineageService = {
    retainCurrent,
    completeCurrent,
    retainBootstrapReference: async () => undefined,
  };
  const classifier: WorkErrorClassifier = {
    classify: vi.fn(() => ({
      kind: "TERMINAL" as const,
      retryClass: "permanent" as const,
      reasonCode: "handler-failed",
    })),
  };
  const time: TimeService = {
    now: () => now,
    monotonicNow: () => 0n as never,
    elapsedSince: () => 0n as never,
  };
  const runtimeOptions: WorkQueueRuntimeOptions = {
    maxInlinePayloadBytes: 1024,
    maxOutcomeBytes: 1024,
    reconciliationBatchSize: 10,
    antiEntropyIntervalMs: 100,
  };
  const executor = createWorkAttemptExecutor({
    repository,
    handlerRegistry,
    execution: runtime,
    lineage,
    time,
    classifier,
    runtimeOptions,
  });
  return {
    executor,
    value,
    repository,
    handlerRegistry,
    lease,
    runtime,
    lineage,
    retainCurrent,
    completeCurrent,
    classifier,
    time,
  };
}

describe("engine-neutral WorkAttemptExecutor", () => {
  it("replays a terminal outcome and no-ops stale revisions", async () => {
    const value = item(context());
    const terminal = terminalItem(value);
    const terminalFixture = fixture(terminal);
    await expect(
      terminalFixture.executor.execute(value.workItemId, 1),
    ).resolves.toMatchObject({ status: "TERMINAL_REPLAY", outcome: terminal.outcome });

    const stale = fixture(value);
    stale.repository.getWorkItem = vi.fn(async () => ({
      ...value,
      dispatchRevision: 2,
    }));
    await expect(stale.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "STALE_NOOP",
    });
    expect(Reflect.get(stale.lease, "reserveInvocation")).not.toHaveBeenCalled();
  });

  it("recovers a RUNNING item through the same attempt without claiming it again", async () => {
    const pending = item(context());
    const attemptId = createDispatchAttemptId(
      pending.workItemId,
      pending.dispatchRevision,
    );
    const value = {
      ...pending,
      state: "RUNNING" as const,
      activeAttemptId: attemptId,
    };
    const handler = vi.fn(async () => ({ outcome: { ok: true } as never }));
    const attempt = fixture(value, handler);

    await expect(
      attempt.executor.execute(value.workItemId, value.dispatchRevision),
    ).resolves.toMatchObject({
      status: "SUCCEEDED",
    });

    expect(Reflect.get(attempt.repository, "markRunning")).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(attempt.retainCurrent).toHaveBeenCalledTimes(1);
    expect(Reflect.get(attempt.repository, "commitTerminal")).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedState: "RUNNING",
        expectedActiveAttemptId: attemptId,
      }),
    );
  });

  it("rejects a RUNNING item whose active attempt identity is inconsistent", async () => {
    const pending = item(context());
    const value = {
      ...pending,
      state: "RUNNING" as const,
      activeAttemptId: createDispatchAttemptId(pending.workItemId, 2),
    };
    const attempt = fixture(value);

    await expect(attempt.executor.execute(value.workItemId, 1)).rejects.toMatchObject({
      problem: { problemCode: "work.recovery.active_attempt_mismatch" },
    });
    expect(Reflect.get(attempt.repository, "markRunning")).not.toHaveBeenCalled();
    expect(Reflect.get(attempt.repository, "commitTerminal")).not.toHaveBeenCalled();
  });

  it("keeps a RUNNING item unchanged when its exact handler generation is missing", async () => {
    const pending = item(context());
    const value = {
      ...pending,
      state: "RUNNING" as const,
      activeAttemptId: createDispatchAttemptId(pending.workItemId, 1),
    };
    const attempt = fixture(value);
    attempt.handlerRegistry.resolve = vi.fn(() => undefined);

    await expect(attempt.executor.execute(value.workItemId, 1)).rejects.toMatchObject({
      problem: { problemCode: "work.recovery.handler_generation_missing" },
    });
    expect(Reflect.get(attempt.repository, "markRunning")).not.toHaveBeenCalled();
    expect(Reflect.get(attempt.repository, "commitTerminal")).not.toHaveBeenCalled();
  });

  it("terminalizes an accepted cancellation during RUNNING recovery without invoking the handler", async () => {
    const pending = item(context());
    const value = {
      ...pending,
      state: "RUNNING" as const,
      activeAttemptId: createDispatchAttemptId(pending.workItemId, 1),
      cancelRequestedAt: now,
      cancellationReasonCode: "operator.cancelled",
    };
    const handler = vi.fn(async () => ({ outcome: { ok: true } as never }));
    const attempt = fixture(value, handler);

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "CANCELLED",
    });
    expect(handler).not.toHaveBeenCalled();
    expect(Reflect.get(attempt.repository, "markRunning")).not.toHaveBeenCalled();
    expect(Reflect.get(attempt.repository, "commitTerminal")).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedState: "RUNNING",
        expectedActiveAttemptId: value.activeAttemptId,
      }),
    );
  });

  it("claims and invokes only the exact generation, outside any product transaction", async () => {
    let inTransaction = false;
    const value = item(context());
    const handler = vi.fn(async () => {
      expect(inTransaction).toBe(false);
      return { outcome: { ok: true } as never };
    });
    const attempt = fixture(value, handler);
    attempt.repository.markRunning = vi.fn(async (input) => {
      inTransaction = true;
      const running = {
        ...value,
        state: "RUNNING" as const,
        activeAttemptId: input.activeAttemptId,
      };
      await input.onApplied?.(inTransactionContext(value), running);
      inTransaction = false;
      return { status: "APPLIED" as const, item: running };
    });

    const result = await attempt.executor.execute(value.workItemId, 1);

    expect(result.status).toBe("SUCCEEDED");
    expect(handler).toHaveBeenCalledTimes(1);
    const invocation = (
      handler as unknown as { readonly mock: { readonly calls: readonly unknown[][] } }
    ).mock.calls[0]?.[0];
    expect(invocation).toMatchObject({
      workItemId: value.workItemId,
      dispatchRevision: 1,
      payloadVersion: 1,
      payload: value.payload,
    });
    expect(attempt.retainCurrent).toHaveBeenCalledTimes(1);
  });

  it("detaches a validated payload before the RUNNING transaction can mutate its source", async () => {
    const value = item(context(), { payload: { nested: { value: 1 } } });
    const handler = vi.fn(async () => ({ outcome: { ok: true } as never }));
    const attempt = fixture(value, handler);
    attempt.repository.markRunning = vi.fn(async (input) => {
      (value.payload as { nested: { value: number } }).nested.value = 9;
      const running = {
        ...value,
        state: "RUNNING" as const,
        activeAttemptId: input.activeAttemptId,
      };
      await input.onApplied?.(inTransactionContext(value), running);
      return { status: "APPLIED" as const, item: running };
    });

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { nested: { value: 1 } } }),
    );
  });

  it("keeps an admitted generation invocation alive through retirement", async () => {
    const value = item(context());
    const fence = new GenerationFence();
    const generationReservation = fence.reserve("work-handler.subject.reply");
    let retirement: Promise<void> | undefined;
    const handler = vi.fn(
      async (_input: Parameters<RuntimeWorkHandler["execute"]>[0]) => ({
        outcome: { ok: true } as never,
      }),
    );
    const attempt = fixture(value, handler);
    attempt.lease.reserveInvocation = vi.fn(() => {
      fence.beginRetirement();
      retirement = fence.retire(1000);
      return {
        execute: (input: Parameters<RuntimeWorkHandler["execute"]>[0]) =>
          Promise.resolve(generationReservation.run(() => handler(input))),
        release: () => generationReservation.release(),
      };
    });

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
    await retirement;

    expect(handler).toHaveBeenCalledTimes(1);
    expect(fence.state).toBe("RETIRED");
    expect(Reflect.get(attempt.classifier, "classify")).not.toHaveBeenCalled();
  });

  it("releases an admitted reservation when the RUNNING CAS loses", async () => {
    const value = item(context());
    const fence = new GenerationFence();
    const generationReservation = fence.reserve("work-handler.subject.reply");
    const execute = vi.fn(async () => ({ outcome: { ok: true } as never }));
    const release = vi.fn(() => generationReservation.release());
    const attempt = fixture(value, execute);
    attempt.lease.reserveInvocation = vi.fn(() => ({
      execute,
      release,
    }));
    attempt.repository.markRunning = vi.fn(async () => ({
      status: "STALE" as const,
      item: value,
    }));

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "STALE_NOOP",
    });

    expect(release).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(fence.activeInvocationCount).toBe(0);
  });

  it("executes through one admitted reservation without a second lease gate", async () => {
    const value = item(context());
    const attempt = fixture(value, async () => ({ outcome: { ok: true } as never }));

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
    expect(Reflect.get(attempt.lease, "reserveInvocation")).toHaveBeenCalledTimes(1);
  });

  it("does not fall forward from a missing exact generation to another package", async () => {
    const value = item(context());
    const other = leaseFor({ ...value, handler: target("package-b") });
    const attempt = fixture(value);
    const resolve = vi.fn(() => undefined);
    attempt.handlerRegistry.resolve = resolve;
    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "WAITING_DEPENDENCY",
    });
    expect(resolve).toHaveBeenCalledWith(value.handler);
    expect(Reflect.get(other, "reserveInvocation")).not.toHaveBeenCalled();
  });

  it("closes the work.execute Activity when an exact handler is unavailable", async () => {
    const value = item(context());
    const attempt = fixture(value);
    attempt.handlerRegistry.resolve = vi.fn(() => undefined);

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "WAITING_DEPENDENCY",
    });

    expect(attempt.retainCurrent).toHaveBeenCalledTimes(1);
    expect(attempt.completeCurrent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        endedAt: now,
        outcome: "SUCCEEDED",
        outcomeRef: "WAITING_DEPENDENCY",
      },
    );
  });

  it("closes the work.execute Activity when notBefore moves work to RETRY_WAIT", async () => {
    const value = item(context(), { notBefore: future });
    const attempt = fixture(value);

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "RETRY_WAIT",
    });

    expect(attempt.retainCurrent).toHaveBeenCalledTimes(1);
    expect(attempt.completeCurrent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        endedAt: now,
        outcome: "SUCCEEDED",
        outcomeRef: "RETRY_WAIT",
      },
    );
  });

  it("terminalizes an immutable invalid payload instead of waiting for a dependency", async () => {
    const value = item(context());
    const attempt = fixture(value);
    attempt.lease.validatePayload = vi.fn(() => {
      throw new ProblemError({
        schemaVersion: 1,
        problemCode: "runtime.work_handler.payload_invalid",
        category: "validation",
        retryClass: "never",
        title: "WorkHandler payload is invalid",
      });
    });

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "FAILED",
    });
    expect(
      Reflect.get(attempt.repository, "markWaitingDependency"),
    ).not.toHaveBeenCalled();
    expect(Reflect.get(attempt.repository, "commitTerminal")).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedState: "PENDING",
        outcome: {
          schemaVersion: 1,
          kind: "FAILED",
          retryClass: "invalid",
          reasonCode: "runtime.work_handler.payload_invalid",
        },
      }),
    );
    expect(attempt.retainCurrent).toHaveBeenCalledTimes(1);
    expect(attempt.completeCurrent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        endedAt: now,
        outcome: "FAILED",
        outcomeRef: "runtime.work_handler.payload_invalid",
      },
    );
  });

  it("lets cancellation and supersession win a stale handler result", async () => {
    for (const kind of ["CANCELLED", "SUPERSEDED"] as const) {
      const value = item(context());
      const attempt = fixture(value, async () => ({ outcome: { ok: true } as never }));
      attempt.repository.commitTerminal = vi.fn(async (_input) => ({
        status: "APPLIED" as const,
        item: terminalItem(value, kind),
      }));
      await expect(
        attempt.executor.execute(value.workItemId, 1),
      ).resolves.toMatchObject({
        status: kind,
      });
      expect(Reflect.get(attempt.repository, "commitTerminal")).toHaveBeenCalledTimes(
        1,
      );
    }
  });

  it("closes the work.execute Activity when a terminal intent wins before RUNNING", async () => {
    const value = item(context());
    const cancelled = {
      ...value,
      cancelRequestedAt: now,
      cancellationReasonCode: "operator.cancelled",
    };
    const attempt = fixture(value);
    attempt.repository.markRunning = vi.fn(async () => ({
      status: "STALE" as const,
      item: cancelled,
    }));

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "CANCELLED",
    });

    expect(attempt.retainCurrent).toHaveBeenCalledTimes(1);
    expect(attempt.completeCurrent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        endedAt: now,
        outcome: "CANCELLED",
        outcomeRef: "operator.cancelled",
      },
    );
  });

  it("does not turn a retry classification into work without an exact notBefore", async () => {
    const value = item(context());
    const attempt = fixture(value, async () => {
      throw new Error("handler failed");
    });
    attempt.classifier.classify = vi.fn(
      () =>
        ({
          kind: "RETRY" as const,
          retryClass: "transient" as const,
          reasonCode: "retry-without-deadline",
        }) as never,
    );

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "FAILED",
    });
    expect(Reflect.get(attempt.repository, "markRetryWait")).not.toHaveBeenCalled();
  });

  it("revalidates notBefore before claiming and preserves it in RETRY_WAIT", async () => {
    const value = item(context(), { notBefore: future });
    const attempt = fixture(value);

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "RETRY_WAIT",
    });
    expect(Reflect.get(attempt.lease, "reserveInvocation")).not.toHaveBeenCalled();
    expect(Reflect.get(attempt.repository, "markRetryWait")).toHaveBeenCalledWith(
      expect.objectContaining({
        retryClass: "transient",
        reasonCode: "not-before-not-yet-due",
        notBefore: future,
      }),
    );
  });

  it("terminalizes a forbidden external-effect-uncertain classification as invalid", async () => {
    const value = item(context());
    const attempt = fixture(value, async () => {
      throw new Error("handler failed");
    });
    attempt.classifier.classify = vi.fn(() => ({
      kind: "RETRY" as const,
      retryClass: "external-effect-uncertain" as const,
      reasonCode: "effect-uncertain",
      notBefore: future,
    }));

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "FAILED",
    });
    expect(Reflect.get(attempt.repository, "commitTerminal")).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: {
          schemaVersion: 1,
          kind: "FAILED",
          retryClass: "invalid",
          reasonCode: "work.external_effect_uncertain_unsupported",
        },
      }),
    );
  });

  it("validates and bounds handler output before terminal persistence", async () => {
    const value = item(context());
    const attempt = fixture(value, async () => ({
      outcome: { value: "x".repeat(2_000) } as never,
    }));

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "FAILED",
    });
    expect(Reflect.get(attempt.repository, "commitTerminal")).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: expect.objectContaining({
          kind: "FAILED",
          retryClass: "permanent",
        }),
      }),
    );
  });

  it("persists a detached outcome when the handler retains and mutates its result", async () => {
    const value = item(context());
    let handlerOutcome: { nested: { value: number } } | undefined;
    const attempt = fixture(value, async () => {
      handlerOutcome = { nested: { value: 1 } };
      return { outcome: handlerOutcome } as never;
    });

    await expect(attempt.executor.execute(value.workItemId, 1)).resolves.toMatchObject({
      status: "SUCCEEDED",
    });
    handlerOutcome!.nested.value = 9;

    const terminalInput = (
      attempt.repository.commitTerminal as ReturnType<typeof vi.fn>
    ).mock.calls[0]?.[0] as { readonly outcome: WorkItem["outcome"] };
    expect(terminalInput.outcome).toMatchObject({
      kind: "SUCCEEDED",
      value: { nested: { value: 1 } },
    });
    if (terminalInput.outcome?.kind === "SUCCEEDED") {
      expect(Object.isFrozen(terminalInput.outcome.value)).toBe(true);
    }
  });

  it("keeps secret handler diagnostics out of canonical failure details", async () => {
    const value = item(context());
    const attempt = fixture(value, async () => {
      throw new Error("secret-sentinel");
    });
    attempt.classifier.classify = vi.fn(({ failure }) => {
      expect(failure.detail).not.toContain("secret-sentinel");
      return {
        kind: "TERMINAL" as const,
        retryClass: "permanent" as const,
        reasonCode: "handler-exception",
      };
    });

    const result = await attempt.executor.execute(value.workItemId, 1);
    expect(JSON.stringify(result)).not.toContain("secret-sentinel");
  });

  it("propagates a Host fence loss when Tx B cannot commit", async () => {
    const value = item(context());
    const attempt = fixture(value);
    attempt.repository.commitTerminal = vi.fn(async () => {
      throw new ProblemError({
        schemaVersion: 1,
        problemCode: "persistence.host_fence.stale_owner",
        category: "conflict",
        retryClass: "after-change",
        title: "Host ownership fence belongs to another owner",
      });
    });

    await expect(attempt.executor.execute(value.workItemId, 1)).rejects.toMatchObject({
      problem: { problemCode: "persistence.host_fence.stale_owner" },
    });
  });
});

function inTransactionContext(value: WorkItem): PersistenceMutationTransactionContext {
  const activityId: ActivityId = createActivityId();
  const continuityEpochId: ContinuityEpochId = value.createdContinuityEpochId;
  return {
    mode: "MUTATION",
    execution: {
      activityId,
      installationId: createUuidV7Id("InstallationId"),
      instanceId: createInstanceId(),
      bootId: createUuidV7Id("BootId"),
      continuityEpochId,
      hostOwnershipToken: createUuidV7Id("HostOwnershipToken"),
    },
  };
}
