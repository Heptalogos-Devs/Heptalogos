// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines callback-scoped Bootstrap secret access so credential bytes are not
 * retained by callers or promoted into a broader configuration contract.
 * @module bootstrap/key-provider
 */

import type {
  BootId,
  InstallationId,
  InstanceId,
} from "@heptalogos/foundation-contracts";

/** Identifies the installation, boot, and secret purpose for one key request. */
export interface BootstrapKeyRequestContext {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly purpose:
    | "private-postgres-bootstrap-superuser"
    | "private-postgres-host-lease-role"
    | "private-postgres-runtime-role"
    | "private-postgres-migration-role"
    | "private-postgres-durable-execution-role";
}

/** Supplies one Bootstrap secret only for the duration of an async callback. */
export interface BootstrapKeyProvider {
  /** Uses the bootstrap-superuser password without returning or retaining it. */
  withPrivatePostgresBootstrapPassword<T>(
    context: BootstrapKeyRequestContext,
    use: (passwordUtf8: Uint8Array) => Promise<T>,
  ): Promise<T>;
  /** Uses the Host-lease password within a bounded callback scope. */
  withPrivatePostgresHostLeasePassword<T>(
    context: BootstrapKeyRequestContext,
    use: (passwordUtf8: Uint8Array) => Promise<T>,
  ): Promise<T>;
  /** Uses the runtime-role password within a bounded callback scope. */
  withPrivatePostgresRuntimePassword<T>(
    context: BootstrapKeyRequestContext,
    use: (passwordUtf8: Uint8Array) => Promise<T>,
  ): Promise<T>;
  /** Uses the migration-role password within a bounded callback scope. */
  withPrivatePostgresMigrationPassword<T>(
    context: BootstrapKeyRequestContext,
    use: (passwordUtf8: Uint8Array) => Promise<T>,
  ): Promise<T>;
  /** Uses the durable-engine password within a bounded callback scope. */
  withPrivatePostgresDurableExecutionPassword<T>(
    context: BootstrapKeyRequestContext,
    use: (passwordUtf8: Uint8Array) => Promise<T>,
  ): Promise<T>;
}
