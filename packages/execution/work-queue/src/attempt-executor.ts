// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Executes one generation-pinned WorkHandler attempt with bounded outcome and
 * failure classification while keeping engine semantics outside the queue.
 * @module attempt-executor
 */

import {
  parseInstant,
  ProblemError,
  snapshotCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionContext,
  ExecutionContextRuntime,
  ExecutionLineageService,
  LineageContextRefV1,
} from "@heptalogos/execution-lineage";
import type { RuntimeActivityRunner } from "@heptalogos/execution-lineage/runtime-kernel";
import type { RuntimeWorkHandlerInvocationReservation } from "@heptalogos/runtime-kernel";
import type { TimeService } from "@heptalogos/time-service";
import { createDispatchAttemptId } from "./attempt-identity.js";
import type {
  WorkErrorClassifier,
  WorkErrorDecision,
  WorkItem,
  WorkItemOutcome,
  WorkQueueRuntimeOptions,
  WorkRetryClass,
} from "./contracts.js";
import {
  type MutationAppliedHook,
  type WorkItemMutationResult,
  type WorkQueueRepository,
} from "./repository.js";
import {
  type WorkHandlerResolver,
  validateWorkQueueRuntimeOptions,
} from "./service.js";
import { workQueueProblem } from "./problems.js";

const TERMINAL_STATES = new Set<WorkItem["state"]>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
]);

const RETRY_CLASSES = new Set<WorkRetryClass>([
  "transient",
  "rate-limited",
  "dependency-unavailable",
  "not-configured",
  "policy-blocked",
  "invalid",
  "permanent",
  "external-effect-uncertain",
]);

/** Observable result states returned after one generation-pinned attempt. */
export type WorkAttemptExecutionStatus =
  | "NOT_FOUND"
  | "TERMINAL_REPLAY"
  | "STALE_NOOP"
  | "WAITING_DEPENDENCY"
  | "RETRY_WAIT"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "SUPERSEDED";

/** Outcome of executing or replaying one durable dispatch attempt. */
export interface WorkAttemptExecutionResult {
  readonly status: WorkAttemptExecutionStatus;
  readonly item?: WorkItem;
  readonly outcome?: WorkItemOutcome;
}

/** Dependencies and bounded policy required by the attempt coordinator. */
export interface WorkAttemptExecutorOptions {
  readonly repository: WorkQueueRepository;
  readonly handlerRegistry: WorkHandlerResolver;
  readonly execution: ExecutionContextRuntime;
  readonly lineage: ExecutionLineageService;
  readonly time: TimeService;
  readonly classifier: WorkErrorClassifier;
  readonly runtimeOptions: WorkQueueRuntimeOptions;
}

/** Coordinates one WorkItem attempt through admission, execution, and persistence. */
export interface WorkAttemptExecutor {
  /** Execute the expected revision or return a fenced/replay status. */
  execute(
    workItemId: WorkItem["workItemId"],
    expectedRevision: number,
  ): Promise<WorkAttemptExecutionResult>;
}

function isTerminal(state: WorkItem["state"]): boolean {
  return TERMINAL_STATES.has(state);
}

function validateRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw workQueueProblem(
      "work_queue.invalid_work_item",
      "expectedRevision must be a positive safe integer",
    );
  }
}

function resultForMutation(result: WorkItemMutationResult): WorkAttemptExecutionResult {
  if (result.status === "NOT_FOUND") return { status: "NOT_FOUND" };
  if (result.status === "STALE") {
    return { status: "STALE_NOOP", item: result.item };
  }
  if (result.status === "TERMINAL") {
    return {
      status: "TERMINAL_REPLAY",
      item: result.item,
      outcome: result.item?.outcome,
    };
  }
  const item = result.item;
  if (item === undefined) {
    throw workQueueProblem(
      "work_queue.invalid_work_item",
      "APPLIED WorkItem mutation did not return its row",
    );
  }
  return {
    status: item.state as WorkAttemptExecutionStatus,
    item,
    outcome: item.outcome,
  };
}

function normalizeFailure(error: unknown): {
  readonly reasonCode: string;
  readonly detail: string;
} {
  if (error instanceof ProblemError) {
    return {
      reasonCode: error.problem.problemCode,
      detail: "WorkHandler invocation failed",
    };
  }
  return {
    reasonCode: "work.handler.exception",
    detail: "WorkHandler invocation failed",
  };
}

