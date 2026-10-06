// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared HostOwnershipFence query shape and SQL for the two mutation paths.
 * Publication and revocation retain their own failure semantics around this
 * owner-scoped database primitive.
 * @module fence-queries
 */

import { HOST_OWNERSHIP_FENCE_TABLE, HOST_OWNERSHIP_SCHEMA } from "./contracts.js";

/** Row shape returned by the canonical HostOwnershipFence table. */
export interface HostOwnershipFenceRow {
  readonly singleton: boolean;
  readonly instance_id: string;
  readonly ownership_revision: string | number;
  readonly host_ownership_token: string | null;
  readonly boot_id: string | null;
}

/** Selects the singleton fence row while holding its transaction lock. */
export const FENCE_FOR_UPDATE = `
SELECT singleton, instance_id, ownership_revision, host_ownership_token, boot_id
FROM "${HOST_OWNERSHIP_SCHEMA}"."${HOST_OWNERSHIP_FENCE_TABLE}"
WHERE singleton = true
FOR UPDATE
`;

/** Re-reads the singleton fence row after a mutation commits. */
export const FENCE_AFTER_COMMIT = `
SELECT singleton, instance_id, ownership_revision, host_ownership_token, boot_id
FROM "${HOST_OWNERSHIP_SCHEMA}"."${HOST_OWNERSHIP_FENCE_TABLE}"
WHERE singleton = true
`;
