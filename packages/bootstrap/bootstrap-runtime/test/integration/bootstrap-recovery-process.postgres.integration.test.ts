// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  BootstrapStateStore,
  MaintenanceJournalStore,
  type BootstrapStateBodyV1,
  type MaintenanceJournalBodyV1,
} from "@heptalogos/bootstrap-state";
import {
  asContentDigest,
  createBootId,
  createInstallationId,
  createInstanceId,
  digestCanonicalJson,
  LIFECYCLE_ROOT_IDS,
  type LifecycleRootId,
} from "@heptalogos/foundation-contracts";
import {
  resolvePrivatePostgresPlacement,
  resolvePrivatePostgresToolchain,
  type PrivatePostgresToolchain,
} from "@heptalogos/private-postgres";
import { loadBootstrapLocator } from "../../src/bootstrap/locator.js";
import { proveLocalInstallationOwner } from "../../src/bootstrap/local-installation-owner.js";
import { prepareBootstrapPrelude } from "../../src/bootstrap/prelude.js";
import { resolveBootstrapPathProfile } from "../../src/bootstrap/roots.js";
import { recoverInterruptedHostMaintenance } from "../../src/maintenance/recovery.js";
import type {
  PrivatePostgresMaintenanceDescriptor,
  ReadyPrivatePostgres,
} from "../../src/postgres/bootstrap.js";
import type { BootstrapManagedHostContext } from "../../src/host/managed-host.js";

const qualifiedPgBin =
  process.env.HEPTALOGOS_TEST_PG_BIN ??
  (() => {
    throw new Error(
      "BLOCKED: HEPTALOGOS_TEST_PG_BIN is required for real Bootstrap Recovery process qualification",
    );
  })();
const PROCESS_FIXTURE = fileURLToPath(
  new URL("../support/fixtures/recovery-maintenance-process.mjs", import.meta.url),
);
const LOCK_DIRECTORY = ".heptalogos-bootstrap.lock";
const directories: string[] = [];
const LIFECYCLE = {
  startupTimeoutMs: 60_000,
  shutdownTimeoutMs: 30_000,
  readinessPollIntervalMs: 100,
} as const;
const HOST_TIMING = {
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  fenceLockTimeoutMs: 10_000,
  keepAliveInitialDelayMs: 1_000,
} as const;

type ChildMessage = {
  readonly type: string;
  readonly operationId?: string;
  readonly phase?: string;
  readonly kind?: string;
  readonly problemCode?: string;
  readonly message?: string;
  readonly sourceToken?: string;
  readonly clusterSystemIdentifier?: string;
};

