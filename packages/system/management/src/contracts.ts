// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Authentication and Problem wire contracts; Product APIs use their owning schemas.
 * @module contracts
 */
import type {
  Branded,
  Instant,
  RetryClass,
  UuidV7Id,
} from "@heptalogos/foundation-contracts";
import { Type } from "@heptalogos/schema-runtime/typebox";
/** Canonical Administrator identity. */
export type AdministratorId = UuidV7Id<"AdministratorId">;
/** Expiring local claim identity. */
export type FirstAdministratorClaimId = UuidV7Id<"FirstAdministratorClaimId">;
/** Opaque bearer session identity. */
export type ServerSessionId = UuidV7Id<"ServerSessionId">;
/** Digest persisted in place of a plaintext Management secret. */
export type ManagementDigest = Branded<string, "ManagementDigest">;
/** Public Management contract version. */
export const MANAGEMENT_CONTRACT_VERSION = "management.v1" as const;
/** Versioned authenticated API prefix. */
export const MANAGEMENT_API_BASE_PATH = "/v1" as const;
/** Public identity discovery route. */
export const MANAGEMENT_DISCOVERY_PATH = "/.well-known/heptalogos-management" as const;
/** Lifetime of an unconsumed first-administrator claim. */
export const FIRST_CLAIM_LIFETIME_MS = 30 * 60 * 1_000;
/** Lifetime of an opaque administrator session. */
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;
/** Describes a public Management Problem response. */
export interface ManagementProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance?: string;
  readonly problemCode: string;
  readonly category: string;
  readonly retryClass: RetryClass;
  readonly schemaVersion: 1;
}
/** Request body for first-administrator claim consumption. */
export interface ClaimRequest {
  readonly claimId: string;
  readonly claimSecret: string;
  readonly password: string;
}
/** Successful first-administrator claim response. */
export interface ClaimResponse {
  readonly schemaVersion: 1;
  readonly administratorId: AdministratorId;
}
/** Short-lived plaintext claim material published only by the Host. */
export interface FirstClaimMaterial {
  readonly claimId: FirstAdministratorClaimId;
  readonly claimSecret: string;
  readonly expiresAt: Instant;
}
/** Request body for Administrator login. */
export interface LoginRequest {
  readonly password: string;
}
/** Successful login response with token plaintext returned once. */
export interface LoginResponse {
  readonly schemaVersion: 1;
  readonly sessionToken: string;
  readonly expiresAt: Instant;
}

/** Persisted password verifier and authentication epoch. */
export interface AdministratorVerifier {
  readonly administratorId: AdministratorId;
  readonly authEpoch: number;
  readonly passwordAlgorithm: "argon2id";
  readonly passwordSalt: Uint8Array;
  readonly passwordNonce: Uint8Array;
  readonly passwordVerifier: Uint8Array;
  readonly passwordMemoryCost: number;
  readonly passwordTimeCost: number;
  readonly passwordParallelism: number;
  readonly passwordNormalizationId: "NFKC-v1";
}
/** Internal current claim row. */
export interface FirstAdministratorClaim {
  readonly claimId: FirstAdministratorClaimId;
  readonly secretDigest: ManagementDigest;
  readonly createdAt: Instant;
  readonly expiresAt: Instant;
  readonly consumedAt?: Instant;
}
/** Internal current session row. */
export interface ServerSession {
  readonly sessionId: ServerSessionId;
  readonly tokenDigest: ManagementDigest;
  readonly administratorId: AdministratorId;
  readonly authEpoch: number;
  readonly issuedAt: Instant;
  readonly expiresAt: Instant;
  readonly revokedAt?: Instant;
}

const retryClassSchema = Type.Union([
  Type.Literal("never"),
  Type.Literal("immediate"),
  Type.Literal("backoff"),
  Type.Literal("after-change"),
  Type.Literal("manual"),
]);
/** Canonical Problem wire schema. */
export const managementProblemSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  status: Type.Integer(),
  detail: Type.String(),
  instance: Type.Optional(Type.String()),
  problemCode: Type.String(),
  category: Type.String(),
  retryClass: retryClassSchema,
  schemaVersion: Type.Literal(1),
});
/** Schema for consuming first-administrator claim material. */
export const claimRequestSchema = Type.Object({
  claimId: Type.String({ minLength: 1 }),
  claimSecret: Type.String({ minLength: 1 }),
  password: Type.String({ minLength: 1 }),
});
/** Canonical wire schema for the first-claim response. */
export const claimResponseSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  administratorId: Type.String(),
});
/** Canonical wire schema for login. */
export const loginRequestSchema = Type.Object({
  password: Type.String({ minLength: 1 }),
});
/** Canonical wire schema for a successful login. */
export const loginResponseSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  sessionToken: Type.String({ minLength: 1 }),
  expiresAt: Type.String(),
});
