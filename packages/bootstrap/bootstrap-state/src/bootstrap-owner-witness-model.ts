// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the versioned Bootstrap owner witness model used to carry installation
 * and process identity across crash recovery.
 * @module bootstrap-owner-witness-model
 */

import {
  createUuidV7Id,
  type BootId,
  type Problem,
  type Sha256Digest,
  type UuidV7Id,
} from "@heptalogos/foundation-contracts";

/** Identifies one Bootstrap ownership attempt or published owner generation. */
export type BootstrapLockGenerationId = UuidV7Id<"BootstrapLockGenerationId">;

/** Creates a new identity for a Bootstrap ownership generation. */
export function createBootstrapLockGenerationId(): BootstrapLockGenerationId {
  return createUuidV7Id("BootstrapLockGenerationId");
}

/** Carries process and lease evidence for one versioned owner-witness phase. */
export interface BootstrapOwnerWitnessBodyV1 {
  readonly schemaVersion: 1;
  readonly phase: "ATTEMPT" | "OWNER" | "RELEASING";
  readonly lockGenerationId: BootstrapLockGenerationId;
  readonly bootId: BootId;
  readonly pid: number;
  readonly processStartedAtMs: number;
  readonly heartbeatMs: number;
  readonly createdAt: string;
}

/** Couples an owner witness body with its domain-separated digest. */
export interface BootstrapOwnerWitnessEnvelopeV1 {
  readonly witness: BootstrapOwnerWitnessBodyV1;
  readonly digest: Sha256Digest;
}

/** Reports either an authenticated witness or a typed parse Problem. */
export type BootstrapOwnerWitnessParseResult =
  | { readonly ok: true; readonly value: BootstrapOwnerWitnessEnvelopeV1 }
  | { readonly ok: false; readonly problem: Problem };
