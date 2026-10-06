// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the managed Host lifecycle and maintenance contracts shared across
 * handoff, terminal retirement, and recovery without exposing controller
 * mechanics.
 * @module managed-host
 */

import {
  createProblemError,
  type ProblemError,
  type BootId,
  type ContinuityEpochId,
  type HostOwnershipToken,
  type InstallationId,
  type InstanceId,
} from "@heptalogos/foundation-contracts";
import type {
  MaintenanceOperationId,
  MaintenancePhase,
} from "@heptalogos/bootstrap-state";
import type {
  HostPersistenceAuthority,
  HostDurableExecutionAuthority,
  HostOwnershipContext,
  HostDurableExecutionDatabaseTarget,
  HostRuntimeDatabaseTarget,
  HostOwnershipState,
} from "@heptalogos/host-ownership";

/** Selects the private PostgreSQL maintenance operation requested by Host. */
export type PrivatePostgresMaintenanceRequest =
  | { readonly kind: "RESTART_PRIVATE_POSTGRES" }
  | { readonly kind: "STOP_PRIVATE_POSTGRES" };

/** Represents the current phase exposed by a prepared maintenance operation. */
export type PreparedMaintenanceState = MaintenancePhase;

/** Owns terminal retirement of the product runtime before Host authority loss. */
export interface HostRuntimeRetirement {
  /** Closes product work admission and never resumes the old runtime. */
  retire(): Promise<void>;
}

interface PrivatePostgresMaintenanceResultRestarted {
  readonly kind: "RESTARTED";
  readonly host: BootstrapManagedHostContext;
}

interface PrivatePostgresMaintenanceResultStopped {
  readonly kind: "STOPPED";
}

interface PrivatePostgresMaintenanceResultAborted {
  readonly kind: "ABORTED";
}

/** Reports the terminal result of private PostgreSQL maintenance. */
export type PrivatePostgresMaintenanceResult =
  | PrivatePostgresMaintenanceResultRestarted
  | PrivatePostgresMaintenanceResultStopped
  | PrivatePostgresMaintenanceResultAborted;

/** Represents a prepared maintenance window bound to one operation journal. */
export interface PreparedPrivatePostgresMaintenance {
  readonly operationId: MaintenanceOperationId;
  readonly state: PreparedMaintenanceState;
  readonly signal: AbortSignal;
  /** Executes the one-way window after product runtime retirement. */
  execute(retirement: HostRuntimeRetirement): Promise<PrivatePostgresMaintenanceResult>;
  /** Cancels preparation before durable execution entry. */
  abortBeforeExecute(): Promise<void>;
}

/** Managed Host context that fences all persistence and maintenance operations. */
export interface BootstrapManagedHostContext {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly continuityEpochId: ContinuityEpochId;
  readonly token: HostOwnershipToken;
  readonly state: HostOwnershipState;
  readonly signal: AbortSignal;
  readonly persistence: HostPersistenceAuthority;
  readonly durableExecution: HostDurableExecutionAuthority;
  /** Throws when the managed Host has been closed or its fence is inactive. */
  assertActive(): void;
  /** Prepares a bounded private PostgreSQL maintenance operation. */
  preparePrivatePostgresMaintenance(
    request: PrivatePostgresMaintenanceRequest,
  ): Promise<PreparedPrivatePostgresMaintenance>;
  /** Retires product work and closes Host while preserving PostgreSQL control. */
  shutdownKeepingPrivatePostgres(retirement: HostRuntimeRetirement): Promise<void>;
}

/** Supplies persistence identity and callback-scoped runtime credentials. */
export interface ManagedHostPersistenceOptions {
  readonly continuityEpochId: ContinuityEpochId;
  readonly target: HostRuntimeDatabaseTarget;
  readonly withRuntimeDatabasePassword: HostPersistenceAuthority["withRuntimeDatabasePassword"];
}

/** Supplies durable-engine identity and callback-scoped credentials. */
export interface ManagedHostDurableExecutionOptions {
  readonly continuityEpochId: ContinuityEpochId;
  readonly target: HostDurableExecutionDatabaseTarget;
  readonly withDurableExecutionDatabasePassword: HostDurableExecutionAuthority["withDurableExecutionDatabasePassword"];
}

/** Operations retained by the managed Host wrapper for maintenance control. */
export interface ManagedHostOperations {
  /** Prepares a maintenance window through the Bootstrap authority. */
  preparePrivatePostgresMaintenance(
    request: PrivatePostgresMaintenanceRequest,
  ): Promise<PreparedPrivatePostgresMaintenance>;
  /** Retires product work and closes the old Host while leaving PostgreSQL controllable. */
  shutdownKeepingPrivatePostgres(retirement: HostRuntimeRetirement): Promise<void>;
}

