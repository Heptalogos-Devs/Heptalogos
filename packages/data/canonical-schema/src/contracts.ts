// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the schema initializer contract and runtime options without exposing
 * connection-pool or migration-provider ownership to callers.
 * @module contracts
 */

import type { ContinuityEpochId } from "@heptalogos/foundation-contracts";
import type { HostCanonicalMigrationAuthority } from "@heptalogos/host-ownership";

/** Supplies bounded connection and diagnostic policy for schema initialization. */
export interface CanonicalSchemaRuntimeOptions {
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly lockTimeoutMs: number;
  readonly idleInTransactionSessionTimeoutMs: number;
  readonly onBackgroundError: (error: unknown) => void;
}

interface CanonicalSchemaInitializationContext {
  readonly authority: HostCanonicalMigrationAuthority;
  readonly expectedContinuityEpochId: ContinuityEpochId;
}

/** Invokes canonical schema initialization under an authorized Host context. */
export interface CanonicalSchemaInitializer {
  (context: CanonicalSchemaInitializationContext): Promise<void>;
}
