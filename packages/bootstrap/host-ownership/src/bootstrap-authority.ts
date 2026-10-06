// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the framework-free capability that proves Bootstrap authorization
 * before privileged PostgreSQL provisioning operations are admitted. It guards
 * PostgreSQL mutations through a narrow seam so Host ownership never depends
 * on the lock implementation.
 * @module bootstrap-authority
 */
export interface BootstrapMutationAuthority {
  /** Reject the mutation unless the current bootstrap authority is still valid. */
  assertCurrent(): void;
}
