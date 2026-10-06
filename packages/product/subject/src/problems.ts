// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Stable Problems for the current Subject semantic owner.
 * @module problems
 */

import { createProblemError, type Problem } from "@heptalogos/foundation-contracts";

/** Creates a canonical Subject Problem envelope. */
export function subjectProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "conflict",
  retryClass: Problem["retryClass"] = "manual",
) {
  return createProblemError({
    problemCode,
    title,
    detail,
    category,
    retryClass,
  });
}
