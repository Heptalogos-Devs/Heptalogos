// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BootstrapStateStore,
  MaintenanceJournalStore,
} from "@heptalogos/bootstrap-state";
import {
  resolvePrivatePostgresPlacement,
  validateExistingCluster,
} from "@heptalogos/private-postgres";
import type { BootstrapKeyRequestContext } from "../../src/bootstrap/key-provider.js";
import { acquireBootstrapOwnership } from "../../src/bootstrap/ownership.js";
import { prepareBootstrapPrelude } from "../../src/bootstrap/prelude.js";
import type { ReadyPrivatePostgres } from "../../src/postgres/bootstrap.js";
import type { BootstrapManagedHostContext } from "../../src/host/managed-host.js";
import {
  assertReady,
  cleanupHostMaintenanceFixtures,
  connectBootstrapClient,
  getToolchain,
  hostOwnershipSnapshot,
  HOST_TIMING,
  initializeCanonicalHost,
  LIFECYCLE,
  makeFixture,
  makeKeyProvider,
  maintenanceRetirement,
  postmasterStartTime,
  qualifiedPgBin,
  stopPostgres,
} from "../support/host-maintenance-fixture.js";

afterEach(() => vi.restoreAllMocks());
afterEach(cleanupHostMaintenanceFixtures);

