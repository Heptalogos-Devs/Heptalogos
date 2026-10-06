// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines toolchain, placement, lifecycle, and maintenance contracts for the
 * private PostgreSQL adapter without deciding Bootstrap or Host authority.
 * @module contracts
 */

import type {
  ContentDigest,
  InstallationId,
  InstanceId,
} from "@heptalogos/foundation-contracts";

/** Major PostgreSQL line required by the current private cluster contract. */
export const PRIVATE_POSTGRES_ARCHITECTURE_MAJOR = 18 as const;
/** Qualified PostgreSQL patch version used by private-cluster evidence. */
export const PRIVATE_POSTGRES_QUALIFIED_VERSION = "18.6" as const;
/** Version of the installation-owned private data layout. */
export const PRIVATE_POSTGRES_DATA_LAYOUT_VERSION = 1 as const;
/** Relative path of the private PostgreSQL data directory under DATA. */
export const PRIVATE_POSTGRES_RELATIVE_DATA_PATH = "private-postgres" as const;
/** Bootstrap role used to initialize the private cluster. */
export const PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME = "heptalogos_bootstrap" as const;

/** Identifies the initialization profile whose invariants were verified. */
export type PrivatePostgresInitializationProfileRevision =
  ContentDigest<"PrivatePostgresInitializationProfileRevision">;

/** Resolved executable paths for the approved PostgreSQL toolchain. */
export interface PrivatePostgresToolchain {
  readonly version: typeof PRIVATE_POSTGRES_QUALIFIED_VERSION;
  readonly major: typeof PRIVATE_POSTGRES_ARCHITECTURE_MAJOR;
  readonly binDirectory: string;
  readonly postgres: string;
  readonly initdb: string;
  readonly pgCtl: string;
  readonly pgControldata: string;
  readonly pgIsReady: string;
}

/** Canonical installation-owned location of the private cluster. */
export interface PrivatePostgresPlacement {
  readonly rootId: "DATA";
  readonly relativePath: "private-postgres";
  readonly dataLayoutVersion: typeof PRIVATE_POSTGRES_DATA_LAYOUT_VERSION;
  readonly canonicalDataDirectory: string;
}

/** Identity returned by PostgreSQL after cluster initialization/inspection. */
export interface PrivatePostgresClusterIdentity {
  readonly bootstrapRoleName: string;
  readonly clusterSystemIdentifier: string;
  readonly postgresMajor: typeof PRIVATE_POSTGRES_ARCHITECTURE_MAJOR;
}

/** Expected cluster identity used to reject wrong or relocated data. */
export interface PrivatePostgresExpectedIdentity {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly postgresMajor: typeof PRIVATE_POSTGRES_ARCHITECTURE_MAJOR;
  readonly bootstrapRoleName: string;
  readonly placement: Omit<PrivatePostgresPlacement, "canonicalDataDirectory">;
  readonly persistedPort: number;
  readonly clusterSystemIdentifier: string;
  readonly initializationProfileRevision: PrivatePostgresInitializationProfileRevision;
}

/** Bounds private PostgreSQL startup, shutdown, and readiness polling. */
export interface PrivatePostgresLifecycleOptions {
  readonly startupTimeoutMs: number;
  readonly shutdownTimeoutMs: number;
  readonly readinessPollIntervalMs: number;
}

/** Guards private PostgreSQL process control under an owning Authority. */
export type PrivatePostgresControlGuard = () => void;

/** Reports whether Bootstrap started PostgreSQL or found it already running. */
export type PrivatePostgresStartupDisposition =
  "STARTED_BY_THIS_BOOTSTRAP" | "ALREADY_RUNNING";

/** Canonical encoding, authentication, and loopback profile for initialization. */
export interface PrivatePostgresInitializationProfile {
  readonly bootstrapRoleName: string;
  readonly encoding: "UTF8";
  readonly dataChecksums: true;
  readonly hostAuthentication: "scram-sha-256";
  readonly listenAddress: "127.0.0.1";
  readonly unixSocketDirectories: "";
  readonly persistedPort: number;
}

/** Reports verified identity and profile values after initialization. */
export interface PrivatePostgresInitializationResult {
  readonly toolchain: PrivatePostgresToolchain;
  readonly placement: PrivatePostgresPlacement;
  readonly identity: PrivatePostgresClusterIdentity;
  readonly port: number;
  readonly initializationProfileRevision: PrivatePostgresInitializationProfileRevision;
  readonly dataPageChecksumVersion: number;
  readonly databaseClusterState: string;
  readonly catalogVersionNumber: string;
}

/** Exposes the ready session mechanics used by Bootstrap handoff. */
export interface ReadyPrivatePostgresMechanics {
  readonly toolchain: PrivatePostgresToolchain;
  readonly placement: PrivatePostgresPlacement;
  readonly identity: PrivatePostgresClusterIdentity;
  readonly port: number;
  readonly startupDisposition: PrivatePostgresStartupDisposition;
  /** Stops PostgreSQL through the owning lifecycle controller. */
  stop(): Promise<void>;
  /** Restarts PostgreSQL through the owning lifecycle controller. */
  restart(): Promise<void>;
}