function safeReasonCode(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).byteLength > 256
  ) {
    return undefined;
  }
  return value;
}

function safeRetryClass(value: unknown): WorkRetryClass | undefined {
  return typeof value === "string" && RETRY_CLASSES.has(value as WorkRetryClass)
    ? (value as WorkRetryClass)
    : undefined;
}

function classifyFailure(
  classifier: WorkErrorClassifier,
  item: WorkItem,
  error: unknown,
): WorkErrorDecision {
  const failure = normalizeFailure(error);
  let decision: WorkErrorDecision;
  try {
    decision = classifier.classify({ workItem: item, failure });
  } catch {
    return {
      kind: "TERMINAL",
      retryClass: "permanent",
      reasonCode: "work.failure.unclassified",
    };
  }
  const retryClass = safeRetryClass(decision?.retryClass);
  const reasonCode = safeReasonCode(decision?.reasonCode);
  if (retryClass === "external-effect-uncertain") {
    return {
      kind: "TERMINAL",
      retryClass: "invalid",
      reasonCode: "work.external_effect_uncertain_unsupported",
    };
  }
  if (reasonCode === undefined || retryClass === undefined) {
    return {
      kind: "TERMINAL",
      retryClass: "permanent",
      reasonCode: "work.failure.unclassified",
    };
  }
  if (decision.kind === "RETRY") {
    const notBefore = parseInstant(decision.notBefore);
    if (notBefore === undefined) {
      return {
        kind: "TERMINAL",
        retryClass: "permanent",
        reasonCode: "work.retry.not_before_required",
      };
    }
    return { kind: "RETRY", retryClass, reasonCode, notBefore };
  }
  if (decision.kind === "TERMINAL") {
    return { kind: "TERMINAL", retryClass, reasonCode };
  }
  return {
    kind: "TERMINAL",
    retryClass: "permanent",
    reasonCode: "work.failure.unclassified",
  };
}

function cancellationOutcome(
  item: WorkItem,
): Extract<WorkItemOutcome, { kind: "CANCELLED" | "SUPERSEDED" }> | undefined {
  if (item.cancelRequestedAt !== undefined) {
    return {
      schemaVersion: 1,
      kind: "CANCELLED",
      reasonCode: item.cancellationReasonCode ?? "cancellation-requested",
    };
  }
  if (item.supersededBy !== undefined) {
    return {
      schemaVersion: 1,
      kind: "SUPERSEDED",
      reasonCode: "superseded-by-request",
      supersededBy: item.supersededBy,
    };
  }
  return undefined;
}

function outcomeForActivity(item: WorkItem): "SUCCEEDED" | "FAILED" | "CANCELLED" {
  if (item.state === "SUCCEEDED") return "SUCCEEDED";
  if (item.state === "CANCELLED" || item.state === "SUPERSEDED") return "CANCELLED";
  return "FAILED";
}

function completeActivityHook(
  options: WorkAttemptExecutorOptions,
  activity: ExecutionContext,
  outcomeRef?: string,
  retainBeforeComplete = false,
): MutationAppliedHook {
  return async (transaction, completed) => {
    if (retainBeforeComplete) {
      await options.lineage.retainCurrent(transaction, activity);
    }
    await options.lineage.completeCurrent(transaction, activity, {
      endedAt: options.time.now(),
      outcome: outcomeForActivity(completed),
      ...(outcomeRef === undefined ? {} : { outcomeRef }),
    });
  };
}

function earlyActivityHook(
  options: WorkAttemptExecutorOptions,
  activity: ExecutionContext,
  fallbackOutcomeRef: string,
): MutationAppliedHook {
  return async (transaction, item) => {
    let outcome: "SUCCEEDED" | "FAILED" | "CANCELLED";
    let outcomeRef = fallbackOutcomeRef;
    if (item.state === "WAITING_DEPENDENCY") {
      outcome = "SUCCEEDED";
      outcomeRef = "WAITING_DEPENDENCY";
    } else if (item.state === "RETRY_WAIT") {
      outcome = "SUCCEEDED";
      outcomeRef = "RETRY_WAIT";
    } else if (item.state === "FAILED") {
      outcome = "FAILED";
      if (item.outcome?.kind === "FAILED") outcomeRef = item.outcome.reasonCode;
    } else if (item.state === "CANCELLED" || item.state === "SUPERSEDED") {
      outcome = "CANCELLED";
      if (item.outcome?.kind === "CANCELLED") outcomeRef = item.outcome.reasonCode;
      if (item.outcome?.kind === "SUPERSEDED") outcomeRef = item.outcome.reasonCode;
    } else {
      outcome = "FAILED";
    }
    await options.lineage.retainCurrent(transaction, activity);
    await options.lineage.completeCurrent(transaction, activity, {
      endedAt: options.time.now(),
      outcome,
      outcomeRef,
    });
  };
}

