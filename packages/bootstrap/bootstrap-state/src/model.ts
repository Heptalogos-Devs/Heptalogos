// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Declares the versioned BootstrapState envelope and load-result contracts that
 * separate durable evidence from the authority established by current startup.
 * @module model
 */

import type {
  ContentDigest,
  ContinuityEpochId,
  InstallationId,
  InstanceId,
  Problem,
  ProductGenerationId,
  Sha256Digest,
} from "@heptalogos/foundation-contracts";

/** Identifies the Bootstrap runtime generation recorded in current state. */
export type BootstrapRuntimeGenerationId =
  ContentDigest<"BootstrapRuntimeGenerationId">;
export type { ProductGenerationId } from "@heptalogos/foundation-contracts";

/** Versioned current BootstrapState body used for startup/recovery decisions. */
export interface BootstrapStateBodyV1 {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly activeBootstrapRuntimeGeneration: BootstrapRuntimeGenerationId;
  readonly previousBootstrapRuntimeGeneration?: BootstrapRuntimeGenerationId;
  readonly activeProductGeneration: ProductGenerationId;
  readonly continuityEpochId: ContinuityEpochId;
  readonly lastKnownGoodProductGeneration?: ProductGenerationId;
  readonly lastCommittedOperationRef?: string;
  readonly privatePostgres?: PrivatePostgresBootstrapStateV1;
}

/** Couples current BootstrapState body with its canonical digest. */
export interface BootstrapStateEnvelopeV1 {
  readonly state: BootstrapStateBodyV1;
  readonly digest: Sha256Digest;
}

/** Identifies the private PostgreSQL initialization profile used by the state. */
export type PrivatePostgresInitializationProfileRevision =
  ContentDigest<"PrivatePostgresInitializationProfileRevision">;

/** Versioned private PostgreSQL identity and placement recorded in BootstrapState. */
export interface PrivatePostgresBootstrapStateV1 {
  readonly schemaVersion: 1;
  readonly postgresMajor: 18;
  readonly initializedByPostgresVersion: string;
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootstrapRoleName: string;
  readonly dataPlacement: {
    readonly rootId: "DATA";
    readonly relativePath: "private-postgres";
    readonly dataLayoutVersion: 1;
  };
  readonly persistedPort: number;
  readonly clusterSystemIdentifier: string;
  readonly initializationProfileRevision: PrivatePostgresInitializationProfileRevision;
}

/** Current BootstrapState body contract. */
export type BootstrapStateBody = BootstrapStateBodyV1;
/** Current BootstrapState envelope contract. */
export type BootstrapStateEnvelope = BootstrapStateEnvelopeV1;

/** Reports an authenticated state envelope or a typed parse Problem. */
export type BootstrapStateParseResult =
  | { readonly ok: true; readonly value: BootstrapStateEnvelope }
  | { readonly ok: false; readonly problem: Problem };