describe("Host maintenance restart and pre-entry PostgreSQL qualification", () => {
  it("restarts the same cluster and publishes a fresh Host token", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const runtimeRequests: BootstrapKeyRequestContext[] = [];
    const keyProvider = makeKeyProvider((context) => {
      if (context.purpose === "private-postgres-runtime-role") {
        runtimeRequests.push(context);
      }
    });
    const toolchain = await getToolchain();
    const port = 55520;
    let ready: ReadyPrivatePostgres | undefined;
    let hostA: BootstrapManagedHostContext | undefined;
    let hostB: BootstrapManagedHostContext | undefined;

    try {
      ready = await owned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        initialPort: port,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      const activeHostA = await owned.handoffPrivatePostgresToHost(ready, {
        initializeCanonicalHost,
        keyProvider,
        timing: HOST_TIMING,
      });
      hostA = activeHostA;
      const before = await hostOwnershipSnapshot(activeHostA, keyProvider, ready.port);
      const preparedMaintenance = await activeHostA.preparePrivatePostgresMaintenance({
        kind: "RESTART_PRIVATE_POSTGRES",
      });
      const originalAdvance = Object.getOwnPropertyDescriptor(
        MaintenanceJournalStore.prototype,
        "advance",
      )?.value as MaintenanceJournalStore["advance"] | undefined;
      if (originalAdvance === undefined) {
        throw new Error("journal advance implementation is not callable");
      }
      const advanceSpy = vi.spyOn(MaintenanceJournalStore.prototype, "advance");
      advanceSpy.mockImplementationOnce(async function (
        this: MaintenanceJournalStore,
        body,
      ) {
        await originalAdvance.call(this, body);
        throw new Error("EXECUTING publication acknowledgement failed");
      });

      const result = await preparedMaintenance.execute({
        async retire() {
          const entered = await new MaintenanceJournalStore(
            fixture.roots.INSTANCE,
          ).load(preparedMaintenance.operationId);
          expect(entered).toMatchObject({
            status: "CURRENT",
            value: { state: { phase: "EXECUTING" } },
          });
          await expect(preparedMaintenance.abortBeforeExecute()).rejects.toMatchObject({
            problem: { problemCode: "bootstrap.maintenance.abort_after_entry" },
          });
        },
      });
      expect(result.kind).toBe("RESTARTED");
      if (result.kind !== "RESTARTED") throw new Error("restart result missing Host");
      const activeHostB = result.host;
      hostB = activeHostB;

      expect(activeHostA.state).toBe("CLOSED");
      expect(() => activeHostA.assertActive()).toThrow();
      expect(activeHostB.state).toBe("ACTIVE");
      expect(activeHostB.bootId).not.toBe(activeHostA.bootId);
      expect(activeHostB.token).not.toBe(activeHostA.token);
      expect(activeHostB.continuityEpochId).toBe(activeHostA.continuityEpochId);
      expect(activeHostB.persistence.continuityEpochId).toBe(
        activeHostA.persistence.continuityEpochId,
      );
      await activeHostB.persistence.withRuntimeDatabasePassword(async () => undefined);
      expect(runtimeRequests.at(-1)?.bootId).toBe(activeHostB.bootId);
      expect(runtimeRequests.at(-1)?.bootId).not.toBe(activeHostA.bootId);
      await expect(assertReady(toolchain, ready.port)).resolves.toBeUndefined();

      const persisted = await new BootstrapStateStore(
        join(fixture.roots.INSTANCE, "bootstrap-state"),
      ).load();
      expect(persisted.status).toBe("CURRENT");
      if (persisted.status !== "CURRENT" || persisted.value.state.schemaVersion !== 1) {
        throw new Error("canonical private PostgreSQL state was not persisted");
      }
      const persistedPostgres = persisted.value.state.privatePostgres;
      if (persistedPostgres === undefined || persistedPostgres.schemaVersion !== 1) {
        throw new Error("canonical private PostgreSQL identity was not persisted");
      }
      expect(persisted.value.state.lastCommittedOperationRef).toBe(
        `maintenance-journal/v1/${preparedMaintenance.operationId}`,
      );
      expect(persistedPostgres.clusterSystemIdentifier).toBe(
        ready.clusterSystemIdentifier,
      );
      expect(persistedPostgres.persistedPort).toBe(ready.port);
      const validated = await validateExistingCluster({
        toolchain,
        placement: resolvePrivatePostgresPlacement(fixture.roots.DATA),
        expectedIdentity: {
          installationId: persistedPostgres.installationId,
          instanceId: persistedPostgres.instanceId,
          postgresMajor: persistedPostgres.postgresMajor,
          bootstrapRoleName: persistedPostgres.bootstrapRoleName,
          placement: persistedPostgres.dataPlacement,
          persistedPort: persistedPostgres.persistedPort,
          clusterSystemIdentifier: persistedPostgres.clusterSystemIdentifier,
          initializationProfileRevision:
            persistedPostgres.initializationProfileRevision,
        },
        timeoutMs: LIFECYCLE.startupTimeoutMs,
      });
      expect(validated.identity.clusterSystemIdentifier).toBe(
        ready.clusterSystemIdentifier,
      );
      expect(validated.port).toBe(ready.port);

      const after = await hostOwnershipSnapshot(activeHostB, keyProvider, ready.port);
      expect(after.fence).toHaveLength(1);
      expect(after.fence[0]).toMatchObject({
        instance_id: activeHostB.instanceId,
        host_ownership_token: activeHostB.token,
        boot_id: activeHostB.bootId,
        ownership_revision: String(BigInt(before.fence[0].ownership_revision) + 2n),
      });

      const journal = await new MaintenanceJournalStore(fixture.roots.INSTANCE).load(
        preparedMaintenance.operationId,
      );
      expect(journal.status).toBe("CURRENT");
      if (journal.status !== "CURRENT") throw new Error("maintenance journal missing");
      expect(journal.value.state).toMatchObject({
        phase: "SUCCEEDED",
        operationType: "PRIVATE_POSTGRES_RESTART",
        target: { privatePostgres: "RUNNING_SAME_IDENTITY" },
      });
      expect(owned.ownershipState).toBe("RELEASED");
    } finally {
      if (hostB?.state === "ACTIVE") {
        await hostB
          .shutdownKeepingPrivatePostgres(maintenanceRetirement())
          .catch(() => undefined);
      }
      if (hostA?.state === "ACTIVE") {
        await hostA
          .shutdownKeepingPrivatePostgres(maintenanceRetirement())
          .catch(() => undefined);
      }
      await ready?.stop().catch(() => undefined);
      await stopPostgres(toolchain, join(fixture.roots.DATA, "private-postgres"));
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 180_000);

  it("keeps a failed pre-entry publication abortable when current truth is PREPARED", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const keyProvider = makeKeyProvider();
    const toolchain = await getToolchain();
    const port = 55527;
    let ready: ReadyPrivatePostgres | undefined;
    let host: BootstrapManagedHostContext | undefined;
    let followupOwned:
      Awaited<ReturnType<typeof prepared.acquireOwnership>> | undefined;

    try {
      ready = await owned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        initialPort: port,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      host = await owned.handoffPrivatePostgresToHost(ready, {
        initializeCanonicalHost,
        keyProvider,
        timing: HOST_TIMING,
      });
      const maintenance = await host.preparePrivatePostgresMaintenance({
        kind: "RESTART_PRIVATE_POSTGRES",
      });
      const readStartTime = async (): Promise<string> => {
        const client = await connectBootstrapClient(
          host as BootstrapManagedHostContext,
          keyProvider,
          port,
        );
        try {
          return await postmasterStartTime(client);
        } finally {
          await client.end();
        }
      };
      const beforeStartTime = await readStartTime();
      const entryFailure = new Error("EXECUTING publication failed before commit");
      vi.spyOn(MaintenanceJournalStore.prototype, "advance").mockImplementationOnce(
        async () => {
          throw entryFailure;
        },
      );
      let retirementCalls = 0;

      await expect(
        maintenance.execute({
          async retire() {
            retirementCalls += 1;
          },
        }),
      ).rejects.toBe(entryFailure);
      expect(retirementCalls).toBe(0);
      expect(maintenance.state).toBe("PREPARED");
      await expect(readStartTime()).resolves.toBe(beforeStartTime);
      await expect(assertReady(toolchain, port)).resolves.toBeUndefined();

      const afterFailure = await new MaintenanceJournalStore(
        fixture.roots.INSTANCE,
      ).load(maintenance.operationId);
      expect(afterFailure).toMatchObject({
        status: "CURRENT",
        value: { state: { phase: "PREPARED" } },
      });

      await expect(maintenance.abortBeforeExecute()).resolves.toBeUndefined();
      expect(maintenance.state).toBe("ABORTED");
      const afterAbort = await new MaintenanceJournalStore(fixture.roots.INSTANCE).load(
        maintenance.operationId,
      );
      expect(afterAbort).toMatchObject({
        status: "CURRENT",
        value: { state: { phase: "ABORTED" } },
      });

      const followupPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      followupOwned = await followupPrepared.acquireOwnership({ heartbeatMs: 1_000 });
    } finally {
      await followupOwned?.close().catch(() => undefined);
      if (host?.state === "ACTIVE") {
        await host
          .shutdownKeepingPrivatePostgres(maintenanceRetirement())
          .catch(() => undefined);
      }
      await ready?.stop().catch(() => undefined);
      await stopPostgres(toolchain, join(fixture.roots.DATA, "private-postgres"));
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 180_000);

  it("fails closed when execution entry truth is unprovable", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const keyProvider = makeKeyProvider();
    const toolchain = await getToolchain();
    const port = 55529;
    let ready: ReadyPrivatePostgres | undefined;
    let host: BootstrapManagedHostContext | undefined;
    let followupLease:
      Awaited<ReturnType<typeof acquireBootstrapOwnership>> | undefined;

    try {
      ready = await owned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        initialPort: port,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      host = await owned.handoffPrivatePostgresToHost(ready, {
        initializeCanonicalHost,
        keyProvider,
        timing: HOST_TIMING,
      });
      const maintenance = await host.preparePrivatePostgresMaintenance({
        kind: "RESTART_PRIVATE_POSTGRES",
      });
      const entryFailure = new Error("EXECUTING publication outcome is unknown");
      vi.spyOn(MaintenanceJournalStore.prototype, "advance").mockImplementationOnce(
        async () => {
          throw entryFailure;
        },
      );
      vi.spyOn(MaintenanceJournalStore.prototype, "load").mockImplementationOnce(
        async () => {
          throw new Error("maintenance journal reread failed");
        },
      );
      let retirementCalls = 0;

      const executionPromise = maintenance.execute({
        async retire() {
          retirementCalls += 1;
        },
      });
      const executionError = await executionPromise.then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(executionError).toMatchObject({
        problem: { problemCode: "bootstrap.maintenance.execution_entry_unproven" },
      });
      expect(retirementCalls).toBe(0);

      let stateError: unknown;
      try {
        void maintenance.state;
      } catch (error) {
        stateError = error;
      }
      expect(stateError).toBe(executionError);

      let abortError: unknown;
      try {
        await maintenance.abortBeforeExecute();
      } catch (error) {
        abortError = error;
      }
      expect(abortError).toBe(executionError);

      const retryPromise = maintenance.execute({
        async retire() {
          retirementCalls += 1;
        },
      });
      expect(retryPromise).toBe(executionPromise);
      await expect(retryPromise).rejects.toBe(executionError);
      expect(retirementCalls).toBe(0);

      followupLease = await acquireBootstrapOwnership(
        prepared.paths.resolve("INSTANCE"),
        {
          heartbeatMs: 1_000,
          bootId: prepared.bootId,
        },
      );
    } finally {
      await followupLease?.release().catch(() => undefined);
      if (host?.state === "ACTIVE") {
        await host
          .shutdownKeepingPrivatePostgres(maintenanceRetirement())
          .catch(() => undefined);
      }
      await ready?.stop().catch(() => undefined);
      await stopPostgres(toolchain, join(fixture.roots.DATA, "private-postgres"));
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 180_000);

  it("keeps a Host-inactive preflight failure abortable without touching PostgreSQL", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const keyProvider = makeKeyProvider();
    const toolchain = await getToolchain();
    const port = 55528;
    let ready: ReadyPrivatePostgres | undefined;
    let host: BootstrapManagedHostContext | undefined;
    let followupOwned:
      Awaited<ReturnType<typeof prepared.acquireOwnership>> | undefined;

    try {
      ready = await owned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        initialPort: port,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      host = await owned.handoffPrivatePostgresToHost(ready, {
        initializeCanonicalHost,
        keyProvider,
        timing: HOST_TIMING,
      });
      const maintenance = await host.preparePrivatePostgresMaintenance({
        kind: "RESTART_PRIVATE_POSTGRES",
      });
      const readStartTime = async (): Promise<string> => {
        const client = await connectBootstrapClient(
          host as BootstrapManagedHostContext,
          keyProvider,
          port,
        );
        try {
          return await postmasterStartTime(client);
        } finally {
          await client.end();
        }
      };
      const beforeStartTime = await readStartTime();
      await host.shutdownKeepingPrivatePostgres(maintenanceRetirement());

      let retirementCalls = 0;
      await expect(
        maintenance.execute({
          async retire() {
            retirementCalls += 1;
          },
        }),
      ).rejects.toBeDefined();
      expect(retirementCalls).toBe(0);
      expect(maintenance.state).toBe("PREPARED");
      await expect(readStartTime()).resolves.toBe(beforeStartTime);
      await expect(assertReady(toolchain, port)).resolves.toBeUndefined();

      const journal = await new MaintenanceJournalStore(fixture.roots.INSTANCE).load(
        maintenance.operationId,
      );
      expect(journal).toMatchObject({
        status: "CURRENT",
        value: { state: { phase: "PREPARED" } },
      });

      await expect(maintenance.abortBeforeExecute()).resolves.toBeUndefined();
      expect(maintenance.state).toBe("ABORTED");
      const followupPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      followupOwned = await followupPrepared.acquireOwnership({ heartbeatMs: 1_000 });
    } finally {
      await followupOwned?.close().catch(() => undefined);
      await ready?.stop().catch(() => undefined);
      await stopPostgres(toolchain, join(fixture.roots.DATA, "private-postgres"));
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 180_000);

  it("continues normal bootstrap after successful restart maintenance", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const keyProvider = makeKeyProvider();
    const toolchain = await getToolchain();
    const port = 55525;
    let ready: ReadyPrivatePostgres | undefined;
    let hostA: BootstrapManagedHostContext | undefined;
    let hostB: BootstrapManagedHostContext | undefined;
    let hostC: BootstrapManagedHostContext | undefined;
    let secondOwned: Awaited<ReturnType<typeof prepared.acquireOwnership>> | undefined;
    let secondReady: ReadyPrivatePostgres | undefined;

    try {
      ready = await owned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        initialPort: port,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      const expectedClusterSystemIdentifier = ready.clusterSystemIdentifier;
      hostA = await owned.handoffPrivatePostgresToHost(ready, {
        initializeCanonicalHost,
        keyProvider,
        timing: HOST_TIMING,
      });

      const maintenance = await hostA.preparePrivatePostgresMaintenance({
        kind: "RESTART_PRIVATE_POSTGRES",
      });
      const result = await maintenance.execute(maintenanceRetirement());
      expect(result.kind).toBe("RESTARTED");
      if (result.kind !== "RESTARTED") throw new Error("restart result missing Host");
      hostB = result.host;

      expect(hostA.state).toBe("CLOSED");
      expect(hostB.state).toBe("ACTIVE");
      await expect(assertReady(toolchain, port)).resolves.toBeUndefined();

      const journal = await new MaintenanceJournalStore(fixture.roots.INSTANCE).load(
        maintenance.operationId,
      );
      expect(journal).toMatchObject({
        status: "CURRENT",
        value: {
          state: {
            phase: "SUCCEEDED",
          },
        },
      });

      await hostB.shutdownKeepingPrivatePostgres(maintenanceRetirement());
      expect(hostB.state).toBe("CLOSED");

      const secondPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      secondOwned = await secondPrepared.acquireOwnership({ heartbeatMs: 1_000 });
      secondReady = await secondOwned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      expect(secondReady.clusterSystemIdentifier).toBe(expectedClusterSystemIdentifier);
      expect(secondReady.startupDisposition).toBe("ALREADY_RUNNING");
      await expect(assertReady(toolchain, port)).resolves.toBeUndefined();

      hostC = await secondOwned.handoffPrivatePostgresToHost(secondReady, {
        initializeCanonicalHost,
        keyProvider,
        timing: HOST_TIMING,
      });
      const stop = await hostC.preparePrivatePostgresMaintenance({
        kind: "STOP_PRIVATE_POSTGRES",
      });
      await expect(stop.execute(maintenanceRetirement())).resolves.toEqual({
        kind: "STOPPED",
      });
      expect(hostC.state).toBe("CLOSED");
    } finally {
      if (hostC?.state === "ACTIVE") {
        await hostC
          .shutdownKeepingPrivatePostgres(maintenanceRetirement())
          .catch(() => undefined);
      }
      if (hostB?.state === "ACTIVE") {
        await hostB
          .shutdownKeepingPrivatePostgres(maintenanceRetirement())
          .catch(() => undefined);
      }
      if (hostA?.state === "ACTIVE") {
        await hostA
          .shutdownKeepingPrivatePostgres(maintenanceRetirement())
          .catch(() => undefined);
      }
      await secondReady?.stop().catch(() => undefined);
      await ready?.stop().catch(() => undefined);
      await stopPostgres(toolchain, join(fixture.roots.DATA, "private-postgres"));
      if (secondOwned !== undefined && secondOwned.ownershipState !== "RELEASED") {
        await secondOwned.close().catch(() => undefined);
      }
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 180_000);

  it("blocks a competing bootstrap before lock acquisition when maintenance is incomplete", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const keyProvider = makeKeyProvider();
    const toolchain = await getToolchain();
    const port = 55522;
    let ready: ReadyPrivatePostgres | undefined;
    let host: BootstrapManagedHostContext | undefined;
    let maintenance:
      | Awaited<
          ReturnType<BootstrapManagedHostContext["preparePrivatePostgresMaintenance"]>
        >
      | undefined;
    let postOwned: Awaited<ReturnType<typeof prepared.acquireOwnership>> | undefined;
    let postReady: ReadyPrivatePostgres | undefined;

    try {
      ready = await owned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        initialPort: port,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      host = await owned.handoffPrivatePostgresToHost(ready, {
        initializeCanonicalHost,
        keyProvider,
        timing: HOST_TIMING,
      });
      maintenance = await host.preparePrivatePostgresMaintenance({
        kind: "RESTART_PRIVATE_POSTGRES",
      });

      await expect(prepareBootstrapPrelude(fixture.anchorRoot)).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.recovery.maintenance_required" },
      });
      expect(host.state).toBe("ACTIVE");
      await expect(assertReady(toolchain, ready.port)).resolves.toBeUndefined();

      await maintenance.abortBeforeExecute();
      expect(maintenance.state).toBe("ABORTED");
      expect(host.state).toBe("ACTIVE");

      const postPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      postOwned = await postPrepared.acquireOwnership({ heartbeatMs: 1_000 });
      postReady = await postOwned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      expect(postReady.startupDisposition).toBe("ALREADY_RUNNING");
      await expect(
        postOwned.handoffPrivatePostgresToHost(postReady, {
          initializeCanonicalHost,
          keyProvider,
          timing: HOST_TIMING,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.host.existing_owner_detected" },
      });
      expect(host.state).toBe("ACTIVE");
    } finally {
      if (host?.state === "ACTIVE") {
        await host
          .shutdownKeepingPrivatePostgres(maintenanceRetirement())
          .catch(() => undefined);
      }
      await postReady?.stop().catch(() => undefined);
      if (postOwned !== undefined && postOwned.ownershipState !== "RELEASED") {
        await postOwned.close().catch(() => undefined);
      }
      await ready?.stop().catch(() => undefined);
      await stopPostgres(toolchain, join(fixture.roots.DATA, "private-postgres"));
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 180_000);
});
