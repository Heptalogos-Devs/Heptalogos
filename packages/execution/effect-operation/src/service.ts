// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Orchestrates EffectOperation preparation, one admitted dispatch, bounded
 * uncertainty recovery, and read-only reconciliation around owned services.
 * @module service
 */

import {
  parseEffectKindId,
  parseEffectOperationId,
  snapshotCanonicalJson,
  type CanonicalJsonValue,
  type EffectKindId,
  type EffectOperationId,
} from "@heptalogos/foundation-contracts";
import type { EvidenceService } from "@heptalogos/evidence";
import type {
  ExecutionContextRuntime,
  ExecutionLineageService,
} from "@heptalogos/execution-lineage";
import type { PersistenceService } from "@heptalogos/persistence";
import type { TimeService } from "@heptalogos/time-service";
import {
  effectContextRequiredProblem,
  effectDispatchAbortedBeforeCallProblem,
  effectDispatchUncertainProblem,
  effectInvalidTransitionProblem,
  effectKindMismatchProblem,
  effectNotFoundProblem,
  effectReconciliationUnsupportedProblem,
  invalidEffectKindProblem,
  invalidEffectOperationIdProblem,
  invalidEffectRequestVersionProblem,
} from "./problems.js";
import {
  normalizeEffectProblem,
  snapshotEffectRequest,
  type EffectDispatchPort,
  type EffectDispatchResult,
  type EffectOperation,
  type EffectOperationService,
  type EffectOutcome,
  type EffectPreparationRequest,
  type EffectPreparationResult,
  type EffectReconciliationResult,
} from "./contracts.js";
import { createEffectOperationRepository } from "./repository.js";

/** Dependencies used by the canonical EffectOperation service. */
export interface EffectOperationServiceOptions {
  readonly persistence: PersistenceService;
  readonly execution: ExecutionContextRuntime;
  readonly lineage: ExecutionLineageService;
  readonly evidence: EvidenceService;
  readonly time: TimeService;
}

function requireEffectOperationId(value: unknown): EffectOperationId {
  const parsed = parseEffectOperationId(value);
  if (parsed === undefined) throw invalidEffectOperationIdProblem();
  return parsed;
}

function requireEffectKind(value: unknown): EffectKindId {
  const parsed = parseEffectKindId(value);
  if (parsed === undefined) throw invalidEffectKindProblem();
  return parsed;
}

function requireCurrent(execution: ExecutionContextRuntime): void {
  if (execution.current() === undefined) throw effectContextRequiredProblem();
}

function requireRequestVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw invalidEffectRequestVersionProblem();
  }
  return value;
}

function activityRequest(
  kind: string,
  effectOperationId: EffectOperationId,
): {
  readonly kind: string;
  readonly importance: "significant";
  readonly retentionClass: "retained";
  readonly sensitivity: "operational";
  readonly semantic: { readonly operationId: string; readonly contractVersion: "1" };
} {
  return {
    kind,
    importance: "significant",
    retentionClass: "retained",
    sensitivity: "operational",
    semantic: {
      operationId: effectOperationId,
      contractVersion: "1",
    },
  };
}

function evidenceDraft(
  evidenceKind: string,
  operation: EffectOperation,
  factRef?: string,
) {
  return {
    evidenceKind,
    evidenceContractVersion: "effect-operation.v1",
    subjectRef: operation.effectOperationId,
    objectRef: operation.state,
    ...(factRef === undefined ? {} : { factRef }),
    retentionClass: "retained" as const,
    sensitivity: "operational" as const,
  };
}

