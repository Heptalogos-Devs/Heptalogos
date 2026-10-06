// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Maps EffectOperation failures to canonical Foundation Problems without
 * leaking provider, database, or transport exception shapes.
 * @module problems
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

function effectProblem(
  problemCode: string,
  category: Problem["category"],
  retryClass: Problem["retryClass"],
  title: string,
  detail: string,
  cause?: unknown,
): ProblemError {
  return createProblemError(
    { problemCode, category, retryClass, title, detail },
    cause === undefined ? undefined : { cause },
  );
}

/** Reports an invalid EffectOperation UUID identity. */
export function invalidEffectOperationIdProblem(): ProblemError {
  return effectProblem(
    "effect.operation_id.invalid",
    "validation",
    "never",
    "EffectOperationId is invalid",
    "EffectOperationId must be a UUIDv7 value",
  );
}

/** Reports an invalid EffectKind identity. */
export function invalidEffectKindProblem(): ProblemError {
  return effectProblem(
    "effect.kind.invalid",
    "validation",
    "never",
    "EffectKindId is invalid",
    "EffectKindId must be a lowercase namespaced identity",
  );
}

/** Reports a request version outside the current positive-integer contract. */
export function invalidEffectRequestVersionProblem(): ProblemError {
  return effectProblem(
    "effect.request_version.invalid",
    "validation",
    "never",
    "Effect request version is invalid",
    "Effect request version must be a positive integer",
  );
}

/** Reports a request that cannot be snapshotted as canonical JSON. */
export function invalidEffectRequestProblem(
  detail: string,
  cause?: unknown,
): ProblemError {
  return effectProblem(
    "effect.request.invalid",
    "validation",
    "never",
    "Effect request is invalid",
    detail,
    cause,
  );
}

/** Reports a missing current ExecutionContext for a mutating effect operation. */
export function effectContextRequiredProblem(): ProblemError {
  return effectProblem(
    "effect.context.required",
    "conflict",
    "after-change",
    "Effect operation requires an execution context",
    "EffectOperation mutation requires a current ExecutionContext",
  );
}

/** Reports an immutable identity conflict during preparation. */
export function effectIdentityConflictProblem(): ProblemError {
  return effectProblem(
    "effect.identity_conflict",
    "conflict",
    "manual",
    "EffectOperation identity conflicts with existing truth",
    "The same EffectOperationId already carries a different immutable request",
  );
}

/** Reports an operation that is absent from canonical persistence. */
export function effectNotFoundProblem(): ProblemError {
  return effectProblem(
    "effect.operation.not_found",
    "integrity",
    "manual",
    "EffectOperation was not found",
    "The requested EffectOperation does not exist in canonical persistence",
  );
}

/** Reports a persisted row outside the strict current V1 contract. */
export function invalidEffectRowProblem(detail: string, cause?: unknown): ProblemError {
  return effectProblem(
    "effect.row.invalid",
    "integrity",
    "manual",
    "Persisted EffectOperation is invalid",
    detail,
    cause,
  );
}

/** Reports an unsupported persisted EffectOperation version. */
export function unsupportedEffectSchemaProblem(): ProblemError {
  return effectProblem(
    "effect.schema.unsupported",
    "integrity",
    "manual",
    "EffectOperation schema version is unsupported",
    "Only EffectOperation schemaVersion 1 is supported",
  );
}

/** Reports an illegal canonical state transition. */
export function effectInvalidTransitionProblem(from: string, to: string): ProblemError {
  return effectProblem(
    "effect.transition.invalid",
    "conflict",
    "manual",
    "EffectOperation state transition is invalid",
    `The transition from ${from} to ${to} is not allowed`,
  );
}

/** Reports a dispatch port whose semantic kind does not match the operation. */
export function effectKindMismatchProblem(): ProblemError {
  return effectProblem(
    "effect.kind.mismatch",
    "conflict",
    "never",
    "Effect dispatch port kind does not match",
    "The exact effect-specific port must handle the persisted EffectKindId",
  );
}

/** Reports a stale or non-authoritative effect mutation attempt. */
export function effectHostFenceProblem(): ProblemError {
  return effectProblem(
    "effect.host_fence.rejected",
    "conflict",
    "after-change",
    "EffectOperation Host fence rejected the mutation",
    "Only the current Host ownership context may commit the effect transition",
  );
}

/** Reports an invalid adapter result conservatively as an uncertain observation. */
export function effectDispatchUncertainProblem(detail: string): Problem {
  return {
    schemaVersion: 1,
    problemCode: "effect.dispatch.uncertain",
    category: "unavailable",
    retryClass: "manual",
    title: "External effect outcome is uncertain",
    detail,
  };
}

/** Reports that a pre-call abort proved the external call was not invoked. */
export function effectDispatchAbortedBeforeCallProblem(): Problem {
  return {
    schemaVersion: 1,
    problemCode: "effect.dispatch.aborted_before_call",
    category: "conflict",
    retryClass: "after-change",
    title: "Effect dispatch was aborted before the external call",
    detail:
      "The dispatch admission was committed but the external port was not invoked",
  };
}

/** Reports that the exact port has no read-only reconciliation operation. */
export function effectReconciliationUnsupportedProblem(): ProblemError {
  return effectProblem(
    "effect.reconcile.unsupported",
    "unavailable",
    "after-change",
    "Effect reconciliation is unavailable",
    "The exact effect port does not expose a read-only reconciliation operation",
  );
}
