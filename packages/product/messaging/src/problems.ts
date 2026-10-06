// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Stable Problems owned by the current Messaging protocol boundary.
 * @module problems
 */

import { createProblemError, type Problem } from "@heptalogos/foundation-contracts";

/** Creates a canonical Messaging Problem envelope. */
export function messagingProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "validation",
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