function outputValue(value: unknown, maximumBytes: number): CanonicalJsonValue {
  let snapshot: ReturnType<typeof snapshotCanonicalJson>;
  try {
    snapshot = snapshotCanonicalJson(value as CanonicalJsonValue);
  } catch (cause) {
    throw workQueueProblem(
      "work.outcome.invalid",
      "WorkHandler outcome is not canonical JSON",
      cause,
    );
  }
  if (snapshot.utf8ByteLength > maximumBytes) {
    throw workQueueProblem(
      "work.outcome.too_large",
      "WorkHandler outcome exceeds maxOutcomeBytes",
    );
  }
  return snapshot.value;
}

function isPayloadDependencyProblem(error: unknown): boolean {
  if (!(error instanceof ProblemError)) return false;
  return (
    error.problem.problemCode === "runtime.work_handler.payload_version_unavailable" ||
    error.problem.problemCode === "runtime.generation.retired"
  );
}

function payloadValidationReasonCode(error: unknown): string {
  if (
    error instanceof ProblemError &&
    error.problem.problemCode === "runtime.work_handler.payload_invalid"
  ) {
    return error.problem.problemCode;
  }
  return "work.handler.payload_invalid";
}

function runAttemptActivity<T>(
  execution: ExecutionContextRuntime,
  runtimeActivity: RuntimeActivityRunner | undefined,
  ref: LineageContextRefV1,
  operation: (context: ExecutionContext) => Promise<T>,
): Promise<T> {
  const request = {
    kind: "work.execute",
    importance: "significant" as const,
    retentionClass: "operational" as const,
    sensitivity: "operational" as const,
  };
  if (runtimeActivity?.runFromLineageContextRef !== undefined) {
    return runtimeActivity.runFromLineageContextRef(ref, request, operation);
  }
  return execution.runFromLineageContextRef(ref, request, operation);
}

