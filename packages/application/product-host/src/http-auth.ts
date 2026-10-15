// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Reads the Management bearer session.
 * @module http-auth
 */

import type { FastifyRequest } from "fastify";
import { managementProblem } from "@heptalogos/management";

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
