// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Shares the Product Host bearer-session and contract-header mechanics.
 * @module http-auth
 */

import type { FastifyRequest } from "fastify";
import {
  MANAGEMENT_CONTRACT_VERSION,
  contractUnsupportedProblem,
  managementProblem,
} from "@heptalogos/management";

/** Reads the opaque Management bearer session from a request. */
export function tokenFromRequest(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ") ||
    authorization.length <= "Bearer ".length
  ) {
    throw managementProblem(
      "management.session_invalid",
      "Management session is invalid",
      "A Bearer session token is required",
      "conflict",
    );
  }
  return authorization.slice("Bearer ".length);
}

/** Rejects requests that name a non-current Management contract version. */
export function assertContractHeader(request: FastifyRequest): void {
  const version = request.headers["x-heptalogos-contract-version"];
  if (
    version !== undefined &&
    (Array.isArray(version) || version !== MANAGEMENT_CONTRACT_VERSION)
  ) {
    throw contractUnsupportedProblem();
  }
}
