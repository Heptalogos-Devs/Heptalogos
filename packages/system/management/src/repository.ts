// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns the Management repository boundary over the existing Host-fenced
 * PersistenceService. Authoritative mutations can only reach PostgreSQL
 * through the four canonical Management functions.
 * @module repository
 */

import {
  formatInstant,
  isSha256Hex,
  parseInstant,
  parseUuidV7Id,
  type Instant,
} from "@heptalogos/foundation-contracts";
import {
  useRepositoryMutationTransaction,
  useRepositoryReadTransaction,
  executeRepositorySql,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type {
  PersistenceMutationTransactionContext,
  PersistenceService,
} from "@heptalogos/persistence";
import type {
  AdministratorId,
  AdministratorVerifier,
  FirstAdministratorClaim,
  FirstAdministratorClaimId,
  ManagementDigest,
  ServerSession,
  ServerSessionId,
} from "./contracts.js";
import { managementProblem } from "./problems.js";

interface ClaimRow {
  readonly claim_id: unknown;
  readonly secret_digest: unknown;
  readonly created_at: unknown;
  readonly expires_at: unknown;
  readonly consumed_at: unknown;
}

interface AdministratorRow {
  readonly administrator_id: unknown;
  readonly auth_epoch: unknown;
  readonly password_algorithm: unknown;
  readonly password_salt: unknown;
  readonly password_nonce: unknown;
  readonly password_verifier: unknown;
  readonly password_memory_cost: unknown;
  readonly password_time_cost: unknown;
  readonly password_parallelism: unknown;
  readonly password_normalization_id: unknown;
}

interface SessionRow {
  readonly session_id: unknown;
  readonly token_digest: unknown;
  readonly administrator_id: unknown;
  readonly auth_epoch: unknown;
  readonly issued_at: unknown;
  readonly expires_at: unknown;
  readonly revoked_at: unknown;
}

type MutationStatus =
  | "CREATED"
  | "CLAIMED"
  | "REVOKED"
  | "HOST_FENCE_LOST"
  | "CLAIM_NOT_FOUND"
  | "CLAIM_CONSUMED"
  | "CLAIM_INVALID"
  | "CLAIM_EXPIRED"
  | "ADMINISTRATOR_EXISTS"
  | "ADMINISTRATOR_NOT_FOUND"
  | "SESSION_EXISTS"
  | "NOT_FOUND";

function repositoryProblem(detail: string): never {
  throw managementProblem(
    "management.repository_invalid",
    "Management repository returned invalid canonical data",
    detail,
    "integrity",
  );
}

function asInstant(value: unknown): Instant {
  const text = value instanceof Date ? formatInstant(value) : value;
  const instant = parseInstant(text);
  if (instant === undefined)
    return repositoryProblem("Canonical Management time is invalid");
  return instant;
}

function asUuid<T extends string>(
  brand: T,
  value: unknown,
): import("@heptalogos/foundation-contracts").UuidV7Id<T> {
  const parsed = parseUuidV7Id(brand, value);
  if (parsed === undefined)
    return repositoryProblem("Canonical Management UUID is invalid");
  return parsed;
}

function asDigest(value: unknown): ManagementDigest {
  if (!isSha256Hex(value))
    return repositoryProblem("Canonical Management digest is invalid");
  return value as ManagementDigest;
}

function asNumber(value: unknown, name: string): number {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
    return repositoryProblem(name + " is not a non-negative safe integer");
  }
  return numberValue;
}

function asBytes(value: unknown, name: string): Uint8Array {
  if (value instanceof Uint8Array) return Uint8Array.from(value);
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    return Uint8Array.from(value);
  }
  return repositoryProblem(name + " is not canonical binary data");
}

function parseClaim(row: ClaimRow): FirstAdministratorClaim {
  const claimId = asUuid("FirstAdministratorClaimId", row.claim_id);
  const digest = asDigest(row.secret_digest);
  return Object.freeze({
    claimId,
    secretDigest: digest,
    createdAt: asInstant(row.created_at),
    expiresAt: asInstant(row.expires_at),
    ...(row.consumed_at === null || row.consumed_at === undefined
      ? {}
      : { consumedAt: asInstant(row.consumed_at) }),
  });
}

