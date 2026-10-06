// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { lineageContextRefSchema as canonicalLineageContextRefSchema } from "@heptalogos/execution-lineage";
import {
  createInstallationId,
  createInstanceId,
  createBootId,
  createContinuityEpochId,
  createUuidV7Id,
  type Instant,
} from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  lineageContextRefSchema,
  currentSystemActionCatalog,
  systemActionDefinitionSchema,
  systemActionExecuteResultSchema,
  systemChangePlanSchema,
  type SystemActionDefinition,
  type SystemActionExecuteResult,
  type SystemChangePlan,
} from "../../src/index.js";
import * as managementPublic from "../../src/index.js";
import type { FirstAdministratorClaim, ServerSession } from "../../src/contracts.js";
import { digestManagementSecret } from "../../src/password.js";
import type { ManagementRepository } from "../../src/repository.js";
import { createManagementServiceFromRepository } from "../../src/service.js";
import type { ManagementProductOwners } from "../../src/service.js";
import { systemActionCatalog } from "../../src/system-actions/catalog.js";

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
  state: {
    readonly now?: () => Instant;
    readonly runtimeKernelActive?: () => boolean;
    readonly managementServiceRunning?: () => boolean;
  } = {},
) {
  const installationId = createInstallationId();
  const instanceId = createInstanceId();
  const bootId = createBootId();
  const continuityEpochId = createContinuityEpochId();
  const productOwners = {
    configuration: {},
    secret: {},
    networkAccess: {},
    aiRuntime: {},
    subject: {
      getStatus: async () => {
        throw new Error("Subject owner is not used by this authentication fixture");
      },
      start: async () => {
        throw new Error("Subject owner is not used by this authentication fixture");
      },
      stop: async () => {
        throw new Error("Subject owner is not used by this authentication fixture");
      },
      reconcileRuntime: async () => undefined,
    },
  } as unknown as ManagementProductOwners;
  return createManagementServiceFromRepository(
    {
      installationId,
      instanceId,
      bootId,
      continuityEpochId,
      productGeneration: "a".repeat(64) as never,
      hostState: () => "ACTIVE",
      managementHttpState: () => "LISTENING",
      endpointDescriptorPublished: () => true,
      runtimeKernelActive: state.runtimeKernelActive ?? (() => true),
      managementServiceRunning: state.managementServiceRunning ?? (() => true),
      runtimeSnapshot: () => ({
        operatingMode: "NORMAL",
        desiredRevision: 1,
        systems: [],
        selectedServiceBindings: [],
        selectedCapabilityBindings: [],
      }),
      persistence: fakePersistence(),
      time: {
        now: state.now ?? (() => NOW),
        monotonicNow: () => 0n as never,
        elapsedSince: () => 0n as never,
      },
      productOwners,
      execution: {} as never,
      runReadActivity: async (_kind, operation) => operation(),
      runMutationActivity: async (_kind, operation) => operation(),
    },
    repository,
  );
}

