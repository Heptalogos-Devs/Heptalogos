// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines Host lease, fence, token, and database-context contracts that callers
 * must carry through every canonical mutation path.
 * @module contracts
 */

import type {
  BootId,
  ContinuityEpochId,
  HostOwnershipToken,
  InstallationId,
  InstanceId,
} from "@heptalogos/foundation-contracts";

/** Canonical database name used by Host ownership and normal runtime. */
export const HOST_OWNERSHIP_CANONICAL_DATABASE = "heptalogos" as const;
/** Role that owns the Host ownership schema and fence. */
export const HOST_OWNERSHIP_OWNER_ROLE = "heptalogos_owner" as const;
/** Role used by the dedicated Host lease connection. */
export const HOST_LEASE_ROLE = "heptalogos_host_lease" as const;
/** Role used by normal runtime persistence connections. */
export const HOST_RUNTIME_ROLE = "heptalogos_runtime" as const;
/** Role used only for canonical schema migration sessions. */
export const HOST_MIGRATION_ROLE = "heptalogos_migration" as const;
/** Role used only by the DBOS durable-execution engine projection. */
export const HOST_DURABLE_EXECUTION_ROLE = "heptalogos_durable_execution" as const;
/** Schema containing Host ownership and Foundation tables. */
export const HOST_OWNERSHIP_SCHEMA = "heptalogos" as const;
/** Table holding the current database-visible Host fence. */
export const HOST_OWNERSHIP_FENCE_TABLE = "host_ownership_fence" as const;
/** Function that acquires the Host ownership fence inside PostgreSQL. */
export const HOST_OWNERSHIP_FENCE_LOCK_FUNCTION = "lock_host_ownership_fence" as const;
/** SCRAM work factor required for Host lease credentials. */
export const HOST_LEASE_SCRAM_ITERATIONS = 4096 as const;
/** Salt size required for Host lease SCRAM credentials. */
export const HOST_LEASE_SCRAM_SALT_BYTES = 16 as const;

/** Supplies SCRAM parameters for deterministic verifier construction. */
export interface PostgresScramVerifierOptions {
  readonly iterations: number;
  readonly salt: Uint8Array;
}

/** States whether Host may admit fenced database work. */
export type HostOwnershipState = "ACTIVE" | "FENCED" | "CLOSING" | "CLOSED";

/** Represents the Host ownership capability and its fence signal. */
export interface HostOwnershipContext {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly token: HostOwnershipToken;
  readonly state: HostOwnershipState;
  readonly signal: AbortSignal;
  /** Throws when the Host fence is no longer active. */
  assertActive(): void;
  /** Closes the Host lease and publishes the terminal fence state. */
  close(): Promise<void>;
}

/** Identifies the loopback PostgreSQL endpoint used for Host lease setup. */
export interface HostOwnershipConnectionTarget {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly database: typeof HOST_OWNERSHIP_CANONICAL_DATABASE;
}

/** Identifies the normal runtime database endpoint and role. */
export interface HostRuntimeDatabaseTarget {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly database: typeof HOST_OWNERSHIP_CANONICAL_DATABASE;
  readonly user: typeof HOST_RUNTIME_ROLE;
}

/** Identifies the canonical migration endpoint and restricted role. */
export interface HostMigrationDatabaseTarget {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly database: typeof HOST_OWNERSHIP_CANONICAL_DATABASE;
  readonly user: typeof HOST_MIGRATION_ROLE;
}

/** Identifies the dedicated DBOS system-database endpoint and role. */
export interface HostDurableExecutionDatabaseTarget {
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly database: typeof HOST_OWNERSHIP_CANONICAL_DATABASE;
  readonly user: typeof HOST_DURABLE_EXECUTION_ROLE;
}

/** Authorizes canonical schema migration under the current Host fence. */
export interface HostCanonicalMigrationAuthority {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly token: HostOwnershipToken;
  readonly continuityEpochId: ContinuityEpochId;
  readonly target: HostMigrationDatabaseTarget;
  readonly signal: AbortSignal;
  /** Throws when the migration authority is no longer current. */
  assertCurrent(): void;
  /** Uses the migration credential only within the supplied callback. */
  withMigrationDatabasePassword<T>(
    use: (passwordUtf8: Uint8Array) => Promise<T>,
  ): Promise<T>;
}

/** Authorizes normal persistence under the current Host fence. */
export interface HostPersistenceAuthority {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly continuityEpochId: ContinuityEpochId;
  readonly token: HostOwnershipToken;
  readonly target: HostRuntimeDatabaseTarget;
  readonly signal: AbortSignal;
  /** Throws when the persistence authority is no longer active. */
  assertActive(): void;
  /** Uses the runtime credential only within the supplied callback. */
  withRuntimeDatabasePassword<T>(
    use: (passwordUtf8: Uint8Array) => Promise<T>,
  ): Promise<T>;
}

/** Authorizes DBOS engine-private durable execution for the active Host. */
export interface HostDurableExecutionAuthority {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly continuityEpochId: ContinuityEpochId;
  readonly token: HostOwnershipToken;
  readonly target: HostDurableExecutionDatabaseTarget;
  readonly signal: AbortSignal;
  /** Throws when the durable-engine authority is no longer active. */
  assertActive(): void;
  /** Uses the durable-engine credential only within the supplied callback. */
  withDurableExecutionDatabasePassword<T>(
    use: (passwordUtf8: Uint8Array) => Promise<T>,
  ): Promise<T>;
}

/** Bounds Host connection, fence, and keepalive operations. */
export interface HostOwnershipTimingOptions {
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly fenceLockTimeoutMs: number;
  readonly keepAliveInitialDelayMs: number;
}