function monitorCancellation(
  repository: WorkQueueRepository,
  workItemId: WorkItem["workItemId"],
  expectedRevision: number,
  controller: AbortController,
  intervalMs: number,
): () => void {
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = async (): Promise<void> => {
    if (closed || controller.signal.aborted) return;
    try {
      const current = await repository.getWorkItem(workItemId);
      if (
        current !== undefined &&
        current.dispatchRevision === expectedRevision &&
        (current.cancelRequestedAt !== undefined || current.supersededBy !== undefined)
      ) {
        controller.abort();
        return;
      }
    } catch {
      // Tx B remains the authoritative fence when the monitor cannot read.
    }
    if (!closed && !controller.signal.aborted) {
      timer = setTimeout(() => {
        void check();
      }, intervalMs);
    }
  };
  timer = setTimeout(() => {
    void check();
  }, intervalMs);
  return () => {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
}

/** Create an attempt executor with repository-owned mutation and lifecycle fencing. */
export function createWorkAttemptExecutor(
  options: WorkAttemptExecutorOptions,
): WorkAttemptExecutor {
  validateWorkQueueRuntimeOptions(options.runtimeOptions);
  if (typeof options.classifier?.classify !== "function") {
    throw workQueueProblem(
      "work.classifier.required",
      "WorkAttemptExecutor requires an explicit WorkErrorClassifier",
    );
  }

  return {
    async execute(workItemId, expectedRevision) {
      validateRevision(expectedRevision);
      const item = await options.repository.getWorkItem(workItemId);
      if (item === undefined) return { status: "NOT_FOUND" };
      if (isTerminal(item.state)) {
        return {
          status: "TERMINAL_REPLAY",
          item,
          outcome: item.outcome,
        };
      }
      if (item.dispatchRevision !== expectedRevision) {
        return { status: "STALE_NOOP", item };
      }

      const recoveringRunning = item.state === "RUNNING";
      if (!recoveringRunning && item.state !== "PENDING") {
        return { status: "STALE_NOOP", item };
      }
      const expectedAttemptId = createDispatchAttemptId(
        item.workItemId,
        expectedRevision,
      );
      if (recoveringRunning && item.activeAttemptId !== expectedAttemptId) {
        throw workQueueProblem(
          "work.recovery.active_attempt_mismatch",
          "RUNNING WorkItem activeAttemptId does not match its deterministic revision identity",
        );
      }

      const requestedTerminal = cancellationOutcome(item);
      const lease =
        requestedTerminal === undefined
          ? options.handlerRegistry.resolve(item.handler)
          : undefined;
      if (recoveringRunning && requestedTerminal === undefined && lease === undefined) {
        throw workQueueProblem(
          "work.recovery.handler_generation_missing",
          "The exact generation-bound WorkHandler is unavailable for RUNNING recovery",
        );
      }

      return runAttemptActivity(
        options.execution,
        lease?.runtimeActivity,
        item.lineageContextRef,
        async (activity: ExecutionContext) => {
          const expectedState = recoveringRunning ? "RUNNING" : "PENDING";
          const expectedActiveAttemptId = recoveringRunning
            ? expectedAttemptId
            : undefined;
          const waitForDependency = async (): Promise<WorkAttemptExecutionResult> =>
            resultForMutation(
              await options.repository.markWaitingDependency({
                workItemId: item.workItemId,
                expectedDispatchRevision: item.dispatchRevision,
                updatedAt: options.time.now(),
                onApplied: earlyActivityHook(options, activity, "WAITING_DEPENDENCY"),
              }),
            );
          if (requestedTerminal !== undefined) {
            return resultForMutation(
              await options.repository.commitTerminal({
                workItemId: item.workItemId,
                expectedDispatchRevision: item.dispatchRevision,
                expectedState,
                ...(expectedActiveAttemptId === undefined
                  ? {}
                  : { expectedActiveAttemptId }),
                outcome: requestedTerminal,
                updatedAt: options.time.now(),
                onApplied: earlyActivityHook(
                  options,
                  activity,
                  requestedTerminal.reasonCode,
                ),
              }),
            );
          }

          if (lease === undefined) return waitForDependency();

          let payload: unknown;
          try {
            payload = snapshotCanonicalJson(
              lease.validatePayload(
                item.handler.payloadVersion,
                item.payload,
              ) as CanonicalJsonValue,
            ).value;
          } catch (error) {
            if (isPayloadDependencyProblem(error)) {
              if (recoveringRunning) {
                throw workQueueProblem(
                  "work.recovery.handler_generation_missing",
                  "The exact generation-bound WorkHandler cannot validate the RUNNING recovery payload",
                  error,
                );
              }
              return waitForDependency();
            }
            const reasonCode = payloadValidationReasonCode(error);
            return resultForMutation(
              await options.repository.commitTerminal({
                workItemId: item.workItemId,
                expectedDispatchRevision: item.dispatchRevision,
                expectedState,
                ...(expectedActiveAttemptId === undefined
                  ? {}
                  : { expectedActiveAttemptId }),
                outcome: {
                  schemaVersion: 1,
                  kind: "FAILED",
                  retryClass: "invalid",
                  reasonCode,
                },
                updatedAt: options.time.now(),
                onApplied: earlyActivityHook(options, activity, reasonCode),
              }),
            );
          }

          const now = options.time.now();
          if (
            item.notBefore !== undefined &&
            Date.parse(item.notBefore) > Date.parse(now)
          ) {
            return resultForMutation(
              await options.repository.markRetryWait({
                workItemId: item.workItemId,
                expectedDispatchRevision: item.dispatchRevision,
                expectedState,
                ...(expectedActiveAttemptId === undefined
                  ? {}
                  : { expectedActiveAttemptId }),
                retryClass: "transient",
                reasonCode: "not-before-not-yet-due",
                notBefore: item.notBefore,
                updatedAt: now,
                onApplied: earlyActivityHook(options, activity, "RETRY_WAIT"),
              }),
            );
          }

          let reservation: RuntimeWorkHandlerInvocationReservation;
          if (recoveringRunning) {
            try {
              reservation = lease.reserveInvocation();
            } catch (error) {
              throw workQueueProblem(
                "work.recovery.handler_generation_missing",
                "The exact generation-bound WorkHandler could not be reserved for RUNNING recovery",
                error,
              );
            }
          } else {
            try {
              reservation = lease.reserveInvocation();
            } catch (error) {
              if (
                error instanceof ProblemError &&
                error.problem.problemCode === "runtime.generation.retired"
              ) {
                return resultForMutation(
                  await options.repository.markWaitingDependency({
                    workItemId: item.workItemId,
                    expectedDispatchRevision: item.dispatchRevision,
                    updatedAt: options.time.now(),
                    onApplied: earlyActivityHook(
                      options,
                      activity,
                      "WAITING_DEPENDENCY",
                    ),
                  }),
                );
              }
              throw error;
            }
          }

          let running: WorkItem;
          if (recoveringRunning) {
            running = item;
          } else {
            let claimed: WorkItemMutationResult;
            try {
              claimed = await options.repository.markRunning({
                workItemId: item.workItemId,
                expectedDispatchRevision: item.dispatchRevision,
                activeAttemptId: expectedAttemptId,
                updatedAt: options.time.now(),
                onApplied: async (transaction, _running) => {
                  await options.lineage.retainCurrent(transaction, activity);
                },
              });
            } catch (error) {
              reservation.release();
              throw error;
            }
            if (claimed.status !== "APPLIED" || claimed.item === undefined) {
              reservation.release();
              const racedRequest =
                claimed.item === undefined
                  ? undefined
                  : cancellationOutcome(claimed.item);
              if (
                claimed.status === "STALE" &&
                claimed.item?.state === "PENDING" &&
                racedRequest !== undefined
              ) {
                return resultForMutation(
                  await options.repository.commitTerminal({
                    workItemId: claimed.item.workItemId,
                    expectedDispatchRevision: claimed.item.dispatchRevision,
                    expectedState: "PENDING",
                    outcome: racedRequest,
                    updatedAt: options.time.now(),
                    onApplied: earlyActivityHook(
                      options,
                      activity,
                      racedRequest.reasonCode,
                    ),
                  }),
                );
              }
              return resultForMutation(claimed);
            }
            running = claimed.item;
          }
          const abortController = new AbortController();
          let successOutcome: WorkItemOutcome;
          try {
            const stopCancellationMonitor = monitorCancellation(
              options.repository,
              running.workItemId,
              running.dispatchRevision,
              abortController,
              options.runtimeOptions.antiEntropyIntervalMs,
            );
            let handlerResult: { readonly outcome: unknown };
            try {
              handlerResult = await reservation.execute({
                workItemId: running.workItemId,
                dispatchRevision: running.dispatchRevision,
                payloadVersion: running.handler.payloadVersion,
                payload: payload as never,
                signal: abortController.signal,
              });
            } finally {
              stopCancellationMonitor();
            }
            const value = outputValue(
              handlerResult.outcome,
              options.runtimeOptions.maxOutcomeBytes,
            );
            successOutcome = {
              schemaVersion: 1,
              kind: "SUCCEEDED",
              value,
            };
          } catch (error) {
            const decision = classifyFailure(options.classifier, running, error);
            if (decision.kind === "RETRY") {
              const retried = await options.repository.markRetryWait({
                workItemId: running.workItemId,
                expectedDispatchRevision: running.dispatchRevision,
                expectedState: "RUNNING",
                expectedActiveAttemptId: expectedAttemptId,
                retryClass: decision.retryClass,
                reasonCode: decision.reasonCode,
                notBefore: decision.notBefore,
                updatedAt: options.time.now(),
                onApplied: completeActivityHook(
                  options,
                  activity,
                  decision.reasonCode,
                  recoveringRunning,
                ),
              });
              return resultForMutation(retried);
            }
            const failed = await options.repository.commitTerminal({
              workItemId: running.workItemId,
              expectedDispatchRevision: running.dispatchRevision,
              expectedState: "RUNNING",
              expectedActiveAttemptId: expectedAttemptId,
              outcome: {
                schemaVersion: 1,
                kind: "FAILED",
                retryClass: decision.retryClass,
                reasonCode: decision.reasonCode,
              },
              updatedAt: options.time.now(),
              onApplied: completeActivityHook(
                options,
                activity,
                decision.reasonCode,
                recoveringRunning,
              ),
            });
            return resultForMutation(failed);
          }
          const committed = await options.repository.commitTerminal({
            workItemId: running.workItemId,
            expectedDispatchRevision: running.dispatchRevision,
            expectedState: "RUNNING",
            expectedActiveAttemptId: expectedAttemptId,
            outcome: successOutcome,
            updatedAt: options.time.now(),
            onApplied: completeActivityHook(
              options,
              activity,
              undefined,
              recoveringRunning,
            ),
          });
          return resultForMutation(committed);
        },
      );
    },
  };
}