describe("Management service", () => {
  it("keeps repository and password mechanics outside the package root", () => {
    expect(managementPublic).not.toHaveProperty("createManagementRepository");
    expect(managementPublic).not.toHaveProperty("digestManagementSecret");
    expect(managementPublic).not.toHaveProperty("hashAdministratorPassword");
    expect(managementPublic).toHaveProperty("systemActionDefinitionSchema");
  });

  it("reuses the canonical LineageContextRef type schema and validation bounds", () => {
    expect(lineageContextRefSchema).toBe(canonicalLineageContextRefSchema);
    const validate = compileSchema(lineageContextRefSchema);
    const base = {
      schemaVersion: 1,
      sourceActivityId: createUuidV7Id("ActivityId"),
      sourceInstanceId: createInstanceId(),
      sourceContinuityEpochId: createContinuityEpochId(),
    };
    expect(
      validate.validate({
        ...base,
        telemetry: { traceId: "trace", spanId: "span", traceFlags: 255 },
      }).ok,
    ).toBe(true);
    expect(
      validate.validate({
        ...base,
        telemetry: { traceId: "trace", spanId: "span", traceFlags: 256 },
      }).ok,
    ).toBe(false);
  });

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

  it("wraps reads and derives independent Runtime and Management readiness", async () => {
    let runtimeKernelActive = false;
    let managementServiceRunning = false;
    const service = serviceFixture(repositoryFixture(), {
      runtimeKernelActive: () => runtimeKernelActive,
      managementServiceRunning: () => managementServiceRunning,
    });
    await service.ensureFirstAdministratorClaim();
    expect((await service.getReadiness()).data).toMatchObject({
      runtimeKernelActive: false,
      managementServiceRunning: false,
      state: "NOT_READY",
    });
    runtimeKernelActive = true;
    expect((await service.getReadiness()).data).toMatchObject({
      runtimeKernelActive: true,
      managementServiceRunning: false,
      state: "NOT_READY",
    });
    managementServiceRunning = true;
    const readiness = await service.getReadiness();
    expect(readiness).toMatchObject({
      schemaVersion: 1,
      contractVersion: "management.v1",
      resource: { resourceKind: "management-readiness" },
      observedAt: NOW,
      productGeneration: "a".repeat(64),
      data: {
        runtimeKernelActive: true,
        managementServiceRunning: true,
        state: "READY",
      },
    });
    expect(readiness).not.toHaveProperty("lineageContextRef");
    expect((await service.getSystemStatus()).data.readiness.state).toBe("READY");
    expect(service.getHost().resource.resourceKind).toBe("host");
    expect(service.getRuntimeGraph().resource.resourceKind).toBe("runtime-graph");
    expect(service.getCapabilityGraph().resource.resourceKind).toBe("capability-graph");
  });

  it("publishes the frozen SystemAction types and the exact finite runtime catalog", () => {
    expect(
      currentSystemActionCatalog.map(({ actionId, riskClass, applyMode }) => [
        actionId,
        riskClass,
        applyMode,
      ]),
    ).toEqual([
      ["configuration.revision.create", "LOW", "IMMEDIATE"],
      ["configuration.activate", "MATERIAL", "RECONCILE"],
      ["secret.set", "MATERIAL", "RECONCILE"],
      ["secret.replace", "MATERIAL", "RECONCILE"],
      ["secret.revoke", "MATERIAL", "RECONCILE"],
      ["gateway-profile.set", "MATERIAL", "RECONCILE"],
      ["model-profile.set", "MATERIAL", "RECONCILE"],
      ["model-binding.set", "MATERIAL", "RECONCILE"],
      ["subject.start", "MATERIAL", "RECONCILE"],
      ["subject.stop", "MATERIAL", "RECONCILE"],
    ]);
    const action: SystemActionDefinition = {
      schemaVersion: 1,
      actionId: "configuration.activate" as SystemActionDefinition["actionId"],
      actionVersion: 1,
      inputSchema: { schemaVersion: 1, schemaId: "configuration.activate.input" },
      outputSchema: { schemaVersion: 1, schemaId: "configuration.activate.output" },
      targetKind: "configuration-revision",
      riskClass: "MATERIAL",
      applyMode: "RECONCILE",
    };
    const plan: SystemChangePlan = {
      schemaVersion: 1,
      planId: createUuidV7Id("SystemChangePlanId"),
      actionId: action.actionId,
      actionVersion: 1,
      normalizedInputDigest: "a".repeat(64) as SystemChangePlan["planDigest"],
      targetPreconditions: [],
      affectedSemanticOwners: [
        "system.configuration" as SystemChangePlan["affectedSemanticOwners"][number],
      ],
      configurationReadinessSubjectImpact: null,
      restartReconcileImpact: { reconcile: true },
      riskClass: "MATERIAL",
      planDigest: "b".repeat(64) as SystemChangePlan["planDigest"],
      createdAt: NOW,
      lineageContextRef: {
        schemaVersion: 1,
        sourceActivityId: createUuidV7Id("ActivityId"),
        sourceInstanceId: createInstanceId(),
        sourceContinuityEpochId: createContinuityEpochId(),
      },
    };
    const result: SystemActionExecuteResult<null> = {
      schemaVersion: 1,
      actionId: action.actionId,
      planDigest: plan.planDigest,
      result: null,
      postconditionsVerified: true,
      evidenceRefs: [],
    };
    expect(
      compileSchema<SystemActionDefinition>(systemActionDefinitionSchema).validate(
        action,
      ).ok,
    ).toBe(true);
    expect(
      compileSchema<SystemChangePlan>(systemChangePlanSchema).validate(plan).ok,
    ).toBe(true);
    expect(
      compileSchema<SystemActionExecuteResult<null>>(
        systemActionExecuteResultSchema,
      ).validate(result).ok,
    ).toBe(true);
    const staticIds = currentSystemActionCatalog.map((entry) => entry.actionId).sort();
    const runtimeIds = systemActionCatalog.handlers
      .flatMap((handler) => handler.actionIds)
      .sort();
    expect(runtimeIds).toEqual(staticIds);
    expect(new Set(runtimeIds).size).toBe(runtimeIds.length);
  });
});
