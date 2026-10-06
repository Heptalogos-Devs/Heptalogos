// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines SecretRef, redacted metadata, protected write input, and the
 * callback-scoped resolution contract for normal Product secrets.
 * @module contracts
 */

import type { Instant, UuidV7Id } from "@heptalogos/foundation-contracts";
import {
  configurationScopeRefSchema,
  type ConfigurationScopeRef,
} from "@heptalogos/configuration";
import type { ExecutionContextRuntime } from "@heptalogos/execution-lineage";
import type { EvidenceService } from "@heptalogos/evidence";
import type { OsCredentialStore } from "@heptalogos/os-credential";
import type { PersistenceService } from "@heptalogos/persistence";
import type { TimeService } from "@heptalogos/time-service";
import { Type } from "@heptalogos/schema-runtime/typebox";

/** Identifies one normal Product Secret. */
export type SecretId = UuidV7Id<"SecretId">;

/** Identifies the Product resource whose secret scope is being authorized. */
export type SecretScopeRef = ConfigurationScopeRef;

/** Redacted canonical metadata for one normal Product Secret. */
export interface SecretMetadata {
  readonly schemaVersion: 1;
  readonly secretId: SecretId;
  readonly state: "ACTIVE" | "REVOKED" | "UNAVAILABLE";
  readonly purpose: string;
  readonly scopeRef?: SecretScopeRef;
  readonly backendKind: "os-credential";
  readonly createdAt: Instant;
  readonly replacedAt?: Instant;
  readonly revokedAt?: Instant;
}

/** Stable Product reference to secret material. */
export interface SecretRef {
  readonly schemaVersion: 1;
  readonly secretId: SecretId;
}

/** Protected material supplied only through a trusted input boundary. */
export interface SecretWriteInput {
  readonly purpose: string;
  readonly scopeRef?: SecretScopeRef;
  readonly material: Uint8Array;
}

/** Exact consumer/purpose/scope authorization for material resolution. */
export interface SecretResolutionContext {
  readonly consumer: string;
  readonly purpose: string;
  readonly resourceRef?: SecretScopeRef;
}

/** Ephemeral material returned only to the authorized runtime callback. */
export interface ResolvedSecretMaterial {
  readonly __ephemeral: true;
  readonly bytes: Uint8Array;
}

/** Options binding Secret to Persistence, lineage, evidence, and OS credential. */
export interface SecretServiceOptions {
  readonly persistence: PersistenceService;
  readonly time: TimeService;
  readonly execution: ExecutionContextRuntime;
  readonly evidence: EvidenceService;
  readonly credentialStore?: OsCredentialStore;
}

/** Current normal Product Secret semantic service. */
export interface SecretService {
  /** Lists redacted metadata without material or backend locators. */
  listMetadata(): Promise<readonly SecretMetadata[]>;
  /** Reads redacted metadata for one SecretRef. */
  getMetadata(ref: SecretRef | string): Promise<SecretMetadata | undefined>;
  /** Stores new material and commits its redacted metadata. */
  createOrSet(input: SecretWriteInput): Promise<SecretRef>;
  /** Replaces material while preserving purpose and scope. */
  replace(ref: SecretRef | string, input: SecretWriteInput): Promise<SecretRef>;
  /** Revokes a SecretRef and removes its current backend generation. */
  revoke(ref: SecretRef | string): Promise<void>;
  /** Resolves material only inside the authorized ephemeral callback boundary. */
  resolve(
    ref: SecretRef | string,
    context: SecretResolutionContext,
  ): Promise<ResolvedSecretMaterial>;
}

const scopeRefSchema = configurationScopeRefSchema;

/** JSON Schema for protected secret.set input. */
export const secretSetInputSchema = Type.Object(
  {
    purpose: Type.String({ minLength: 1, maxLength: 256 }),
    scopeRef: Type.Optional(scopeRefSchema),
    material: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  { additionalProperties: false },
);

/** JSON Schema for protected secret.replace input. */
export const secretReplaceInputSchema = Type.Object(
  {
    secretRef: Type.String({ minLength: 1 }),
    material: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  { additionalProperties: false },
);

/** JSON Schema for secret.revoke input. */
export const secretRevokeInputSchema = Type.Object(
  {
    secretRef: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** JSON Schema for a redacted SecretRef. */
export const secretRefSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    secretId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/** JSON Schema for redacted SecretMetadata. */
export const secretMetadataSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    secretId: Type.String({ minLength: 1 }),
    state: Type.Union([
      Type.Literal("ACTIVE"),
      Type.Literal("REVOKED"),
      Type.Literal("UNAVAILABLE"),
    ]),
    purpose: Type.String(),
    scopeRef: Type.Optional(scopeRefSchema),
    backendKind: Type.Literal("os-credential"),
    createdAt: Type.String(),
    replacedAt: Type.Optional(Type.String()),
    revokedAt: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/** JSON Schema for the exact Secret resolution context. */
export const secretResolutionContextSchema = Type.Object(
  {
    consumer: Type.String({ minLength: 1, maxLength: 128 }),
    purpose: Type.String({ minLength: 1, maxLength: 256 }),
    resourceRef: Type.Optional(scopeRefSchema),
  },
  { additionalProperties: false },
);

/** Exposes the current secret scope schema to Management composition. */
export const secretScopeRefSchema = scopeRefSchema;
