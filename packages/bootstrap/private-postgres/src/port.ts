// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates configured PostgreSQL port values against the platform and
 * PostgreSQL range contract before process startup is attempted.
 * @module port
 */

import { createProblemError } from "@heptalogos/foundation-contracts";

/** Validates a private PostgreSQL port against the configured range. */
export function assertPrivatePostgresPort(port: number): void {
  if (Number.isInteger(port) && port >= 1 && port <= 65535) return;
  throw createProblemError({
    problemCode: "private-postgres.cluster.invalid_port",
    category: "validation",
    retryClass: "manual",
    title: "Private PostgreSQL port is invalid",
    detail: "The private PostgreSQL port must be an integer from 1 through 65535",
  });
}
