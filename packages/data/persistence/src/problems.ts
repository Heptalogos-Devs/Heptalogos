// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Normalizes persistence failures into shared Problem envelopes while retaining
 * enough classification to distinguish fencing, transaction, and setup errors.
 * @module problems
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

function persistenceProblem(
  problemCode: string,
  category: Problem["category"],
  retryClass: Problem["retryClass"],
  title: string,
  detail: string,
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass,
    title,
    detail,
  });
}

/** Reports persistence admission after Host fencing. */
export function persistenceServiceFencedProblem(): ProblemError {
  return persistenceProblem(
    "persistence.service.fenced",
    "conflict",
    "after-change",
    "Persistence service is fenced",
    "The Host ownership authority is no longer active; new persistence admission is denied",
  );
}

/** Reports persistence admission after terminal service close. */
export function persistenceServiceClosedProblem(): ProblemError {
  return persistenceProblem(
    "persistence.service.closed",
    "conflict",
    "manual",
    "Persistence service is closed",
    "The persistence service cannot admit work after closing or terminal shutdown",
  );
}

/** Reports a transaction context not issued by persistence. */
export function persistenceTransactionContextInvalidProblem(): ProblemError {
  return persistenceProblem(
    "persistence.transaction.context_invalid",
    "integrity",
    "manual",
    "Persistence transaction context is invalid",
    "The transaction context was not issued by the current persistence service",
  );
}

/** Reports a mutation without current execution identity. */
export function persistenceExecutionContextRequiredProblem(): ProblemError {
  return persistenceProblem(
    "persistence.execution_context.required",
    "conflict",
    "after-change",
    "Persistence mutation requires an execution context",
    "A canonical mutation must be admitted from a current Activity execution identity",
  );
}

/** Reports execution metadata that no longer matches active Host authority. */
export function persistenceExecutionContextStaleOriginProblem(): ProblemError {
  return persistenceProblem(
    "persistence.execution_context.stale_origin",
    "conflict",
    "after-change",
    "Persistence execution origin is stale",
    "The current execution origin does not match the active Host persistence authority",
  );
}

/** Reports a transaction that failed before completion. */
export function persistenceTransactionFailedProblem(): ProblemError {
  return persistenceProblem(
    "persistence.transaction.failed",
    "unavailable",
    "backoff",
    "Persistence transaction failed",
    "The persistence transaction did not complete successfully",
  );
}

/** Reports a commit whose durable outcome was not acknowledged. */
export function persistenceTransactionCommitUncertainProblem(): ProblemError {
  return persistenceProblem(
    "persistence.transaction.commit_uncertain",
    "integrity",
    "manual",
    "Persistence transaction commit is uncertain",
    "The operation callback completed but transaction completion was not acknowledged; authoritative reconciliation is required",
  );
}

/** Reports failure to prove persistence resources closed. */
export function persistenceServiceCloseFailedProblem(): ProblemError {
  return persistenceProblem(
    "persistence.service.close_failed",
    "unavailable",
    "manual",
    "Persistence service close failed",
    "The persistence service could not prove that its database resources were closed",
  );
}
