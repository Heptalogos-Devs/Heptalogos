// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the canonical Problem envelope and construction seam used to report
 * typed failures without leaking provider-specific exception shapes.
 * @module problem
 */

import { snapshotCanonicalJson, type CanonicalJsonValue } from "./canonical-json.js";

/** Classifies how a Problem may be retried after the reported failure. */
export type RetryClass = "never" | "immediate" | "backoff" | "after-change" | "manual";

/** Describes a validation failure attached to one named field. */
export interface FieldError {
  readonly field: string;
  readonly problemCode: string;
  readonly detail?: string;
}

/** Carries the canonical, serializable failure semantics across package seams. */
export interface Problem {
  readonly schemaVersion: 1;
  readonly problemCode: string;
  readonly category: string;
  readonly retryClass: RetryClass;
  readonly title: string;
  readonly detail?: string;
  readonly activityId?: string;
  readonly resourceRef?: string;
  readonly fieldErrors?: readonly FieldError[];
  readonly causeProblemRefs?: readonly string[];
  readonly metadata?: Readonly<Record<string, CanonicalJsonValue>>;
}

/** Input shape for creating a Problem; the schema version is fixed by its owner. */
export type ProblemInit = Omit<Problem, "schemaVersion">;

const retryClasses = new Set<RetryClass>([
  "never",
  "immediate",
  "backoff",
  "after-change",
  "manual",
]);
const fieldErrorKeys = new Set(["field", "problemCode", "detail"]);

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * Parses unknown input into a detached, canonical current Problem V1 value.
 * Unsupported versions, fields, shapes, and non-canonical metadata are rejected.
 */
export function parseProblem(value: unknown): Problem | undefined {
  const record = recordValue(value);
  if (record === undefined) return undefined;
  const allowed = new Set([
    "schemaVersion",
    "problemCode",
    "category",
    "retryClass",
    "title",
    "detail",
    "activityId",
    "resourceRef",
    "fieldErrors",
    "causeProblemRefs",
    "metadata",
  ]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return undefined;
  if (
    record.schemaVersion !== 1 ||
    typeof record.problemCode !== "string" ||
    record.problemCode.length === 0 ||
    typeof record.category !== "string" ||
    typeof record.retryClass !== "string" ||
    !retryClasses.has(record.retryClass as RetryClass) ||
    typeof record.title !== "string" ||
    record.title.length === 0
  ) {
    return undefined;
  }
  for (const field of ["detail", "activityId", "resourceRef"]) {
    if (record[field] !== undefined && typeof record[field] !== "string") {
      return undefined;
    }
  }
  if (record.fieldErrors !== undefined) {
    if (!Array.isArray(record.fieldErrors)) return undefined;
    for (const item of record.fieldErrors) {
      const fieldError = recordValue(item);
      if (
        fieldError === undefined ||
        Object.keys(fieldError).some((key) => !fieldErrorKeys.has(key)) ||
        typeof fieldError.field !== "string" ||
        typeof fieldError.problemCode !== "string" ||
        (fieldError.detail !== undefined && typeof fieldError.detail !== "string")
      ) {
        return undefined;
      }
    }
  }
  if (record.causeProblemRefs !== undefined) {
    if (
      !Array.isArray(record.causeProblemRefs) ||
      record.causeProblemRefs.some((item) => typeof item !== "string")
    ) {
      return undefined;
    }
  }
  if (
    record.metadata !== undefined &&
    (typeof record.metadata !== "object" ||
      record.metadata === null ||
      Array.isArray(record.metadata))
  ) {
    return undefined;
  }
  try {
    return snapshotCanonicalJson(value as CanonicalJsonValue)
      .value as unknown as Problem;
  } catch {
    return undefined;
  }
}

/** Creates a schema-versioned Problem envelope from caller-supplied semantics. */
export function createProblem(init: ProblemInit): Problem {
  return { ...init, schemaVersion: 1 };
}

/** Creates an Error carrying the same canonical Problem envelope. */
export function createProblemError(
  init: ProblemInit,
  options?: ErrorOptions,
): ProblemError {
  return new ProblemError(createProblem(init), options);
}

/** Raises a canonical Problem while preserving normal Error behavior. */
export class ProblemError extends Error {
  readonly problem: Problem;

  /** Creates an error whose message follows the Problem detail/title policy. */
  constructor(problem: Problem, options?: ErrorOptions) {
    super(problem.detail ?? problem.title, options);
    this.name = "ProblemError";
    this.problem = problem;
  }
}
