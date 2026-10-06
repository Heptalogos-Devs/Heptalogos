// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createProblem,
  createProblemError,
  parseProblem,
  ProblemError,
} from "../../src/index.js";

describe("ProblemError", () => {
  it("preserves stable machine fields independently from Error.message", () => {
    const problem = {
      schemaVersion: 1,
      problemCode: "bootstrap.state.invalid",
      category: "integrity",
      retryClass: "manual",
      title: "Bootstrap state is invalid",
    } as const;

    const error = new ProblemError(problem);
    expect(error.problem).toEqual(problem);
    expect(error.name).toBe("ProblemError");
  });

  it("constructs the canonical envelope without mutating caller input", () => {
    const init = {
      problemCode: "foundation.example",
      category: "validation",
      retryClass: "never",
      title: "Example problem",
      detail: "detail",
    } as const;

    expect(createProblem(init)).toEqual({ schemaVersion: 1, ...init });
    expect(createProblemError(init)).toBeInstanceOf(ProblemError);
    expect(init).toEqual({
      problemCode: "foundation.example",
      category: "validation",
      retryClass: "never",
      title: "Example problem",
      detail: "detail",
    });
  });

  it("owns the supported schema version even when an untyped caller supplies one", () => {
    const init = {
      problemCode: "foundation.versioned",
      category: "validation",
      retryClass: "never",
      title: "Versioned problem",
      schemaVersion: 2,
    } as never;

    expect(createProblem(init)).toMatchObject({ schemaVersion: 1 });
    expect(createProblemError(init).problem.schemaVersion).toBe(1);
  });
});

describe("parseProblem", () => {
  it("accepts the current V1 shape as a detached frozen value", () => {
    const input = {
      schemaVersion: 1,
      problemCode: "foundation.invalid_input",
      category: "validation",
      retryClass: "after-change",
      title: "Input is invalid",
      detail: "The supplied value is not accepted",
      activityId: "activity-1",
      resourceRef: "resource-1",
      fieldErrors: [
        {
          field: "name",
          problemCode: "foundation.name_required",
          detail: "Name is required",
        },
      ],
      causeProblemRefs: ["foundation.cause"],
      metadata: { source: "test" },
    };

    const parsed = parseProblem(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed && Object.isFrozen(parsed)).toBe(true);
    expect(parsed?.fieldErrors && Object.isFrozen(parsed.fieldErrors)).toBe(true);
    expect(parsed?.fieldErrors?.[0] && Object.isFrozen(parsed.fieldErrors[0])).toBe(
      true,
    );
    expect(parsed?.metadata && Object.isFrozen(parsed.metadata)).toBe(true);

    input.metadata.source = "changed";
    expect(parsed?.metadata).toEqual({ source: "test" });
  });

  it("rejects unsupported versions, fields, shapes, and retry classes", () => {
    const base = {
      schemaVersion: 1,
      problemCode: "foundation.invalid_input",
      category: "validation",
      retryClass: "never",
      title: "Input is invalid",
    } as const;

    expect(parseProblem({ ...base, schemaVersion: 2 })).toBeUndefined();
    expect(parseProblem({ ...base, unknown: true })).toBeUndefined();
    expect(parseProblem({ ...base, retryClass: "later" })).toBeUndefined();
    expect(parseProblem({ ...base, fieldErrors: "invalid" })).toBeUndefined();
    expect(
      parseProblem({
        ...base,
        fieldErrors: [
          { field: "name", problemCode: "foundation.name_required", unexpected: true },
        ],
      }),
    ).toBeUndefined();
    expect(parseProblem({ ...base, metadata: [] })).toBeUndefined();
    expect(parseProblem({ ...base, title: 42 })).toBeUndefined();
  });
});
