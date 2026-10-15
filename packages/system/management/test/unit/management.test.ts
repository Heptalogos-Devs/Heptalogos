// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import type { Instant } from "@heptalogos/foundation-contracts";
import type { FirstAdministratorClaim, ServerSession } from "../../src/contracts.js";
import type { ManagementRepository } from "../../src/repository.js";
import { digestManagementSecret } from "../../src/password.js";
import { createAuthenticationWithRepository } from "../../src/authentication.js";
const NOW = "2026-09-03T00:00:00.000Z" as Instant;

function fakePersistence() {
  return {
    state: "OPEN" as const,
    read: async <T>(operation: (context: never) => Promise<T>) =>
      operation(undefined as never),
    mutate: async <T>(operation: (context: never) => Promise<T>) =>
      operation(undefined as never),
    close: async () => undefined,
  };
}

function repositoryFixture(): ManagementRepository {
  let administrator: any;
  let claim: FirstAdministratorClaim | undefined;
  const sessions = new Map<string, ServerSession>();
  return {
    async readAdministrator() {
      return administrator;
    },
    async readCurrentClaim() {
      return claim?.consumedAt === undefined ? claim : undefined;
    },
    async readClaim(claimId) {
      return claim?.claimId === claimId ? claim : undefined;
    },
    async readSessionByTokenDigest(digest) {
      return [...sessions.values()].find((session) => session.tokenDigest === digest);
    },
    async createOrReplaceClaim(input) {
      claim = Object.freeze({ ...input });
      return "CREATED";
    },
    async consumeClaimCreateAdministrator(input) {
      if (claim === undefined || claim.claimId !== input.claimId)
        return "CLAIM_NOT_FOUND";
      if (claim.consumedAt !== undefined) return "CLAIM_CONSUMED";
      if (administrator !== undefined) return "ADMINISTRATOR_EXISTS";
      if (claim.secretDigest !== input.secretDigest) return "CLAIM_INVALID";
      if (claim.expiresAt <= input.now) return "CLAIM_EXPIRED";
      administrator = Object.freeze({
        administratorId: input.administratorId,
        authEpoch: input.authEpoch,
        passwordAlgorithm: "argon2id" as const,
        passwordSalt: Uint8Array.from(input.passwordSalt),
        passwordNonce: Uint8Array.from(input.passwordNonce),
        passwordVerifier: Uint8Array.from(input.passwordVerifier),
        passwordMemoryCost: input.passwordMemoryCost,
        passwordTimeCost: input.passwordTimeCost,
        passwordParallelism: input.passwordParallelism,
        passwordNormalizationId: input.passwordNormalizationId,
      });
      claim = Object.freeze({ ...claim, consumedAt: input.now });
      return "CLAIMED";
    },
    async createSession(input) {
      sessions.set(input.tokenDigest, Object.freeze({ ...input }));
      return "CREATED";
    },
    async revokeSession(input) {
      const session = sessions.get(input.tokenDigest);
      if (session === undefined) return "NOT_FOUND";
      sessions.set(
        input.tokenDigest,
        Object.freeze({ ...session, revokedAt: input.revokedAt }),
      );
      return "REVOKED";
    },
  };
}

function serviceFixture(
  repository: ManagementRepository,
  state: { now?: () => Instant } = {},
) {
  return createAuthenticationWithRepository(
    {
      persistence: fakePersistence(),
      time: {
        now: state.now ?? (() => NOW),
        monotonicNow: () => 0n as never,
        elapsedSince: () => 0n as never,
      },
      runMutationActivity: async (_kind, operation) => operation(),
    },
    repository,
  );
}
describe("Management authentication", () => {
  it("supports claim, replay rejection, Argon2 login, session auth, and logout", async () => {
    const service = serviceFixture(repositoryFixture());
    const claim = await service.ensureFirstAdministratorClaim();
    expect(claim).toBeDefined();
    expect(Object.isFrozen(service)).toBe(true);
    const password = "management-password-012345";
    const claimed = await service.claimFirstAdministrator(
      claim!.claimId,
      claim!.claimSecret,
      password,
    );
    expect(claimed.administratorId).toMatch(/[0-9a-f-]{36}/u);
    await expect(
      service.claimFirstAdministrator(claim!.claimId, claim!.claimSecret, password),
    ).rejects.toMatchObject({
      problem: { problemCode: "management.first_claim_consumed" },
    });
    await expect(
      service.login("wrong-management-password-012345"),
    ).rejects.toMatchObject({
      problem: { problemCode: "management.invalid_credentials" },
    });
    const login = await service.login(password);
    expect(login.sessionToken).toHaveLength(43);
    await expect(service.authenticate(login.sessionToken)).resolves.toBeDefined();
    await expect(service.logout(login.sessionToken)).resolves.toBeUndefined();
    await expect(service.authenticate(login.sessionToken)).rejects.toMatchObject({
      problem: { problemCode: "management.session_revoked" },
    });
  });

  it("stores only the digest for a management secret", () => {
    expect(digestManagementSecret("secret")).toMatch(/^[0-9a-f]{64}$/u);
    expect(digestManagementSecret("secret")).not.toContain("secret");
  });

  it("replaces an expired canonical claim and rejects the old claim", async () => {
    let now = NOW;
    const service = serviceFixture(repositoryFixture(), { now: () => now });
    const first = (await service.ensureFirstAdministratorClaim())!;
    now = "2026-09-03T00:31:00.000Z" as Instant;
    const second = (await service.ensureFirstAdministratorClaim())!;
    expect(second.claimId).not.toBe(first.claimId);
    await expect(
      service.claimFirstAdministrator(
        first.claimId,
        first.claimSecret,
        "management-password-replacement-012345",
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "management.first_claim_invalid" },
    });
  });
});