function parseAdministrator(row: AdministratorRow): AdministratorVerifier {
  const algorithm = row.password_algorithm;
  const normalization = row.password_normalization_id;
  if (algorithm !== "argon2id" || normalization !== "NFKC-v1") {
    return repositoryProblem("Canonical Administrator password metadata is invalid");
  }
  return Object.freeze({
    administratorId: asUuid("AdministratorId", row.administrator_id),
    authEpoch: asNumber(row.auth_epoch, "auth_epoch"),
    passwordAlgorithm: "argon2id",
    passwordSalt: asBytes(row.password_salt, "password_salt"),
    passwordNonce: asBytes(row.password_nonce, "password_nonce"),
    passwordVerifier: asBytes(row.password_verifier, "password_verifier"),
    passwordMemoryCost: asNumber(row.password_memory_cost, "password_memory_cost"),
    passwordTimeCost: asNumber(row.password_time_cost, "password_time_cost"),
    passwordParallelism: asNumber(row.password_parallelism, "password_parallelism"),
    passwordNormalizationId: "NFKC-v1",
  });
}

function parseSession(row: SessionRow): ServerSession {
  return Object.freeze({
    sessionId: asUuid("ServerSessionId", row.session_id),
    tokenDigest: asDigest(row.token_digest),
    administratorId: asUuid("AdministratorId", row.administrator_id),
    authEpoch: asNumber(row.auth_epoch, "auth_epoch"),
    issuedAt: asInstant(row.issued_at),
    expiresAt: asInstant(row.expires_at),
    ...(row.revoked_at === null || row.revoked_at === undefined
      ? {}
      : { revokedAt: asInstant(row.revoked_at) }),
  });
}

async function rows<T>(
  transaction: PersistenceInternalTransaction,
  text: string,
  parameters: readonly unknown[],
): Promise<readonly T[]> {
  return executeRepositorySql<T>(transaction, text, parameters);
}

function fenceParameters(
  context: PersistenceMutationTransactionContext,
): readonly unknown[] {
  const execution = context.execution;
  return [execution.instanceId, execution.bootId, execution.hostOwnershipToken];
}

/** Repository operations consumed by the Management service. */
export interface ManagementRepository {
  /** Reads the singleton Administrator verifier. */
  readAdministrator(): Promise<AdministratorVerifier | undefined>;
  /** Reads the current unconsumed first-administrator claim. */
  readCurrentClaim(): Promise<FirstAdministratorClaim | undefined>;
  /** Reads a first-administrator claim by identifier. */
  readClaim(
    claimId: FirstAdministratorClaimId,
  ): Promise<FirstAdministratorClaim | undefined>;
  /** Reads a session by its opaque token digest. */
  readSessionByTokenDigest(
    digest: ManagementDigest,
  ): Promise<ServerSession | undefined>;
  /** Creates or replaces the current first-administrator claim. */
  createOrReplaceClaim(input: {
    readonly claimId: FirstAdministratorClaimId;
    readonly secretDigest: ManagementDigest;
    readonly createdAt: Instant;
    readonly expiresAt: Instant;
  }): Promise<"CREATED" | "HOST_FENCE_LOST">;
  /** Atomically consumes a claim and creates the Administrator verifier. */
  consumeClaimCreateAdministrator(input: {
    readonly claimId: FirstAdministratorClaimId;
    readonly secretDigest: ManagementDigest;
    readonly now: Instant;
    readonly administratorId: AdministratorId;
    readonly authEpoch: number;
    readonly passwordSalt: Uint8Array;
    readonly passwordNonce: Uint8Array;
    readonly passwordVerifier: Uint8Array;
    readonly passwordMemoryCost: number;
    readonly passwordTimeCost: number;
    readonly passwordParallelism: number;
    readonly passwordNormalizationId: "NFKC-v1";
  }): Promise<MutationStatus>;
  /** Creates a server-side opaque session. */
  createSession(input: {
    readonly sessionId: ServerSessionId;
    readonly tokenDigest: ManagementDigest;
    readonly administratorId: AdministratorId;
    readonly authEpoch: number;
    readonly issuedAt: Instant;
    readonly expiresAt: Instant;
  }): Promise<MutationStatus>;
  /** Revokes a server-side opaque session. */
  revokeSession(input: {
    readonly sessionId: ServerSessionId;
    readonly tokenDigest: ManagementDigest;
    readonly revokedAt: Instant;
  }): Promise<MutationStatus>;
}

