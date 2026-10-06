// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Maps AIRuntime configuration, readiness, invocation, and provider failures
 * into redacted shared Problems.
 * @module problems
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

/** Creates one AIRuntime Problem without leaking provider response details. */
export function aiRuntimeProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "unavailable",
  retryClass: Problem["retryClass"] = "manual",
): ProblemError {
  return createProblemError({ problemCode, title, detail, category, retryClass });
}
