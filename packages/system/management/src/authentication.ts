// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Administrator authentication independent of Subject, models and runtime graphs.
 * @module authentication
 */
import {
  createUuidV7Id,
  formatInstant,
  parseUuidV7Id,
  type Instant,
} from "@heptalogos/foundation-contracts";
import type { PersistenceService } from "@heptalogos/persistence";
import type { TimeService } from "@heptalogos/time-service";
import {
  FIRST_CLAIM_LIFETIME_MS,
  type FirstAdministratorClaimId,
  type FirstClaimMaterial,
  type ClaimResponse,
  type LoginResponse,
  type ServerSession,
} from "./contracts.js";
import { createManagementRepository, type ManagementRepository } from "./repository.js";
import {
  digestManagementSecret,
  hashAdministratorPassword,
  normalizeAdministratorPassword,
  PASSWORD_NORMALIZATION_ID,
  randomBase64Url,
  verifyAdministratorPassword,
  ARGON2_PARAMETERS,
} from "./password.js";
import { managementProblem } from "./problems.js";

/** Authentication requires persistence and a mutation owner, without model or Subject dependencies. */
export interface ManagementAuthenticationOptions {
  readonly persistence: PersistenceService;
  readonly time: TimeService;
  readonly runMutationActivity: <T>(
    kind: string,
    operation: () => Promise<T>,
  ) => Promise<T>;
}
/** Single Administrator claim, opaque sessions and revocation. */
export interface ManagementAuthentication {
  /** Restores or issues the current expiring local claim. */
  ensureFirstAdministratorClaim(
    localClaim?: FirstClaimMaterial,
  ): Promise<FirstClaimMaterial | undefined>;
  /** Consumes the claim and commits the first password verifier. */
  claimFirstAdministrator(
    claimId: string,
    claimSecret: string,
    password: string,
  ): Promise<ClaimResponse>;
  /** Verifies the password and issues an opaque session. */
  login(password: string): Promise<LoginResponse>;
  /** Checks session validity, revocation and authentication epoch. */
  authenticate(sessionToken: string): Promise<ServerSession>;
  /** Revokes the supplied current session. */
  logout(sessionToken: string): Promise<void>;
}

function timeAfter(time: Instant, milliseconds: number): Instant {
  return formatInstant(new Date(Date.parse(time) + milliseconds));
}

function invalidClaimId(value: string): FirstAdministratorClaimId {
  const parsed = parseUuidV7Id("FirstAdministratorClaimId", value);
  if (parsed === undefined) {
    throw managementProblem(
      "management.first_claim_invalid",
      "First-administrator claim is invalid",
      "The claim identifier is invalid",
      "validation",
    );
  }
  return parsed;
}

function claimSecretIsCanonical(value: string): boolean {
  try {
    const bytes = Buffer.from(value, "base64url");
    return bytes.byteLength === 32 && bytes.toString("base64url") === value;
  } catch {
    return false;
  }
}

function mapClaimStatus(status: string): never {
  if (status === "HOST_FENCE_LOST") {
    throw managementProblem(
      "management.host_fence_lost",
      "Host ownership fence was lost",
      "The Management mutation was not admitted by the current Host",
      "conflict",
    );
  }
  if (status === "ADMINISTRATOR_EXISTS") {
    throw managementProblem(
      "management.administrator_exists",
      "Administrator already exists",
      "The first-administrator claim can no longer be consumed",
      "conflict",
    );
  }
  if (status === "CLAIM_EXPIRED") {
    throw managementProblem(
      "management.first_claim_expired",
      "First-administrator claim has expired",
      "The first-administrator claim must be refreshed by the current Host",
      "conflict",
    );
  }
  if (status === "CLAIM_CONSUMED") {
    throw managementProblem(
      "management.first_claim_consumed",
      "First-administrator claim has already been consumed",
      "The first-administrator claim is single-use",
      "conflict",
    );
  }
  if (status === "CLAIM_INVALID" || status === "CLAIM_NOT_FOUND") {
    throw managementProblem(
      "management.first_claim_invalid",
      "First-administrator claim is invalid",
      "The supplied first-administrator claim is not the current canonical claim",
      "validation",
    );
  }
  throw managementProblem(
    "management.repository_invalid",
    "Management repository returned an unsupported status",
    "The canonical Management mutation status was not recognized",
    "integrity",
  );
}