/** Creates the Management repository over one existing PersistenceService. */
export function createManagementRepository(
  persistence: PersistenceService,
): ManagementRepository {
  const readOne = <T>(
    text: string,
    parameters: readonly unknown[],
  ): Promise<readonly T[]> =>
    persistence.read((context) =>
      useRepositoryReadTransaction(context, (transaction) =>
        rows<T>(transaction, text, parameters),
      ),
    );

  const mutate = <T>(
    text: string,
    parameters: (context: PersistenceMutationTransactionContext) => readonly unknown[],
  ): Promise<readonly T[]> =>
    persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, (transaction) =>
        rows<T>(transaction, text, parameters(context)),
      ),
    );

  return Object.freeze({
    async readAdministrator(): Promise<AdministratorVerifier | undefined> {
      const result = await readOne<AdministratorRow>(
        `SELECT administrator_id, auth_epoch, password_algorithm, password_salt,
                password_nonce, password_verifier, password_memory_cost,
                password_time_cost, password_parallelism, password_normalization_id
           FROM "heptalogos"."administrator"
          WHERE singleton = true`,
        [],
      );
      const row = result[0];
      return row === undefined ? undefined : parseAdministrator(row);
    },
    async readCurrentClaim(): Promise<FirstAdministratorClaim | undefined> {
      const result = await readOne<ClaimRow>(
        `SELECT claim_id, secret_digest, created_at, expires_at, consumed_at
           FROM "heptalogos"."first_administrator_claim"
          WHERE consumed_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1`,
        [],
      );
      const row = result[0];
      return row === undefined ? undefined : parseClaim(row);
    },
    async readClaim(
      claimId: FirstAdministratorClaimId,
    ): Promise<FirstAdministratorClaim | undefined> {
      const result = await readOne<ClaimRow>(
        `SELECT claim_id, secret_digest, created_at, expires_at, consumed_at
           FROM "heptalogos"."first_administrator_claim"
          WHERE claim_id = $1`,
        [claimId],
      );
      const row = result[0];
      return row === undefined ? undefined : parseClaim(row);
    },
    async readSessionByTokenDigest(
      digest: ManagementDigest,
    ): Promise<ServerSession | undefined> {
      const result = await readOne<SessionRow>(
        `SELECT session_id, token_digest, administrator_id, auth_epoch,
                issued_at, expires_at, revoked_at
           FROM "heptalogos"."server_session"
          WHERE token_digest = $1`,
        [digest],
      );
      const row = result[0];
      return row === undefined ? undefined : parseSession(row);
    },
    async createOrReplaceClaim(
      input: Parameters<ManagementRepository["createOrReplaceClaim"]>[0],
    ) {
      const result = await mutate<{ readonly status: MutationStatus }>(
        `SELECT "heptalogos"."management_create_or_replace_claim"(
          $1, $2, $3, $4, $5, $6, $7
        ) AS status`,
        (context) => [
          input.claimId,
          input.secretDigest,
          input.createdAt,
          input.expiresAt,
          ...fenceParameters(context),
        ],
      );
      const status = result[0]?.status;
      if (status === "CREATED" || status === "HOST_FENCE_LOST") return status;
      return repositoryProblem("Unexpected first-claim creation status");
    },
    async consumeClaimCreateAdministrator(
      input: Parameters<ManagementRepository["consumeClaimCreateAdministrator"]>[0],
    ) {
      const salt = Uint8Array.from(input.passwordSalt);
      const nonce = Uint8Array.from(input.passwordNonce);
      const verifier = Uint8Array.from(input.passwordVerifier);
      try {
        const result = await mutate<{ readonly status: MutationStatus }>(
          `SELECT "heptalogos"."management_consume_claim_create_administrator"(
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
          ) AS status`,
          (context) => [
            input.claimId,
            input.secretDigest,
            input.now,
            input.administratorId,
            input.authEpoch,
            "argon2id",
            salt,
            nonce,
            verifier,
            input.passwordMemoryCost,
            input.passwordTimeCost,
            input.passwordParallelism,
            input.passwordNormalizationId,
            ...fenceParameters(context),
          ],
        );
        const status = result[0]?.status;
        if (status === undefined)
          return repositoryProblem("Missing claim consumption status");
        return status;
      } finally {
        salt.fill(0);
        nonce.fill(0);
        verifier.fill(0);
      }
    },
    async createSession(input: Parameters<ManagementRepository["createSession"]>[0]) {
      const result = await mutate<{ readonly status: MutationStatus }>(
        `SELECT "heptalogos"."management_create_session"(
          $1, $2, $3, $4, $5, $6, $7, $8, $9
        ) AS status`,
        (context) => [
          input.sessionId,
          input.tokenDigest,
          input.administratorId,
          input.authEpoch,
          input.issuedAt,
          input.expiresAt,
          ...fenceParameters(context),
        ],
      );
      const status = result[0]?.status;
      if (status === undefined)
        return repositoryProblem("Missing session creation status");
      return status;
    },
    async revokeSession(input: Parameters<ManagementRepository["revokeSession"]>[0]) {
      const result = await mutate<{ readonly status: MutationStatus }>(
        `SELECT "heptalogos"."management_revoke_session"(
          $1, $2, $3, $4, $5, $6
        ) AS status`,
        (context) => [
          input.sessionId,
          input.tokenDigest,
          input.revokedAt,
          ...fenceParameters(context),
        ],
      );
      const status = result[0]?.status;
      if (status === undefined)
        return repositoryProblem("Missing session revocation status");
      return status;
    },
  });
}
