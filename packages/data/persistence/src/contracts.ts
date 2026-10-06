// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines Host-fenced persistence service, transaction, and execution-context
 * contracts without exposing pool or Kysely implementation details.
 * @module contracts
 */

import type {
  ActivityId,
  BootId,
  ContinuityEpochId,
  HostOwnershipToken,
  InstallationId,
  InstanceId,
} from "@heptalogos/foundation-contracts";
/** Carries the Activity and ownership identity into a persistence transaction. */
export interface PersistenceExecutionMetadata {
  readonly activityId: ActivityId;
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly continuityEpochId: ContinuityEpochId;
  readonly hostOwnershipToken: HostOwnershipToken;
}

/** Resolves current execution metadata for mutation admission. */
export interface PersistenceExecutionContextProvider {
  /** Returns the current metadata or no context outside an Activity. */
  current(): PersistenceExecutionMetadata | undefined;
}

/** Read-only transaction context; execution identity is optional for reads. */
export interface PersistenceReadTransactionContext {
  readonly mode: "READ";
  readonly execution?: PersistenceExecutionMetadata;
}

/** Mutation transaction context; execution identity is mandatory. */
export interface PersistenceMutationTransactionContext {
  readonly mode: "MUTATION";
  readonly execution: PersistenceExecutionMetadata;
}

/** Union of read and Host-fenced mutation transaction contexts. */
export type PersistenceTransactionContext =
  PersistenceReadTransactionContext | PersistenceMutationTransactionContext;
/** Names the transaction mode admitted by persistence. */
export type PersistenceTransactionMode = PersistenceTransactionContext["mode"];

/** Bounds pool and transaction behavior and receives background errors. */
export interface PersistenceRuntimeOptions {
  readonly maxConnections: number;
  readonly idleTimeoutMs: number;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly lockTimeoutMs: number;
  readonly idleInTransactionSessionTimeoutMs: number;
  readonly onBackgroundError: (error: unknown) => void;
}

/** States whether the persistence service can admit work. */
export type PersistenceServiceState = "OPEN" | "FENCED" | "CLOSING" | "CLOSED";

/** Host-fenced persistence service used by Foundation semantic owners. */
export interface PersistenceService {
  readonly state: PersistenceServiceState;
  /** Runs a read transaction without requiring mutation identity. */
  read<T>(
    operation: (context: PersistenceReadTransactionContext) => Promise<T>,
  ): Promise<T>;
  /** Runs a canonical mutation transaction with current execution identity. */
  mutate<T>(
    operation: (context: PersistenceMutationTransactionContext) => Promise<T>,
  ): Promise<T>;
  /** Drains in-flight work and closes database resources. */
  close(): Promise<void>;
}
