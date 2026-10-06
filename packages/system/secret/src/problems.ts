// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Maps Secret owner failures into the shared Problem contract without exposing
 * backend details or material.
 * @module problems
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

// Intentional duplication: Secret keeps its own problem-code and default
// retry taxonomy rather than sharing a constructor with Configuration.
/* jscpd:ignore-start */
/** Creates one redacted Secret Problem. */
export function secretProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "validation",
  retryClass: Problem["retryClass"] = "manual",
): ProblemError {
  return createProblemError({ problemCode, title, detail, category, retryClass });
}
/* jscpd:ignore-end */
