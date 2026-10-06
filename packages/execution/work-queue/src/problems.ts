// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Maps WorkQueue admission, dispatch, and repository failures into shared
 * Foundation Problems with explicit retry classification.
 * @module problems
 */

import {
  createProblemError,
  type ProblemError,
  type ProblemInit,
} from "@heptalogos/foundation-contracts";

interface WorkQueueProblemSpec {
  readonly category: string;
  readonly retryClass: "never" | "immediate" | "backoff" | "after-change" | "manual";
  readonly title: string;
}

const problemSpecs: Readonly<Record<string, WorkQueueProblemSpec>> = {
  "work_queue.invalid_attempt_identity": {
    category: "validation",
    retryClass: "never",
    title: "WorkQueue dispatch-attempt identity is invalid",
  },
  "work_queue.invalid_options": {
    category: "validation",
    retryClass: "never",
    title: "WorkQueue runtime options are invalid",
  },
  "work_queue.insert_conflict": {
    category: "conflict",
    retryClass: "after-change",
    title: "WorkItem insertion conflict cannot be reconciled",
  },
  "work_queue.invalid_transition": {
    category: "conflict",
    retryClass: "manual",
    title: "WorkItem state transition is invalid",
  },
  "work_queue.invalid_work_item": {
    category: "integrity",
    retryClass: "manual",
    title: "Persisted WorkItem is invalid",
  },
  "work.admission.invalid_decision": {
    category: "validation",
    retryClass: "never",
    title: "WorkAdmission returned an invalid decision",
  },
  "work.admission.rejected_new_work": {
    category: "conflict",
    retryClass: "after-change",
    title: "WorkAdmission rejected new work",
  },
  "work.admission.rejected_optional": {
    category: "conflict",
    retryClass: "after-change",
    title: "WorkAdmission rejected optional work",
  },
  "work.configuration.binding_unavailable": {
    category: "unavailable",
    retryClass: "after-change",
    title: "WorkItem configuration binding is unavailable",
  },
  "work.context.required": {
    category: "conflict",
    retryClass: "after-change",
    title: "WorkItem creation requires an execution context",
  },
  "work.handler.unavailable": {
    category: "unavailable",
    retryClass: "after-change",
    title: "Exact WorkHandler is unavailable",
  },
  "work.admission.required": {
    category: "validation",
    retryClass: "never",
    title: "WorkQueue composition requires WorkAdmissionPort",
  },
  "work.payload.invalid": {
    category: "validation",
    retryClass: "never",
    title: "WorkItem payload is invalid",
  },
  "work.payload.too_large": {
    category: "validation",
    retryClass: "never",
    title: "WorkItem payload exceeds the configured limit",
  },
  "work.request.invalid": {
    category: "validation",
    retryClass: "never",
    title: "WorkItem creation request is invalid",
  },
  "work.resource-admission.mismatch": {
    category: "validation",
    retryClass: "never",
    title: "WorkItem resource admission class does not match its WorkHandler",
  },
  "work.signal.failed": {
    category: "unavailable",
    retryClass: "after-change",
    title: "WorkItem Signal publication failed after canonical insertion",
  },
  "work.reconciliation.failed": {
    category: "unavailable",
    retryClass: "after-change",
    title: "WorkQueue reconciliation scan failed",
  },
  "work.dispatch.failed": {
    category: "unavailable",
    retryClass: "after-change",
    title: "Durable dispatch projection failed",
  },
  "work.classifier.required": {
    category: "validation",
    retryClass: "never",
    title: "WorkAttemptExecutor requires WorkErrorClassifier",
  },
  "work.external_effect_uncertain_unsupported": {
    category: "validation",
    retryClass: "never",
    title: "External-effect-uncertain work is unsupported",
  },
  "work.failure.unclassified": {
    category: "integrity",
    retryClass: "manual",
    title: "WorkHandler failure was not classified",
  },
  "work.outcome.invalid": {
    category: "validation",
    retryClass: "never",
    title: "WorkHandler outcome is invalid",
  },
  "work.outcome.too_large": {
    category: "validation",
    retryClass: "never",
    title: "WorkHandler outcome exceeds the configured limit",
  },
  "work.retry.not_before_required": {
    category: "validation",
    retryClass: "never",
    title: "Work retry requires an exact notBefore Instant",
  },
  "work.queue.profile_mismatch": {
    category: "validation",
    retryClass: "never",
    title: "WorkItem queue profile does not match its WorkHandler",
  },
  "work.queue.profile_catalog_required": {
    category: "validation",
    retryClass: "never",
    title: "WorkQueue profile catalog is required",
  },
  "work.queue.profile_invalid": {
    category: "validation",
    retryClass: "never",
    title: "WorkQueue profile is invalid",
  },
  "work.queue.profile_unavailable": {
    category: "unavailable",
    retryClass: "after-change",
    title: "WorkQueue profile is unavailable",
  },
  "work.queue.partition_required": {
    category: "validation",
    retryClass: "never",
    title: "Partition key is required by the WorkQueue profile",
  },
  "work.queue.partition_not_supported": {
    category: "validation",
    retryClass: "never",
    title: "WorkQueue profile does not support partition keys",
  },
  "work.recovery.active_attempt_mismatch": {
    category: "integrity",
    retryClass: "manual",
    title: "Running WorkItem active attempt identity is inconsistent",
  },
  "work.recovery.handler_generation_missing": {
    category: "unavailable",
    retryClass: "after-change",
    title: "Running WorkItem handler generation is unavailable",
  },
};

function problemSpec(problemCode: string): WorkQueueProblemSpec {
  return (
    problemSpecs[problemCode] ?? {
      category: "validation",
      retryClass: "never",
      title: "WorkQueue request is invalid",
    }
  );
}

/** Create a stable WorkQueue problem envelope with an optional underlying cause. */
export function workQueueProblem(
  problemCode: string,
  detail: string,
  cause?: unknown,
): ProblemError {
  const spec = problemSpec(problemCode);
  const problem: ProblemInit = {
    problemCode,
    category: spec.category,
    retryClass: spec.retryClass,
    title: spec.title,
    detail,
  };
  return createProblemError(problem, cause === undefined ? undefined : { cause });
}
