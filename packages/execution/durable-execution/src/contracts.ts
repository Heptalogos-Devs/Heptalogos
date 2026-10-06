// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the normalized durable-execution adapter contracts without exposing
 * DBOS SDK, Execa, or PostgreSQL implementation objects.
 * @module contracts
 */

import type {
  HostCanonicalMigrationAuthority,
  HostDurableExecutionAuthority,
} from "@heptalogos/host-ownership";
import type { WorkQueueProfileCatalog } from "@heptalogos/work-queue";
import type { DurableCodeVersion } from "@heptalogos/foundation-contracts";

/** Exact DBOS package identity adopted by the durable-execution boundary. */
export const DBOS_PACKAGE_NAME = "@dbos-inc/dbos-sdk" as const;
/** Exact DBOS package version approved by the current implementation plan. */
export const DBOS_PACKAGE_VERSION = "4.27.6" as const;

/** Identifies the installed DBOS package and its package-contained CLI. */
export interface DurableExecutionPackageResolution {
  readonly packageName: typeof DBOS_PACKAGE_NAME;
  readonly packageVersion: typeof DBOS_PACKAGE_VERSION;
  readonly packageRoot: string;
  readonly cliPath: string;
}

/** Bounds one shell-free invocation of the installed DBOS CLI. */
export interface DurableExecutionProcessOptions {
  readonly cliPath: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  readonly cwd?: string;
  /** Explicit child-environment values; inherited PostgreSQL keys are removed first. */
  readonly env?: Readonly<Record<string, string>>;
}

/** Normalized bounded output from one DBOS CLI invocation. */
export interface DurableExecutionProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Owns provisioning of the current DBOS vendor schema under migration Authority. */
export interface DurableExecutionSchemaProvisioner {
  /** Ensure the installed DBOS schema is current using the supplied Authority. */
  ensureCurrent(authority: HostCanonicalMigrationAuthority): Promise<void>;
}

/** Supplies explicit bounds for one DBOS vendor-schema provisioning operation. */
export interface DurableExecutionSchemaProvisionerOptions {
  readonly processTimeoutMs: number;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
}

/** Bounds the caller-owned PostgreSQL pool used by DBOS system operations. */
export interface DurableExecutionPoolOptions {
  readonly maxConnections: number;
  readonly idleTimeoutMs: number;
  readonly connectionTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly idleInTransactionSessionTimeoutMs: number;
}

/** Configures one Host-bound DurableExecution runtime. */
export interface DurableExecutionRuntimeOptions {
  readonly durableCodeVersion: DurableCodeVersion;
  readonly systemPool: DurableExecutionPoolOptions;
  readonly systemDatabasePollingConcurrency: number;
  readonly maxConcurrentQueueDispatches: number;
  readonly workflowMaxRecoveryAttempts: number;
  readonly shutdownDrainTimeoutMs: number;
  readonly profiles: WorkQueueProfileCatalog;
  /** Fence the Host when an irreversible provider failure cannot be restored. */
  readonly onTerminalFailure: (error: unknown) => void | Promise<void>;
  readonly onBackgroundError: (error: unknown) => void;
}

/** Public lifecycle state of the Host-bound durable runtime. */
export type DurableExecutionLifecycleState =
  "CREATED" | "STARTING" | "OPEN" | "CLOSING" | "CLOSED" | "FAILED";

/** Exposes lifecycle operations without leaking DBOS or pool implementation types. */
export interface DurableExecutionRuntime {
  readonly state: DurableExecutionLifecycleState;
  /** Start the Host-bound DBOS runtime and verify its queue projections. */
  start(): Promise<void>;
  /** Close the runtime and release all owned DBOS resources. */
  close(): Promise<void>;
}

/** Identifies the Host authority consumed by a DurableExecution runtime. */
export type DurableExecutionAuthority = HostDurableExecutionAuthority;