function mapSessionStatus(status: string): never {
  if (status === "HOST_FENCE_LOST") {
    throw managementProblem(
      "management.host_fence_lost",
      "Host ownership fence was lost",
      "The Management mutation was not admitted by the current Host",
      "conflict",
    );
  }
  if (status === "ADMINISTRATOR_NOT_FOUND") {
    throw managementProblem(
      "management.invalid_credentials",
      "Management credentials are invalid",
      "The Administrator session could not be created",
      "conflict",
    );
  }
  throw managementProblem(
    "management.repository_invalid",
    "Management repository returned an unsupported status",
    "The canonical Management mutation status was not recognized",
    "integrity",
  );
}

/** Creates the model-independent authentication owner over canonical persistence. */
export function createManagementAuthentication(
  options: ManagementAuthenticationOptions,
): ManagementAuthentication {
  return createAuthenticationWithRepository(
    options,
    createManagementRepository(options.persistence),
  );
}

/** Internal construction shared with the Management composition. */
export function createAuthenticationWithRepository(
  options: ManagementAuthenticationOptions,
  repository: ManagementRepository,
): ManagementAuthentication {
  const service: ManagementAuthentication = {
    async ensureFirstAdministratorClaim(localClaim) {
      const administrator = await repository.readAdministrator();
      if (administrator !== undefined) return undefined;
      const current = await repository.readCurrentClaim();
      const now = options.time.now();
      if (
        current !== undefined &&
        localClaim !== undefined &&
        current.claimId === localClaim.claimId &&
        current.expiresAt === localClaim.expiresAt &&
        digestManagementSecret(localClaim.claimSecret) === current.secretDigest &&
        current.expiresAt > now
      ) {
        return localClaim;
      }
      const claimId = createUuidV7Id("FirstAdministratorClaimId");
      const claimSecret = randomBase64Url(32);
      const expiresAt = timeAfter(now, FIRST_CLAIM_LIFETIME_MS);
      const status = await options.runMutationActivity(
        "management.first-claim.created",
        () =>
          repository.createOrReplaceClaim({
            claimId,
            secretDigest: digestManagementSecret(claimSecret),
            createdAt: now,
            expiresAt,
          }),
      );
      if (status !== "CREATED") mapClaimStatus(status);
      return Object.freeze({ claimId, claimSecret, expiresAt });
    },
    async claimFirstAdministrator(claimIdText, claimSecret, password) {
      if (!claimSecretIsCanonical(claimSecret)) {
        throw managementProblem(
          "management.first_claim_invalid",
          "First-administrator claim is invalid",
          "The claim secret is not canonical",
          "validation",
        );
      }
      const claimId = invalidClaimId(claimIdText);
      const normalized = normalizeAdministratorPassword(password);
      const passwordHash = await hashAdministratorPassword(normalized);
      const administratorId = createUuidV7Id("AdministratorId");
      const now = options.time.now();
      try {
        const status = await options.runMutationActivity(
          "management.administrator.claimed",
          () =>
            repository.consumeClaimCreateAdministrator({
              claimId,
              secretDigest: digestManagementSecret(claimSecret),
              now,
              administratorId,
              authEpoch: 1,
              passwordSalt: passwordHash.salt,
              passwordNonce: passwordHash.nonce,
              passwordVerifier: passwordHash.verifier,
              passwordMemoryCost: ARGON2_PARAMETERS.memory,
              passwordTimeCost: ARGON2_PARAMETERS.passes,
              passwordParallelism: ARGON2_PARAMETERS.parallelism,
              passwordNormalizationId: PASSWORD_NORMALIZATION_ID,
            }),
        );
        if (status !== "CLAIMED") mapClaimStatus(status);
        return Object.freeze({ schemaVersion: 1 as const, administratorId });
      } finally {
        passwordHash.salt.fill(0);
        passwordHash.nonce.fill(0);
        passwordHash.verifier.fill(0);
      }
    },
    async login(password) {
      let normalized: string;
      try {
        normalized = normalizeAdministratorPassword(password);
      } catch {
        throw managementProblem(
          "management.invalid_credentials",
          "Management credentials are invalid",
          "The supplied Management credentials are invalid",
          "conflict",
        );
      }
      const administrator = await repository.readAdministrator();
      if (administrator === undefined) {
        throw managementProblem(
          "management.invalid_credentials",
          "Management credentials are invalid",
          "The supplied Management credentials are invalid",
          "conflict",
        );
      }
      if (!(await verifyAdministratorPassword(normalized, administrator))) {
        throw managementProblem(
          "management.invalid_credentials",
          "Management credentials are invalid",
          "The supplied Management credentials are invalid",
          "conflict",
        );
      }
      const sessionToken = randomBase64Url(32);
      const sessionId = createUuidV7Id("ServerSessionId");
      const issuedAt = options.time.now();
      const expiresAt = timeAfter(issuedAt, 7 * 24 * 60 * 60 * 1_000);
      const status = await options.runMutationActivity(
        "management.session.created",
        () =>
          repository.createSession({
            sessionId,
            tokenDigest: digestManagementSecret(sessionToken),
            administratorId: administrator.administratorId,
            authEpoch: administrator.authEpoch,
            issuedAt,
            expiresAt,
          }),
      );
      if (status !== "CREATED") mapSessionStatus(status);
      return Object.freeze({ schemaVersion: 1 as const, sessionToken, expiresAt });
    },
    async authenticate(sessionToken) {
      if (!claimSecretIsCanonical(sessionToken)) {
        throw managementProblem(
          "management.session_invalid",
          "Management session is invalid",
          "The supplied Management session is invalid",
          "conflict",
        );
      }
      const session = await repository.readSessionByTokenDigest(
        digestManagementSecret(sessionToken),
      );
      if (session === undefined) {
        throw managementProblem(
          "management.session_invalid",
          "Management session is invalid",
          "The supplied Management session is invalid",
          "conflict",
        );
      }
      const now = options.time.now();
      if (session.revokedAt !== undefined) {
        throw managementProblem(
          "management.session_revoked",
          "Management session is revoked",
          "The supplied Management session has been revoked",
          "conflict",
        );
      }
      if (session.expiresAt <= now) {
        throw managementProblem(
          "management.session_expired",
          "Management session is expired",
          "The supplied Management session has expired",
          "conflict",
        );
      }
      const administrator = await repository.readAdministrator();
      if (
        administrator === undefined ||
        administrator.administratorId !== session.administratorId ||
        administrator.authEpoch !== session.authEpoch
      ) {
        throw managementProblem(
          "management.session_invalid",
          "Management session is invalid",
          "The supplied Management session no longer matches the Administrator",
          "conflict",
        );
      }
      return session;
    },
    async logout(sessionToken) {
      const session = await service.authenticate(sessionToken);
      const status = await options.runMutationActivity(
        "management.session.revoked",
        () =>
          repository.revokeSession({
            sessionId: session.sessionId,
            tokenDigest: session.tokenDigest,
            revokedAt: options.time.now(),
          }),
      );
      if (status === "REVOKED") return;
      if (status === "HOST_FENCE_LOST") mapSessionStatus(status);
      throw managementProblem(
        "management.session_invalid",
        "Management session is invalid",
        "The Management session could not be revoked",
        "conflict",
      );
    },
  };
  return Object.freeze(service);
}
