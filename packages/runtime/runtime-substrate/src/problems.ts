// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Normalizes substrate admission, disposal, and task failures into Foundation
 * Problems without exposing Cordis lifecycle errors.
 * @module problems
 */

import {
  createProblemError,
  type ProblemError,
  type ProblemInit,
  type RetryClass,
} from "@heptalogos/foundation-contracts";

interface SubstrateProblemSpec {
  readonly category: string;
  readonly retryClass: RetryClass;
  readonly title: string;
}

const substrateProblemSpecs: Readonly<Record<string, SubstrateProblemSpec>> = {
  "runtime.substrate.activation_cancelled": {
    category: "conflict",
    retryClass: "after-change",
    title: "Runtime activation was cancelled",
  },
  "runtime.substrate.activation_failed": {
    category: "unavailable",
    retryClass: "after-change",
    title: "Runtime activation failed",
  },
  "runtime.substrate.closed": {
    category: "conflict",
    retryClass: "manual",
    title: "Runtime substrate is closed",
  },
  "runtime.substrate.disposal_failed": {
    category: "unavailable",
    retryClass: "manual",
    title: "Runtime resource disposal failed",
  },
  "runtime.substrate.invalid_options": {
    category: "validation",
    retryClass: "never",
    title: "Runtime substrate options are invalid",
  },
  "runtime.substrate.scope_closed": {
    category: "conflict",
    retryClass: "after-change",
    title: "Runtime activation scope is closed",
  },
  "runtime.substrate.settlement_timeout": {
    category: "unavailable",
    retryClass: "manual",
    title: "Runtime resource settlement timed out",
  },
};

function fallbackSpec(problemCode: string): SubstrateProblemSpec {
  return {
    category: problemCode.includes("invalid") ? "validation" : "unavailable",
    retryClass: problemCode.includes("invalid") ? "never" : "manual",
    title: "Runtime substrate operation failed",
  };
}

function substrateProblem(problemCode: string, detail: string): ProblemInit {
  const spec = substrateProblemSpecs[problemCode] ?? fallbackSpec(problemCode);
  return {
    problemCode,
    category: spec.category,
    retryClass: spec.retryClass,
    title: spec.title,
    detail,
  };
}

/** Creates a typed Problem for substrate lifecycle or task failure. */
export function runtimeSubstrateProblem(
  problemCode: string,
  detail: string,
  cause?: unknown,
): ProblemError {
  return createProblemError(
    substrateProblem(problemCode, detail),
    cause === undefined ? undefined : { cause },
  );
}