function completionRef(operation: EffectOperation): string {
  return `${operation.effectOperationId}:${operation.state}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function uncertainOutcome(
  detail: string,
): Extract<EffectOutcome, { readonly status: "UNCERTAIN" }> {
  return Object.freeze({
    schemaVersion: 1 as const,
    status: "UNCERTAIN" as const,
    problem: effectDispatchUncertainProblem(detail),
  });
}

function normalizeReceipt(
  value: unknown,
):
  | { readonly valid: true; readonly receipt?: CanonicalJsonValue }
  | { readonly valid: false } {
  try {
    if (value === undefined) return { valid: true };
    return {
      valid: true,
      receipt: snapshotCanonicalJson(value as CanonicalJsonValue).value,
    };
  } catch {
    return { valid: false };
  }
}

function normalizeDispatchResult(value: unknown): EffectOutcome {
  const result = asRecord(value);
  if (result === undefined || typeof result.status !== "string") {
    return uncertainOutcome("The effect adapter returned no definitive outcome");
  }
  if (result.status === "SUCCEEDED") {
    const receipt = normalizeReceipt(result.receipt);
    if (!receipt.valid) {
      return uncertainOutcome("The effect adapter returned a non-canonical receipt");
    }
    return Object.freeze({
      schemaVersion: 1 as const,
      status: "SUCCEEDED" as const,
      ...(receipt.receipt === undefined ? {} : { receipt: receipt.receipt }),
    });
  }
  if (result.status === "FAILED") {
    const problem = normalizeEffectProblem(result.problem);
    if (problem === undefined) {
      return uncertainOutcome(
        "The effect adapter did not provide definitive failure evidence",
      );
    }
    return Object.freeze({
      schemaVersion: 1 as const,
      status: "FAILED" as const,
      problem,
    });
  }
  if (result.status === "UNCERTAIN") {
    const problem =
      result.problem === undefined ? undefined : normalizeEffectProblem(result.problem);
    return Object.freeze({
      schemaVersion: 1 as const,
      status: "UNCERTAIN" as const,
      ...(problem === undefined ? {} : { problem }),
    });
  }
  return uncertainOutcome("The effect adapter returned an unsupported outcome status");
}

function normalizeReconciliationResult(value: unknown): EffectReconciliationResult {
  const result = asRecord(value);
  if (result === undefined || typeof result.status !== "string") {
    return { status: "UNKNOWN" };
  }
  if (result.status === "UNKNOWN") return { status: "UNKNOWN" };
  if (result.status === "SUCCEEDED") {
    const receipt = normalizeReceipt(result.receipt);
    if (!receipt.valid) return { status: "UNKNOWN" };
    return {
      status: "SUCCEEDED",
      ...(receipt.receipt === undefined ? {} : { receipt: receipt.receipt }),
    };
  }
  if (result.status === "FAILED") {
    const problem = normalizeEffectProblem(result.problem);
    return problem === undefined
      ? { status: "UNKNOWN" }
      : { status: "FAILED", problem };
  }
  return { status: "UNKNOWN" };
}

function assertPortKind(operation: EffectOperation, port: EffectDispatchPort): void {
  if (requireEffectKind(port.effectKind) !== operation.effectKind) {
    throw effectKindMismatchProblem();
  }
}

function outcomeForReconciliation(
  result: EffectReconciliationResult,
): Extract<EffectOutcome, { readonly status: "SUCCEEDED" | "FAILED" }> | undefined {
  if (result.status === "SUCCEEDED") {
    return Object.freeze({
      schemaVersion: 1 as const,
      status: "SUCCEEDED" as const,
      ...(result.receipt === undefined ? {} : { receipt: result.receipt }),
    });
  }
  if (result.status === "FAILED") {
    return Object.freeze({
      schemaVersion: 1 as const,
      status: "FAILED" as const,
      problem: result.problem,
    });
  }
  return undefined;
}

/** Creates the canonical EffectOperation service. */
export function createEffectOperationService(
  options: EffectOperationServiceOptions,
): EffectOperationService {
  const repository = createEffectOperationRepository();

  const get = async (
    effectOperationId: EffectOperationId,
  ): Promise<EffectOperation | undefined> => {
    const id = requireEffectOperationId(effectOperationId);
    return options.persistence.read((context) => repository.get(context, id));
  };

  const recoverDispatch = async (
    effectOperationId: EffectOperationId,
  ): Promise<EffectOperation> => {
    const id = requireEffectOperationId(effectOperationId);
    requireCurrent(options.execution);
    const current = await get(id);
    if (current === undefined) throw effectNotFoundProblem();
    if (current.state === "PREPARED") {
      throw effectInvalidTransitionProblem("PREPARED", "UNCERTAIN");
    }
    if (current.state !== "DISPATCHING") return current;
    return options.execution.runActivity(
      activityRequest("effect.recover-uncertain", id),
      async (context) => {
        const recoveryOutcome: Extract<
          EffectOutcome,
          { readonly status: "UNCERTAIN" }
        > = uncertainOutcome(
          "Dispatch admission was durable, but the external effect outcome was not canonically known",
        );
        return options.persistence.mutate(async (transaction) => {
          const recovered = await repository.recoverDispatchAsUncertain(
            transaction,
            id,
            recoveryOutcome,
            options.time.now(),
          );
          if (!recovered.changed) {
            await options.lineage.retainCurrent(transaction, context);
            await options.lineage.completeCurrent(transaction, context, {
              endedAt: options.time.now(),
              outcome: "SUCCEEDED",
              outcomeRef: completionRef(recovered.operation),
            });
            return recovered.operation;
          }
          await options.lineage.retainCurrent(transaction, context);
          await options.evidence.recordRequired(
            transaction,
            evidenceDraft("effect.outcome", recovered.operation, "recovered"),
          );
          await options.lineage.completeCurrent(transaction, context, {
            endedAt: options.time.now(),
            outcome: "SUCCEEDED",
            outcomeRef: completionRef(recovered.operation),
          });
          return recovered.operation;
        });
      },
    );
  };

  const service: EffectOperationService = {
    get,

    async prepare(request: EffectPreparationRequest): Promise<EffectPreparationResult> {
      const effectOperationId = requireEffectOperationId(request.effectOperationId);
      const effectKind = requireEffectKind(request.effectKind);
      const requestVersion = requireRequestVersion(request.requestVersion);
      const requestSnapshot = snapshotEffectRequest(request.request);
      requireCurrent(options.execution);
      return options.execution.runActivity(
        activityRequest("effect.prepare", effectOperationId),
        async (context) => {
          const lineageContextRef = options.execution.createLineageContextRef();
          const operation = await options.persistence.mutate(async (transaction) => {
            const result = await repository.insertPrepared(transaction, {
              effectOperationId,
              effectKind,
              requestVersion,
              request: requestSnapshot,
              lineageContextRef,
              createdAt: options.time.now(),
            });
            await options.lineage.retainCurrent(transaction, context);
            await options.evidence.recordRequired(
              transaction,
              evidenceDraft("effect.prepared", result.operation),
            );
            await options.lineage.completeCurrent(transaction, context, {
              endedAt: options.time.now(),
              outcome: "SUCCEEDED",
              outcomeRef: completionRef(result.operation),
            });
            return result;
          });
          return operation;
        },
      );
    },
    recoverDispatch,

    async dispatch(
      effectOperationId: EffectOperationId,
      port: EffectDispatchPort,
      dispatchOptions,
    ): Promise<EffectOperation> {
      const id = requireEffectOperationId(effectOperationId);
      const operation = await get(id);
      if (operation === undefined) throw effectNotFoundProblem();
      assertPortKind(operation, port);
      requireCurrent(options.execution);
      if (operation.state === "DISPATCHING") return operation;
      if (operation.state !== "PREPARED") return operation;

      return options.execution.runActivity(
        activityRequest("effect.dispatch", id),
        async (context) => {
          const admission = await options.persistence.mutate(async (transaction) => {
            const result = await repository.beginDispatch(
              transaction,
              id,
              options.time.now(),
            );
            if (result.status === "ADMITTED") {
              await options.lineage.retainCurrent(transaction, context);
              await options.evidence.recordRequired(
                transaction,
                evidenceDraft("effect.dispatch-started", result.operation),
              );
            }
            return result;
          });
          if (admission.status !== "ADMITTED") {
            return admission.operation;
          }

          const signal = dispatchOptions?.signal ?? new AbortController().signal;
          let outcome: EffectOutcome;
          if (signal.aborted) {
            outcome = Object.freeze({
              schemaVersion: 1 as const,
              status: "FAILED" as const,
              problem: effectDispatchAbortedBeforeCallProblem(),
            });
          } else {
            let result: EffectDispatchResult;
            try {
              result = await port.dispatch({
                effectOperationId: id,
                externalRequestKey: id,
                requestVersion: admission.operation.requestVersion,
                request: admission.operation.request,
                signal,
              });
            } catch {
              result = {
                status: "UNCERTAIN",
                problem: effectDispatchUncertainProblem(
                  "The external adapter failed after dispatch admission",
                ),
              };
            }
            outcome = normalizeDispatchResult(result);
          }

          return options.persistence.mutate(async (transaction) => {
            const completed = await repository.completeDispatch(
              transaction,
              id,
              outcome,
              options.time.now(),
            );
            await options.evidence.recordRequired(
              transaction,
              evidenceDraft("effect.outcome", completed, outcome.status),
            );
            await options.lineage.completeCurrent(transaction, context, {
              endedAt: options.time.now(),
              outcome: "SUCCEEDED",
              outcomeRef: completionRef(completed),
            });
            return completed;
          });
        },
      );
    },

    async reconcile(
      effectOperationId: EffectOperationId,
      port: EffectDispatchPort,
      reconcileOptions,
    ): Promise<EffectOperation> {
      // Intentional duplication: dispatch and reconcile share the lookup and
      // current-execution fence, then diverge into different state machines.
      /* jscpd:ignore-start */
      const id = requireEffectOperationId(effectOperationId);
      const operation = await get(id);
      if (operation === undefined) throw effectNotFoundProblem();
      assertPortKind(operation, port);
      requireCurrent(options.execution);
      if (operation.state !== "UNCERTAIN") return operation;
      /* jscpd:ignore-end */
      if (port.reconcile === undefined) {
        throw effectReconciliationUnsupportedProblem();
      }
      return options.execution.runActivity(
        activityRequest("effect.reconcile", id),
        async (context) => {
          const signal = reconcileOptions?.signal ?? new AbortController().signal;
          let observation: EffectReconciliationResult = { status: "UNKNOWN" };
          if (!signal.aborted) {
            try {
              observation = normalizeReconciliationResult(
                await port.reconcile!({
                  effectOperationId: id,
                  externalRequestKey: id,
                  requestVersion: operation.requestVersion,
                  request: operation.request,
                  signal,
                }),
              );
            } catch {
              observation = { status: "UNKNOWN" };
            }
          }
          const refinement = outcomeForReconciliation(observation);
          return options.persistence.mutate(async (transaction) => {
            const current = await repository.getInMutation(transaction, id);
            if (current === undefined) throw effectNotFoundProblem();
            let resolved = current;
            if (refinement !== undefined && current.state === "UNCERTAIN") {
              resolved = (
                await repository.refineUncertain(
                  transaction,
                  id,
                  refinement,
                  options.time.now(),
                )
              ).operation;
            }
            await options.lineage.retainCurrent(transaction, context);
            await options.evidence.recordRequired(
              transaction,
              evidenceDraft("effect.reconciled", resolved, observation.status),
            );
            await options.lineage.completeCurrent(transaction, context, {
              endedAt: options.time.now(),
              outcome: "SUCCEEDED",
              outcomeRef: completionRef(resolved),
            });
            return resolved;
          });
        },
      );
    },
  };

  return Object.freeze(service);
}
