// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines stable Management Problem construction and HTTP projection
 * semantics without exposing provider or database exception details.
 * @module problems
 */

import {
  createProblemError,
  ProblemError,
  type Problem,
} from "@heptalogos/foundation-contracts";
import type { ManagementProblemDetails } from "./contracts.js";

/** Creates a stable Management ProblemError with bounded public detail. */
export function managementProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "management",
  retryClass: Problem["retryClass"] = "manual",
): ProblemError {
  return createProblemError({
    problemCode,
    title,
    detail,
    category,
    retryClass,
  });
}

/** Raises the invalid request Problem used by all Management input boundaries. */
export function invalidInputProblem(
  detail = "The Management request is invalid",
): ProblemError {
  return managementProblem(
    "management.invalid_input",
    "Management request is invalid",
    detail,
    "validation",
  );
}

/** Raises a contract negotiation failure without relying on HTTP 404. */
export function contractUnsupportedProblem(): ProblemError {
  return managementProblem(
    "management.contract_unsupported",
    "Management contract is unsupported",
    "The client and Product Host do not share the required Management contract version",
    "conflict",
  );
}

/** Maps a Management problem to its stable HTTP status. */
export function managementHttpStatus(problemCode: string): number {
  if (problemCode === "management.rate_limited") return 429;
  if (problemCode === "management.invalid_credentials") return 401;
  if (
    problemCode === "management.session_invalid" ||
    problemCode === "management.session_expired" ||
    problemCode === "management.session_revoked"
  ) {
    return 401;
  }
  if (problemCode === "management.contract_unsupported") return 426;
  if (
    problemCode === "management.host_fence_lost" ||
    problemCode === "management.not_ready"
  ) {
    return 503;
  }
  if (
    problemCode === "management.first_claim_expired" ||
    problemCode === "management.first_claim_consumed" ||
    problemCode === "management.administrator_exists"
  ) {
    return 409;
  }
  if (problemCode === "management.first_claim_unavailable") return 503;
  if (problemCode === "management.first_claim_invalid") return 400;
  if (
    problemCode === "messaging.idempotency_conflict" ||
    problemCode === "subject.authority_stale" ||
    problemCode === "subject.not_running" ||
    problemCode === "subject.not_found"
  ) {
    return 409;
  }
  if (
    problemCode === "messaging.conversation_not_ready" ||
    problemCode === "subject.dependencies_unavailable" ||
    problemCode === "subject.primary_unavailable" ||
    problemCode === "subject.expression_unavailable"
  ) {
    return 503;
  }
  return 400;
}

function safeProblem(error: unknown): ProblemError {
  if (error instanceof ProblemError) return error;
  return managementProblem(
    "management.internal",
    "Management operation failed",
    "The Management operation could not be completed",
    "unavailable",
  );
}

/** Converts an arbitrary route failure to a redacted RFC 9457-style response. */
export function toManagementProblemDetails(
  error: unknown,
  instance?: string,
): ManagementProblemDetails {
  const problem = safeProblem(error).problem;
  return {
    type: "https://heptalogos.dev/problems/" + problem.problemCode,
    title: problem.title,
    status: managementHttpStatus(problem.problemCode),
    detail: problem.detail ?? problem.title,
    ...(instance === undefined ? {} : { instance }),
    problemCode: problem.problemCode,
    category: problem.category,
    retryClass: problem.retryClass,
    schemaVersion: 1,
  };
}
