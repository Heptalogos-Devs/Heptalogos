// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Creates shared Problem envelopes for lineage failures so provider and
 * database details do not leak through the execution-context contract.
 * @module problems
 */

import {
  createProblemError,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

function lineageProblem(
  problemCode: string,
  title: string,
  detail: string,
): ProblemError {
  return createProblemError({
    problemCode,
    category: "integrity",
    retryClass: "never",
    title,
    detail,
  });
}

/** Reports a malformed or unsupported durable lineage reference. */
export function invalidContextRefProblem(detail: string): ProblemError {
  return lineageProblem(
    "lineage.context_ref.invalid",
    "Lineage context reference is invalid",
    detail,
  );
}

/** Reports lineage that crosses an unexpected instance or continuity epoch. */
export function discontinuousContextRefProblem(): ProblemError {
  return lineageProblem(
    "lineage.context_ref.discontinuity",
    "Lineage context reference is discontinuous",
    "The source InstanceId or ContinuityEpochId does not match the current Host timeline",
  );
}

/** Reports an operation that requires a current lineage reference. */
export function requiredContextRefProblem(): ProblemError {
  return lineageProblem(
    "lineage.context_ref.required",
    "Lineage context requires an active Activity",
    "A durable causal reference can only be created inside an active Activity",
  );
}

/** Reports an Activity context outside the bounded lineage contract. */
export function invalidActivityProblem(detail: string): ProblemError {
  return lineageProblem(
    "lineage.activity.invalid",
    "Activity request is invalid",
    detail,
  );
}

/** Reports an invalid or incomplete Activity origin. */
export function invalidOriginProblem(): ProblemError {
  return lineageProblem(
    "lineage.origin.invalid",
    "Host execution origin is invalid",
    "ExecutionContextRuntime requires valid typed Host origin identities",
  );
}

/** Reports a transaction Activity that differs from the current context. */
export function currentActivityMismatchProblem(): ProblemError {
  return lineageProblem(
    "lineage.persistence.current_activity_mismatch",
    "Current Activity does not match the mutation transaction",
    "Retained Activity identity must be the Activity admitted by the current mutation transaction",
  );
}

/** Reports an Activity origin that differs from the transaction origin. */
export function originMismatchProblem(): ProblemError {
  return lineageProblem(
    "lineage.persistence.origin_mismatch",
    "Activity origin does not match the mutation transaction",
    "Retained Activity Host origin must match the current persistence authority snapshot",
  );
}

/** Reports an attempt to retain an ephemeral Activity. */
export function retentionNotDurableProblem(): ProblemError {
  return lineageProblem(
    "lineage.persistence.retention_not_durable",
    "Activity retention is not durable",
    "Ephemeral Activities cannot be retained in canonical PostgreSQL",
  );
}

/** Reports a duplicate retained Activity that is not semantically identical. */
export function activityAlreadyRetainedProblem(): ProblemError {
  return lineageProblem(
    "lineage.persistence.activity_already_retained",
    "Activity is already retained",
    "retainCurrent is not an Activity upsert or completion mutation",
  );
}

/** Reports completion for an Activity that has not been retained. */
export function activityNotRetainedProblem(): ProblemError {
  return lineageProblem(
    "lineage.persistence.activity_not_retained",
    "Activity is not retained",
    "Only a currently retained Activity can be completed",
  );
}

/** Reports a terminal completion that conflicts with existing durable state. */
export function completionConflictProblem(): ProblemError {
  return lineageProblem(
    "lineage.persistence.completion_conflict",
    "Activity completion conflicts with retained history",
    "A retained Activity already has a different completion",
  );
}

/** Reports an invalid Activity completion payload or terminal outcome. */
export function invalidCompletionProblem(detail: string): ProblemError {
  return lineageProblem(
    "lineage.persistence.completion_invalid",
    "Activity completion is invalid",
    detail,
  );
}

/** Reports a Bootstrap reference whose lineage identity is discontinuous. */
export function bootstrapReferenceDiscontinuityProblem(): ProblemError {
  return lineageProblem(
    "lineage.bootstrap_reference.discontinuity",
    "Bootstrap Activity reference is discontinuous",
    "Bootstrap InstanceId and ContinuityEpochId must match the current mutation timeline",
  );
}

/** Reports a Bootstrap reference that conflicts with retained Activity state. */
export function bootstrapReferenceConflictProblem(): ProblemError {
  return lineageProblem(
    "lineage.bootstrap_reference.conflict",
    "Bootstrap Activity reference conflicts with retained history",
    "The same Bootstrap ActivityId was previously retained with different summary fields",
  );
}

/** Reports an invalid Bootstrap handoff projection. */
export function invalidBootstrapHandoffProblem(detail: string): ProblemError {
  return lineageProblem(
    "lineage.bootstrap_handoff.invalid",
    "Bootstrap handoff journal cannot be projected",
    detail,
  );
}
