// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Derives the stable advisory-lock key from installation identity so competing
 * Hosts coordinate through PostgreSQL rather than process-local coordination.
 * @module advisory-key
 */

import { createHash } from "node:crypto";
import type { InstanceId } from "@heptalogos/foundation-contracts";

const HOST_LEASE_KEY_DOMAIN = "heptalogos.host-lease/v1\0";

/** Carries the two signed 32-bit halves used by PostgreSQL advisory locking. */
export interface HostAdvisoryKey {
  readonly key1: number;
  readonly key2: number;
}

/** Derives a stable advisory key from the installation instance identity. */
export function deriveHostAdvisoryKey(instanceId: InstanceId): HostAdvisoryKey {
  const digest = createHash("sha256")
    .update(`${HOST_LEASE_KEY_DOMAIN}${instanceId}`, "utf8")
    .digest();

  return {
    key1: digest.readInt32BE(0),
    key2: digest.readInt32BE(4),
  };
}
