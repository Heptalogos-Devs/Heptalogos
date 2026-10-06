// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Maps NetworkAccess admission and transport failures into redacted Problems.
 * @module problems
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

// Intentional duplication: each semantic owner fixes its own problem-code and
// default retry taxonomy; sharing the constructor would blur owner boundaries.
/* jscpd:ignore-start */
/** Creates one NetworkAccess Problem without provider or credential details. */
export function networkProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "unavailable",
  retryClass: Problem["retryClass"] = "manual",
): ProblemError {
  return createProblemError({ problemCode, title, detail, category, retryClass });
}
/* jscpd:ignore-end */
