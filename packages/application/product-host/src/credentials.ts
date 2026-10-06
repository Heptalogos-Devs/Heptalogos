// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Composes the production BootstrapKeyProvider over the OS credential store.
 * Bootstrap policy decides whether credentials may be provisioned; this module
 * never falls back to files, environment variables, defaults, or regeneration.
 * @module credentials
 */

import { randomBytes } from "node:crypto";
import {
  createProblemError,
  type InstallationId,
  type InstanceId,
} from "@heptalogos/foundation-contracts";
import type {
  BootstrapKeyProvider,
  BootstrapKeyRequestContext,
} from "@heptalogos/bootstrap-runtime";
import {
  createOsCredentialStore,
  type OsCredentialKey,
  type OsCredentialStore,
} from "@heptalogos/os-credential";

const purposeAccounts = Object.freeze({
  "private-postgres-bootstrap-superuser":
    "bootstrap/private-postgres-bootstrap-superuser",
  "private-postgres-host-lease-role": "bootstrap/private-postgres-host-lease-role",
  "private-postgres-runtime-role": "bootstrap/private-postgres-runtime-role",
  "private-postgres-migration-role": "bootstrap/private-postgres-migration-role",
  "private-postgres-durable-execution-role":
    "bootstrap/private-postgres-durable-execution-role",
} as const);

function credentialProblem(): Error {
  return createProblemError({
    problemCode: "product-host.bootstrap_credential_missing",
    category: "unavailable",
    retryClass: "manual",
    title: "Required Bootstrap credential is unavailable",
    detail:
      "An initialized installation is missing an authoritative PostgreSQL credential in the OS credential store",
  });
}

function serviceName(installationId: InstallationId): string {
  return "Heptalogos/" + installationId;
}

function keyFor(
  installationId: InstallationId,
  purpose: BootstrapKeyRequestContext["purpose"],
): OsCredentialKey {
  return Object.freeze({
    service: serviceName(installationId),
    account: purposeAccounts[purpose],
  });
}

function assertContext(
  context: BootstrapKeyRequestContext,
  installationId: InstallationId,
  instanceId: InstanceId,
  purpose: BootstrapKeyRequestContext["purpose"],
): void {
  if (
    context.installationId !== installationId ||
    context.instanceId !== instanceId ||
    context.purpose !== purpose
  ) {
    throw createProblemError({
      problemCode: "product-host.bootstrap_credential_context_invalid",
      category: "integrity",
      retryClass: "manual",
      title: "Bootstrap credential context is invalid",
      detail: "The credential request is not bound to the current installation",
    });
  }
}

/** Creates and validates the production OS-backed BootstrapKeyProvider. */
export async function createProductionBootstrapKeyProvider(options: {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly existingInstallation: boolean;
  readonly store?: OsCredentialStore;
}): Promise<BootstrapKeyProvider> {
  const store = options.store ?? createOsCredentialStore();
  const purposes = Object.keys(
    purposeAccounts,
  ) as BootstrapKeyRequestContext["purpose"][];
  for (const purpose of purposes) {
    const key = keyFor(options.installationId, purpose);
    const present = await store.exists(key);
    if (options.existingInstallation && !present) throw credentialProblem();
    if (!present) {
      const bytes = randomBytes(32);
      try {
        await store.set(key, new TextEncoder().encode(bytes.toString("base64url")));
      } finally {
        bytes.fill(0);
      }
    }
  }

  const withPurpose = <T>(
    context: BootstrapKeyRequestContext,
    purpose: BootstrapKeyRequestContext["purpose"],
    use: (passwordUtf8: Uint8Array) => Promise<T>,
  ): Promise<T> => {
    assertContext(context, options.installationId, options.instanceId, purpose);
    return store.withCredential<T>(keyFor(options.installationId, purpose), use);
  };

  return Object.freeze({
    withPrivatePostgresBootstrapPassword<T>(
      context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return withPurpose(context, "private-postgres-bootstrap-superuser", use);
    },
    withPrivatePostgresHostLeasePassword<T>(
      context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return withPurpose(context, "private-postgres-host-lease-role", use);
    },
    withPrivatePostgresRuntimePassword<T>(
      context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return withPurpose(context, "private-postgres-runtime-role", use);
    },
    withPrivatePostgresMigrationPassword<T>(
      context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return withPurpose(context, "private-postgres-migration-role", use);
    },
    withPrivatePostgresDurableExecutionPassword<T>(
      context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return withPurpose(context, "private-postgres-durable-execution-role", use);
    },
  });
}
