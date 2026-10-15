// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { createProblemError } from "@heptalogos/foundation-contracts";
import { invalidInputProblem, toManagementProblemDetails } from "../../src/problems.js";

describe("Management failure HTTP classification", () => {
  it("reports unexpected failures as redacted server errors", () => {
    const result = toManagementProblemDetails(new Error("private database detail"));
    expect(result.status).toBe(500);
    expect(result.problemCode).toBe("management.internal");
    expect(JSON.stringify(result)).not.toContain("private database detail");
  });

  it.each([
    ["persistence.service.fenced", 503],
    ["persistence.service.closed", 503],
    ["persistence.service.close_failed", 503],
    ["persistence.execution_context.stale_origin", 503],
    ["persistence.transaction.failed", 503],
    ["persistence.transaction.commit_uncertain", 500],
    ["persistence.transaction.context_invalid", 500],
    ["persistence.execution_context.required", 500],
  ])(
    "classifies %s as HTTP %s without changing recovery semantics",
    (problemCode, status) => {
      const result = toManagementProblemDetails(
        createProblemError({
          problemCode,
          title: "Persistence failure",
          category: "integrity",
          retryClass: "manual",
        }),
      );
      expect(result).toMatchObject({
        status,
        problemCode,
        retryClass: "manual",
        category: "integrity",
      });
    },
  );

  it("keeps invalid client input as HTTP 400", () => {
    expect(toManagementProblemDetails(invalidInputProblem()).status).toBe(400);
  });
});