class RealProcessController {
  readonly process: ChildProcess;
  #messages: ChildMessage[] = [];
  #waiters: Array<{
    readonly types: ReadonlySet<string>;
    readonly resolve: (message: ChildMessage) => void;
    readonly reject: (error: Error) => void;
    readonly timer: NodeJS.Timeout;
  }> = [];

  constructor(anchorRoot: string, role: string, args: readonly string[] = []) {
    this.process = spawn(
      process.execPath,
      [PROCESS_FIXTURE, anchorRoot, role, ...args],
      { stdio: ["ignore", "ignore", "ignore", "ipc"], env: process.env },
    );
    this.process.on("message", (message: ChildMessage) => {
      const index = this.#waiters.findIndex((waiter) => waiter.types.has(message.type));
      if (index < 0) {
        this.#messages.push(message);
        return;
      }
      const [waiter] = this.#waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    });
  }

  waitFor(...types: string[]): Promise<ChildMessage> {
    const index = this.#messages.findIndex((message) => types.includes(message.type));
    if (index >= 0) return Promise.resolve(this.#messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.#waiters.findIndex((waiter) => waiter.timer === timer);
        if (waiterIndex >= 0) this.#waiters.splice(waiterIndex, 1);
        reject(new Error(`Timed out waiting for ${types.join(" or ")}`));
      }, 120_000);
      this.#waiters.push({ types: new Set(types), resolve, reject, timer });
    });
  }

  async kill(): Promise<void> {
    if (this.process.exitCode === null && this.process.signalCode === null) {
      this.process.kill("SIGKILL");
    }
    await Promise.race([
      once(this.process, "exit").then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }

  send(message: object): void {
    if (!this.process.connected) return;
    try {
      this.process.send?.(message);
    } catch {
      // The child may have been terminated after durable evidence was read.
    }
  }
}

function initialState(): BootstrapStateBodyV1 {
  return {
    schemaVersion: 1,
    revision: 1,
    activeBootstrapRuntimeGeneration: asContentDigest(
      "BootstrapRuntimeGenerationId",
      digestCanonicalJson("test.bootstrap-runtime/v1", { generation: "bootstrap" }),
    ),
    activeProductGeneration: asContentDigest(
      "ProductGenerationId",
      digestCanonicalJson("test.product-generation/v1", { generation: "product" }),
    ),
    continuityEpochId:
      "0197cfe0-0000-7000-8000-000000000001" as BootstrapStateBodyV1["continuityEpochId"],
  };
}

async function makeFixture(): Promise<{
  readonly anchorRoot: string;
  readonly roots: Readonly<Record<LifecycleRootId, string>>;
  readonly installationId: ReturnType<typeof createInstallationId>;
  readonly instanceId: ReturnType<typeof createInstanceId>;
}> {
  const anchorRoot = await mkdtemp(
    join(tmpdir(), "heptalogos-bootstrap-recovery-real-process-anchor-"),
  );
  directories.push(anchorRoot);
  const roots = {} as Record<LifecycleRootId, string>;
  for (const id of LIFECYCLE_ROOT_IDS) {
    roots[id] =
      id === "PROGRAM"
        ? anchorRoot
        : await mkdtemp(
            join(
              tmpdir(),
              `heptalogos-bootstrap-recovery-real-process-${id.toLowerCase()}-`,
            ),
          );
    if (id !== "PROGRAM") directories.push(roots[id]);
  }
  const installationId = createInstallationId();
  const instanceId = createInstanceId();
  await writeFile(
    join(anchorRoot, "heptalogos.bootstrap.json"),
    JSON.stringify({ schemaVersion: 1, installationId, instanceId, roots }),
  );
  await new BootstrapStateStore(join(roots.INSTANCE, "bootstrap-state")).commit(
    initialState(),
  );
  return { anchorRoot, roots, installationId, instanceId };
}

function makeKeyProvider() {
  return {
    async withPrivatePostgresBootstrapPassword<T>(
      _context: unknown,
      use: (password: Uint8Array) => Promise<T>,
    ): Promise<T> {
      const password = new TextEncoder().encode(
        "BOOTSTRAP_RECOVERY_TEST_BOOTSTRAP_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresHostLeasePassword<T>(
      _context: unknown,
      use: (password: Uint8Array) => Promise<T>,
    ): Promise<T> {
      const password = new TextEncoder().encode(
        "BOOTSTRAP_RECOVERY_TEST_HOST_LEASE_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresRuntimePassword<T>(
      _context: unknown,
      use: (password: Uint8Array) => Promise<T>,
    ): Promise<T> {
      const password = new TextEncoder().encode(
        "BOOTSTRAP_RECOVERY_TEST_RUNTIME_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresMigrationPassword<T>(
      _context: unknown,
      use: (password: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(
        new TextEncoder().encode(
          "BOOTSTRAP_RECOVERY_TEST_MIGRATION_PASSWORD_0123456789",
        ),
      );
    },
    async withPrivatePostgresDurableExecutionPassword<T>(
      _context: unknown,
      use: (password: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(
        new TextEncoder().encode(
          "BOOTSTRAP_RECOVERY_TEST_DURABLE_EXECUTION_PASSWORD_0123456789",
        ),
      );
    },
  };
}

async function waitForChildDurablePhase(
  child: RealProcessController,
  instanceRoot: string,
  operationId: MaintenanceJournalBodyV1["operationId"],
  phase: MaintenanceJournalBodyV1["phase"],
): Promise<MaintenanceJournalBodyV1> {
  const signal = await child.waitFor("durable-phase", "error");
  if (signal.type === "error") {
    throw new Error(signal.message ?? signal.problemCode ?? "process child failed");
  }
  expect(signal.operationId).toBe(operationId);
  expect(signal.phase).toBe(phase);
  await child.kill();

  const journal = new MaintenanceJournalStore(instanceRoot);
  const loaded = await journal.load(operationId);
  if (loaded.status !== "CURRENT") {
    throw new Error(
      loaded.status === "CORRUPT"
        ? loaded.problem.detail
        : `MaintenanceJournal was ${loaded.status} at child barrier`,
    );
  }
  expect(loaded.value.state.operationId).toBe(operationId);
  expect(loaded.value.state.phase).toBe(phase);
  return loaded.value.state;
}

async function markBootstrapLockStale(instanceRoot: string): Promise<void> {
  const lockPath = join(instanceRoot, LOCK_DIRECTORY);
  await mkdir(lockPath, { recursive: true });
  const staleAt = new Date(Date.now() - 31_000);
  await utimes(lockPath, staleAt, staleAt);
}

async function buildDescriptor(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  port: number,
): Promise<PrivatePostgresMaintenanceDescriptor> {
  const locator = await loadBootstrapLocator(fixture.anchorRoot);
  const profile = await resolveBootstrapPathProfile(locator, [
    "INSTANCE",
    "DATA",
    "LOG",
  ]);
  const loaded = await new BootstrapStateStore(
    join(profile.resolve("INSTANCE").canonicalPath, "bootstrap-state"),
  ).load();
  if (loaded.status !== "CURRENT" || loaded.value.state.schemaVersion !== 1) {
    throw new Error("real process fixture did not persist BootstrapState V1");
  }
  const persisted = loaded.value.state.privatePostgres;
  if (persisted === undefined || persisted.schemaVersion !== 1) {
    throw new Error("real process fixture did not persist private PostgreSQL state");
  }
  const toolchain = await resolvePrivatePostgresToolchain(qualifiedPgBin);
  const placement = resolvePrivatePostgresPlacement(
    profile.resolve("DATA").canonicalPath,
  );
  return {
    toolchain,
    placement,
    expectedIdentity: {
      installationId: persisted.installationId,
      instanceId: persisted.instanceId,
      postgresMajor: persisted.postgresMajor,
      bootstrapRoleName: persisted.bootstrapRoleName,
      placement: persisted.dataPlacement,
      persistedPort: port,
      clusterSystemIdentifier: persisted.clusterSystemIdentifier,
      initializationProfileRevision: persisted.initializationProfileRevision,
    },
    logFilePath: join(profile.resolve("LOG").canonicalPath, "private-postgres.log"),
    lifecycle: LIFECYCLE,
  };
}

async function clusterIdentity(
  toolchain: PrivatePostgresToolchain,
  dataDirectory: string,
) {
  const { stdout } = await new Promise<{ readonly stdout: string }>(
    (resolve, reject) => {
      const child = spawn(toolchain.pgControldata, ["--pgdata", dataDirectory], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code !== 0) reject(new Error(`pg_controldata exited ${code}`));
        else resolve({ stdout });
      });
    },
  );
  const value = stdout.match(/Database system identifier:\s+(\d+)/u)?.[1];
  if (value === undefined)
    throw new Error("pg_controldata did not expose cluster identity");
  return value;
}

async function postmasterStartTime(
  fixture: Awaited<ReturnType<typeof makeFixture>>,
  port: number,
): Promise<string> {
  let client: Client | undefined;
  const provider = makeKeyProvider();
  await provider.withPrivatePostgresBootstrapPassword(
    {
      installationId: fixture.installationId,
      instanceId: fixture.instanceId,
      bootId: createBootId(),
      purpose: "private-postgres-bootstrap-superuser",
    },
    async (passwordUtf8) => {
      client = new Client({
        host: "127.0.0.1",
        port,
        database: "heptalogos",
        user: "heptalogos_bootstrap",
        password: new TextDecoder().decode(passwordUtf8),
        connectionTimeoutMillis: 10_000,
      });
      await client.connect();
    },
  );
  const connected = client;
  if (connected === undefined)
    throw new Error("bootstrap admin client was not connected");
  try {
    const result = await connected.query<{ readonly started_at: string }>(
      "SELECT pg_postmaster_start_time()::text AS started_at",
    );
    const startedAt = result.rows[0]?.started_at;
    if (startedAt === undefined)
      throw new Error("postmaster start time was not returned");
    return startedAt;
  } finally {
    await connected.end();
  }
}

async function stopPostgres(
  toolchain: PrivatePostgresToolchain,
  dataDirectory: string,
) {
  try {
    await access(dataDirectory);
  } catch {
    return;
  }
  await new Promise<void>((resolve) => {
    const child = spawn(
      toolchain.pgCtl,
      ["stop", "--pgdata", dataDirectory, "--mode=fast", "--wait", "--timeout", "60"],
      { stdio: "ignore" },
    );
    child.once("exit", () => resolve());
    child.once("error", () => resolve());
  });
}

afterEach(async () => {
  const toolchain = await resolvePrivatePostgresToolchain(qualifiedPgBin);
  const cleanupDirectories = directories.splice(0);
  for (const directory of cleanupDirectories) {
    try {
      const locator = await loadBootstrapLocator(directory);
      const profile = await resolveBootstrapPathProfile(locator, ["INSTANCE", "DATA"]);
      await stopPostgres(
        toolchain,
        join(profile.resolve("DATA").canonicalPath, "private-postgres"),
      );
    } catch {
      // The child may have died before it completed locator/state setup.
    }
  }
  for (const directory of cleanupDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Bootstrap Recovery real maintenance/recovery process qualification", () => {
  it("aborts abandoned PREPARED maintenance without executing its restart intent", async () => {
    const fixture = await makeFixture();
    const port = 55621;
    const child = new RealProcessController(
      fixture.anchorRoot,
      "maintenance-prepared",
      [qualifiedPgBin, String(port)],
    );
    const prepared = await child.waitFor("maintenance-prepared", "error");
    if (prepared.type === "error") {
      throw new Error(
        prepared.message ?? prepared.problemCode ?? "maintenance child failed",
      );
    }
    if (prepared.operationId === undefined) throw new Error("missing operation id");
    if (prepared.sourceToken === undefined)
      throw new Error("missing source Host token");

    const journalBefore = await new MaintenanceJournalStore(
      fixture.roots.INSTANCE,
    ).load(prepared.operationId as MaintenanceJournalBodyV1["operationId"]);
    if (journalBefore.status !== "CURRENT")
      throw new Error("prepared journal was not current");
    expect(journalBefore.value.state.phase).toBe("PREPARED");
    const sourceHostBootId = journalBefore.value.state.source.hostBootId;

    const descriptor = await buildDescriptor(fixture, port);
    const beforeCluster = await clusterIdentity(
      descriptor.toolchain,
      descriptor.placement.canonicalDataDirectory,
    );
    const beforeStart = await postmasterStartTime(fixture, port);
    await child.kill();
    await markBootstrapLockStale(fixture.roots.INSTANCE);

    const result = await recoverInterruptedHostMaintenance({
      anchorRoot: fixture.anchorRoot,
      principal: await proveLocalInstallationOwner(fixture.anchorRoot),
      expectedOperationId:
        prepared.operationId as MaintenanceJournalBodyV1["operationId"],
      initializeCanonicalHost: async ({ authority }) => {
        authority.assertCurrent();
      },
      keyProvider: makeKeyProvider(),
      timing: HOST_TIMING,
      privatePostgres: descriptor,
    });
    expect(result).toEqual({ kind: "ABORTED" });

    const journalAfter = await new MaintenanceJournalStore(fixture.roots.INSTANCE).load(
      prepared.operationId as MaintenanceJournalBodyV1["operationId"],
    );
    expect(journalAfter).toMatchObject({
      status: "CURRENT",
      value: { state: { phase: "ABORTED" } },
    });
    await expect(
      clusterIdentity(
        descriptor.toolchain,
        descriptor.placement.canonicalDataDirectory,
      ),
    ).resolves.toBe(beforeCluster);
    await expect(postmasterStartTime(fixture, port)).resolves.toBe(beforeStart);

    let laterOwned:
      | Awaited<
          ReturnType<
            Awaited<ReturnType<typeof prepareBootstrapPrelude>>["acquireOwnership"]
          >
        >
      | undefined;
    let laterReady: ReadyPrivatePostgres | undefined;
    let laterHost: BootstrapManagedHostContext | undefined;
    try {
      const laterPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      laterOwned = await laterPrepared.acquireOwnership({ heartbeatMs: 1_000 });
      laterReady = await laterOwned.preparePrivatePostgres({
        toolchainBinDirectory: qualifiedPgBin,
        lifecycle: LIFECYCLE,
        keyProvider: makeKeyProvider(),
      });
      laterHost = await laterOwned.handoffPrivatePostgresToHost(laterReady, {
        initializeCanonicalHost: async ({ authority }) => authority.assertCurrent(),
        keyProvider: makeKeyProvider(),
        timing: HOST_TIMING,
      });
      expect(laterHost.token).not.toBe(prepared.sourceToken);
      expect(laterHost.bootId).not.toBe(sourceHostBootId);
    } finally {
      if (laterHost?.state === "ACTIVE") {
        await laterHost
          .shutdownKeepingPrivatePostgres({
            async retire() {
              // This qualification composes no product Runtime.
            },
          })
          .catch(() => undefined);
      }
      await laterReady?.stop().catch(() => undefined);
      await stopPostgres(
        descriptor.toolchain,
        descriptor.placement.canonicalDataDirectory,
      );
      if (laterOwned !== undefined && laterOwned.ownershipState !== "RELEASED") {
        await laterOwned.close().catch(() => undefined);
      }
    }
  }, 240_000);

  it("kills real Bootstrap Recovery maintenance after durable EXECUTING and recovers it", async () => {
    const fixture = await makeFixture();
    const port = 55620;
    const child = new RealProcessController(fixture.anchorRoot, "maintenance", [
      qualifiedPgBin,
      String(port),
      "EXECUTING",
    ]);
    const prepared = await child.waitFor("maintenance-prepared", "error");
    if (prepared.type === "error") {
      throw new Error(
        prepared.message ?? prepared.problemCode ?? "maintenance child failed",
      );
    }
    if (prepared.operationId === undefined) throw new Error("missing operation id");
    const stopped = await waitForChildDurablePhase(
      child,
      fixture.roots.INSTANCE,
      prepared.operationId as MaintenanceJournalBodyV1["operationId"],
      "EXECUTING",
    );
    const sourceToken = stopped.source.hostOwnershipToken;
    const descriptor = await buildDescriptor(fixture, port);
    const beforeCluster = await clusterIdentity(
      descriptor.toolchain,
      descriptor.placement.canonicalDataDirectory,
    );
    await child.kill();
    await markBootstrapLockStale(fixture.roots.INSTANCE);

    const result = await recoverInterruptedHostMaintenance({
      anchorRoot: fixture.anchorRoot,
      principal: await proveLocalInstallationOwner(fixture.anchorRoot),
      expectedOperationId:
        prepared.operationId as MaintenanceJournalBodyV1["operationId"],
      initializeCanonicalHost: async ({ authority }) => {
        authority.assertCurrent();
      },
      keyProvider: makeKeyProvider(),
      timing: HOST_TIMING,
      privatePostgres: descriptor,
    });
    expect(result.kind).toBe("RESTARTED");
    if (result.kind !== "RESTARTED") throw new Error("Recovery did not return Host");
    expect(result.host.token).not.toBe(sourceToken);
    await expect(
      clusterIdentity(
        descriptor.toolchain,
        descriptor.placement.canonicalDataDirectory,
      ),
    ).resolves.toBe(beforeCluster);
    await result.host.shutdownKeepingPrivatePostgres({
      async retire() {
        // This recovery qualification composes no product Runtime.
      },
    });
    await stopPostgres(
      descriptor.toolchain,
      descriptor.placement.canonicalDataDirectory,
    );
  }, 240_000);
});
