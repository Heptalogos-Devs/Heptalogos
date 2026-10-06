// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Maps Configuration owner failures into the shared Problem contract.
 * @module problems
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

/** Creates one bounded Configuration Problem. */
export function configurationProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "validation",
  retryClass: Problem["retryClass"] = "manual",
): ProblemError {
  return createProblemError({ problemCode, title, detail, category, retryClass });
}