interface ManagedHostRecord {
  readonly raw: HostOwnershipContext;
  readonly operations: ManagedHostOperations;
  terminal: boolean;
}

const managedHostRecords = new WeakMap<
  BootstrapManagedHostContext,
  ManagedHostRecord
>();

function invalidCapability(): ProblemError {
  return createProblemError({
    problemCode: "bootstrap.host.invalid_managed_capability",
    category: "integrity",
    retryClass: "manual",
    title: "Managed Host capability is invalid",
    detail: "The managed Host value was not issued by bootstrap-runtime",
  });
}

function terminalProblem(): ProblemError {
  return createProblemError({
    problemCode: "bootstrap.host.managed_host_terminal",
    category: "conflict",
    retryClass: "manual",
    title: "Managed Host capability is terminal",
    detail: "The previous managed Host cannot authorize new Host work after handoff",
  });
}

/** Validates that a value is an authentic managed Host capability. */
export function assertManagedHostContext(
  value: unknown,
): asserts value is BootstrapManagedHostContext {
  if (
    typeof value !== "object" ||
    value === null ||
    !managedHostRecords.has(value as BootstrapManagedHostContext)
  ) {
    throw invalidCapability();
  }
}

/** Creates the terminal-aware managed Host wrapper around raw ownership. */
export function createManagedHostContext(
  raw: HostOwnershipContext,
  operations: ManagedHostOperations,
  persistenceOptions: ManagedHostPersistenceOptions,
  durableExecutionOptions: ManagedHostDurableExecutionOptions,
): BootstrapManagedHostContext {
  const record: ManagedHostRecord = {
    raw,
    operations,
    terminal: false,
  };
  const persistence: HostPersistenceAuthority = Object.freeze({
    installationId: raw.installationId,
    instanceId: raw.instanceId,
    bootId: raw.bootId,
    continuityEpochId: persistenceOptions.continuityEpochId,
    token: raw.token,
    target: persistenceOptions.target,
    signal: raw.signal,
    assertActive() {
      if (record.terminal) throw terminalProblem();
      raw.assertActive();
    },
    async withRuntimeDatabasePassword<T>(
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ) {
      if (record.terminal) throw terminalProblem();
      raw.assertActive();
      return await persistenceOptions.withRuntimeDatabasePassword(use);
    },
  });
  const durableExecution: HostDurableExecutionAuthority = Object.freeze({
    installationId: raw.installationId,
    instanceId: raw.instanceId,
    bootId: raw.bootId,
    continuityEpochId: durableExecutionOptions.continuityEpochId,
    token: raw.token,
    target: durableExecutionOptions.target,
    signal: raw.signal,
    assertActive() {
      if (record.terminal) throw terminalProblem();
      raw.assertActive();
    },
    async withDurableExecutionDatabasePassword<T>(
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ) {
      if (record.terminal) throw terminalProblem();
      raw.assertActive();
      return await durableExecutionOptions.withDurableExecutionDatabasePassword(use);
    },
  });
  const managed: BootstrapManagedHostContext = Object.freeze({
    installationId: raw.installationId,
    instanceId: raw.instanceId,
    bootId: raw.bootId,
    continuityEpochId: persistenceOptions.continuityEpochId,
    token: raw.token,
    get state() {
      return record.terminal ? "CLOSED" : raw.state;
    },
    signal: raw.signal,
    persistence,
    durableExecution,
    assertActive() {
      if (record.terminal) throw terminalProblem();
      raw.assertActive();
    },
    preparePrivatePostgresMaintenance(request: PrivatePostgresMaintenanceRequest) {
      if (record.terminal) throw terminalProblem();
      raw.assertActive();
      return record.operations.preparePrivatePostgresMaintenance(request);
    },
    shutdownKeepingPrivatePostgres(retirement: HostRuntimeRetirement) {
      if (record.terminal) throw terminalProblem();
      raw.assertActive();
      return record.operations.shutdownKeepingPrivatePostgres(retirement);
    },
  });
  managedHostRecords.set(managed, record);
  return managed;
}

/** Marks managed Host terminal so no later operation can authorize work. */
export function markManagedHostTerminal(managed: BootstrapManagedHostContext): void {
  assertManagedHostContext(managed);
  const record = managedHostRecords.get(managed);
  if (record === undefined) throw invalidCapability();
  record.terminal = true;
}
