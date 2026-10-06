// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Admits canonical persistence work only after the Bootstrap-to-Host handoff
 * has established the ownership context required by the canonical fence.
 * @module admission
 */

import {
  HOST_MIGRATION_ROLE,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  type HostCanonicalMigrationAuthority,
} from "@heptalogos/host-ownership";
import type {
  BootId,
  ContinuityEpochId,
  HostOwnershipToken,
  InstallationId,
  InstanceId,
} from "@heptalogos/foundation-contracts";
import type { BootstrapKeyProvider } from "../bootstrap/key-provider.js";

interface CanonicalHostAdmissionAuthority {
  readonly signal: AbortSignal;
  assertHeld(): void;
}

interface CanonicalHostAdmissionHostLease {
  readonly signal: AbortSignal;
  assertActive(): void;
}

/** Supplies the Host and canonical-schema context needed for admission. */
export interface CanonicalHostAdmissionOptions {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly token: HostOwnershipToken;
  readonly port: number;
  readonly bootstrapOwnership: CanonicalHostAdmissionAuthority;
  readonly hostLeaseConnection: CanonicalHostAdmissionHostLease;
  readonly keyProvider: BootstrapKeyProvider;
  readonly loadCurrentContinuityEpochId: () => Promise<ContinuityEpochId>;
  readonly initializeCanonicalHost: (context: {
    readonly authority: HostCanonicalMigrationAuthority;
    readonly expectedContinuityEpochId: ContinuityEpochId;
  }) => Promise<void>;
}

/** Reports the admitted canonical Host context and initialization outcome. */
export interface CanonicalHostAdmissionResult {
  readonly authority: HostCanonicalMigrationAuthority;
  readonly continuityEpochId: ContinuityEpochId;
}

/** Admits canonical schema work only after the Host fence is established. */
export async function admitCanonicalHost(
  options: CanonicalHostAdmissionOptions,
): Promise<CanonicalHostAdmissionResult> {
  const continuityEpochId = await options.loadCurrentContinuityEpochId();
  const assertCurrent = (): void => {
    options.bootstrapOwnership.assertHeld();
    options.hostLeaseConnection.assertActive();
  };
  const authority: HostCanonicalMigrationAuthority = Object.freeze({
    installationId: options.installationId,
    instanceId: options.instanceId,
    bootId: options.bootId,
    token: options.token,
    continuityEpochId,
    target: {
      host: "127.0.0.1" as const,
      port: options.port,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: HOST_MIGRATION_ROLE,
    },
    signal: AbortSignal.any([
      options.bootstrapOwnership.signal,
      options.hostLeaseConnection.signal,
    ]),
    assertCurrent,
    async withMigrationDatabasePassword<T>(
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      assertCurrent();
      return options.keyProvider.withPrivatePostgresMigrationPassword(
        {
          installationId: options.installationId,
          instanceId: options.instanceId,
          bootId: options.bootId,
          purpose: "private-postgres-migration-role",
        },
        async (passwordUtf8) => {
          assertCurrent();
          const result = await use(passwordUtf8);
          assertCurrent();
          return result;
        },
      );
    },
  });

  authority.assertCurrent();
  await options.initializeCanonicalHost({
    authority,
    expectedContinuityEpochId: continuityEpochId,
  });
  authority.assertCurrent();
  return { authority, continuityEpochId };
}
