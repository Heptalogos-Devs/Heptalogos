// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Constructs canonical-schema Problem envelopes for initialization failures so
 * callers receive shared failure semantics instead of driver exceptions.
 * @module problems
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

/** Enumerates canonical-schema Problem codes exposed by this package. */
export type CanonicalSchemaProblemCode =
  | "canonical-schema.authority_lost"
  | "canonical-schema.schema_precondition_failed"
  | "canonical-schema.migration_failed"
  | "canonical-schema.continuity_instance_mismatch"
  | "canonical-schema.continuity_epoch_mismatch"
  | "canonical-schema.close_failed";

const titles: Readonly<Record<CanonicalSchemaProblemCode, string>> = {
  "canonical-schema.authority_lost": "Canonical schema authority was lost",
  "canonical-schema.schema_precondition_failed": "Canonical schema precondition failed",
  "canonical-schema.migration_failed": "Canonical schema migration failed",
  "canonical-schema.continuity_instance_mismatch":
    "Canonical continuity belongs to another Instance",
  "canonical-schema.continuity_epoch_mismatch":
    "Canonical continuity belongs to another epoch",
  "canonical-schema.close_failed": "Canonical schema resources failed to close",
};

/** Creates a typed ProblemError for a canonical-schema failure. */
export function canonicalSchemaProblem(
  problemCode: CanonicalSchemaProblemCode,
  detail: string,
  category: Problem["category"] = "integrity",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "manual",
    title: titles[problemCode],
    detail,
  });
}
