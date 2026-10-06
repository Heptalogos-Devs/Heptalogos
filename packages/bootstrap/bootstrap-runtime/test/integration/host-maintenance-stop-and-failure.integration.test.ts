// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { access } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import { BootstrapJournal, MaintenanceJournalStore } from "@heptalogos/bootstrap-state";
import type {
  BootstrapManagedHostContext,
  HostRuntimeRetirement,
} from "../../src/host/managed-host.js";
import { prepareBootstrapPrelude } from "../../src/bootstrap/prelude.js";
import type { ReadyPrivatePostgres } from "../../src/postgres/bootstrap.js";
import {
  assertReady,
  cleanupHostMaintenanceFixtures,
  connectBootstrapClient,
  findHostLeaseBackend,
  getToolchain,
  hostOwnershipSnapshot,
  HOST_TIMING,
  initializeCanonicalHost,
  LIFECYCLE,
  makeFixture,
  makeKeyProvider,
  maintenanceRetirement,
  postmasterPid,
  postmasterStartTime,
  qualifiedPgBin,
  stopPostgres,
  waitForHostLeaseLoss,
} from "../support/host-maintenance-fixture.js";

afterEach(cleanupHostMaintenanceFixtures);

describe("Host maintenance stop and failure PostgreSQL qualification", () => {
  it("continues normal bootstrap after successful stop maintenance", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const keyProvider = makeKeyProvider();
    const toolchain = await getToolchain();
    const port = 55526;
    let ready: ReadyPrivatePostgres | undefined;
    let host: BootstrapManagedHostContext | undefined;
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
      host = await owned.handoffPrivatePostgresToHost(ready, {
        initializeCanonicalHost,
        keyProvider,
        timing: HOST_TIMING,
      });

      const maintenance = await host.preparePrivatePostgresMaintenance({
        kind: "STOP_PRIVATE_POSTGRES",
      });
      await expect(maintenance.execute(maintenanceRetirement())).resolves.toEqual({
        kind: "STOPPED",
      });
      expect(host.state).toBe("CLOSED");

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

      const secondPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      secondOwned = await secondPrepared.acquireOwnership({ heartbeatMs: 1_000 });
      secondReady = await secondOwned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      expect(secondReady.clusterSystemIdentifier).toBe(expectedClusterSystemIdentifier);
      expect(secondReady.startupDisposition).toBe("STARTED_BY_THIS_BOOTSTRAP");
      await expect(assertReady(toolchain, port)).resolves.toBeUndefined();
      await secondReady.stop();
      secondReady = undefined;
      await secondOwned.close();
      secondOwned = undefined;
    } finally {
      if (host?.state === "ACTIVE") {
        await host
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

  it("keeps PostgreSQL running during managed shutdown and publishes a later fresh token", async () => {
    const fixture = await makeFixture();
    const firstPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const firstOwned = await firstPrepared.acquireOwnership({ heartbeatMs: 1_000 });
    const keyProvider = makeKeyProvider();
    const toolchain = await getToolchain();
    const port = 55523;
    let firstReady: ReadyPrivatePostgres | undefined;
    let hostA: BootstrapManagedHostContext | undefined;
    let secondOwned:
      Awaited<ReturnType<typeof firstPrepared.acquireOwnership>> | undefined;
    let secondReady: ReadyPrivatePostgres | undefined;
    let hostB: BootstrapManagedHostContext | undefined;

    try {
      firstReady = await firstOwned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        initialPort: port,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      hostA = await firstOwned.handoffPrivatePostgresToHost(firstReady, {
        initializeCanonicalHost,
        keyProvider,
        timing: HOST_TIMING,
      });
      const before = await hostOwnershipSnapshot(hostA, keyProvider, port);
      await hostA.shutdownKeepingPrivatePostgres(maintenanceRetirement());
      expect(hostA.state).toBe("CLOSED");
      await expect(assertReady(toolchain, port)).resolves.toBeUndefined();

      const historical = await hostOwnershipSnapshot(hostA, keyProvider, port);
      expect(historical.fence[0]?.host_ownership_token).toBe(
        before.fence[0]?.host_ownership_token,
      );

      const secondPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      secondOwned = await secondPrepared.acquireOwnership({ heartbeatMs: 1_000 });
      secondReady = await secondOwned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        lifecycle: LIFECYCLE,
        keyProvider,
      });
      expect(secondReady.startupDisposition).toBe("ALREADY_RUNNING");
      hostB = await secondOwned.handoffPrivatePostgresToHost(secondReady, {
        initializeCanonicalHost,
        keyProvider,
        timing: HOST_TIMING,
      });
      expect(hostB.state).toBe("ACTIVE");
      expect(hostB.token).not.toBe(before.fence[0]?.host_ownership_token);
      const after = await hostOwnershipSnapshot(hostB, keyProvider, port);
      expect(after.fence[0]?.ownership_revision).toBe(
        String(BigInt(before.fence[0]?.ownership_revision ?? "0") + 1n),
      );
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
      await secondReady?.stop().catch(() => undefined);
      await firstReady?.stop().catch(() => undefined);
      await stopPostgres(toolchain, join(fixture.roots.DATA, "private-postgres"));
      if (secondOwned !== undefined && secondOwned.ownershipState !== "RELEASED") {
        await secondOwned.close().catch(() => undefined);
      }
      if (firstOwned.ownershipState !== "RELEASED") {
        await firstOwned.close().catch(() => undefined);
      }
    }
  }, 180_000);

  it("fails closed when PostgreSQL terminates the dedicated Host lease during entry", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const keyProvider = makeKeyProvider();
    const toolchain = await getToolchain();
    const port = 55524;
    let ready: ReadyPrivatePostgres | undefined;
    let host: BootstrapManagedHostContext | undefined;
    let admin: Client | undefined;

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

      const beforeFence = await hostOwnershipSnapshot(host, keyProvider, port);
      const dataDirectory = join(fixture.roots.DATA, "private-postgres");
      const postmasterPidBefore = await postmasterPid(dataDirectory);
      admin = await connectBootstrapClient(host, keyProvider, port);
      const postmasterStartedBefore = await postmasterStartTime(admin);

      const retirement: HostRuntimeRetirement = {
        async retire() {
          const backendPid = await findHostLeaseBackend(
            admin as Client,
            host!.instanceId,
          );
          const terminated = await (admin as Client).query<{
            readonly terminated: boolean;
          }>("SELECT pg_terminate_backend($1::integer) AS terminated", [backendPid]);
          expect(terminated.rows[0]?.terminated).toBe(true);
          await waitForHostLeaseLoss(host as BootstrapManagedHostContext);
          await (admin as Client).end();
          admin = undefined;
        },
      };

      await expect(maintenance.execute(retirement)).rejects.toBeDefined();
      expect(maintenance.state).toBe("RECOVERY_REQUIRED");
      expect(() => host!.assertActive()).toThrow();
      expect(host!.state).toBe("CLOSED");
      await expect(assertReady(toolchain, port)).resolves.toBeUndefined();
      expect(await postmasterPid(dataDirectory)).toBe(postmasterPidBefore);
      admin = await connectBootstrapClient(host, keyProvider, port);
      await expect(postmasterStartTime(admin)).resolves.toBe(postmasterStartedBefore);

      const afterFence = await hostOwnershipSnapshot(host, keyProvider, port);
      expect(afterFence.fence[0]).toMatchObject({
        host_ownership_token: beforeFence.fence[0]?.host_ownership_token,
        ownership_revision: beforeFence.fence[0]?.ownership_revision,
      });
      const journal = await new MaintenanceJournalStore(fixture.roots.INSTANCE).load(
        maintenance.operationId,
      );
      expect(journal.status).toBe("CURRENT");
      if (journal.status !== "CURRENT") throw new Error("maintenance journal missing");
      expect(journal.value.state).toMatchObject({
        phase: "RECOVERY_REQUIRED",
      });

      await expect(prepareBootstrapPrelude(fixture.anchorRoot)).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.recovery.maintenance_required" },
      });
    } finally {
      await admin?.end().catch(() => undefined);
      await ready?.stop().catch(() => undefined);
      await stopPostgres(toolchain, join(fixture.roots.DATA, "private-postgres"));
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 180_000);

  it("stops and exits with a release-armed non-success journal", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const keyProvider = makeKeyProvider();
    const toolchain = await getToolchain();
    const port = 55521;
    let ready: ReadyPrivatePostgres | undefined;
    let host: BootstrapManagedHostContext | undefined;

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
      const preparedMaintenance = await host.preparePrivatePostgresMaintenance({
        kind: "STOP_PRIVATE_POSTGRES",
      });
      await expect(
        preparedMaintenance.execute(maintenanceRetirement()),
      ).resolves.toEqual({ kind: "STOPPED" });

      expect(host.state).toBe("CLOSED");
      await expect(
        access(join(fixture.roots.DATA, "private-postgres", "postmaster.pid")),
      ).rejects.toThrow();
      const journal = await new MaintenanceJournalStore(fixture.roots.INSTANCE).load(
        preparedMaintenance.operationId,
      );
      expect(journal.status).toBe("CURRENT");
      if (journal.status !== "CURRENT") throw new Error("maintenance journal missing");
      expect(journal.value.state).toMatchObject({
        phase: "SUCCEEDED",
        operationType: "PRIVATE_POSTGRES_STOP",
      });
      const bootstrapStages = await new BootstrapJournal(fixture.roots.INSTANCE).read(
        prepared.bootId,
      );
      expect(bootstrapStages.map((entry) => entry.stage)).toContain(
        "bootstrap.maintenance.completed",
      );
      expect(owned.ownershipState).toBe("RELEASED");
    } finally {
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
});
