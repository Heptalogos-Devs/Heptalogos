// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  asContentDigest,
  createInstallationId,
  createInstanceId,
  digestCanonicalJson,
  LIFECYCLE_ROOT_IDS,
  type BootId,
  type InstallationId,
  type InstanceId,
  type LifecycleRootId,
} from "@heptalogos/foundation-contracts";
import {
  BootstrapJournal,
  BootstrapStateStore,
  type BootstrapStateBodyV1,
} from "@heptalogos/bootstrap-state";
import type {
  BootstrapKeyProvider,
  BootstrapKeyRequestContext,
} from "../../src/bootstrap/key-provider.js";
import {
  prepareBootstrapPrelude,
  type OwnedBootstrapPrelude,
} from "../../src/bootstrap/prelude.js";
import {
  initializePrivatePostgresCluster,
  resolvePrivatePostgresPlacement,
  resolvePrivatePostgresToolchain,
} from "@heptalogos/private-postgres";

const pgBin = process.env.HEPTALOGOS_TEST_PG_BIN;
if (!pgBin) {
  throw new Error(
    "BLOCKED: HEPTALOGOS_TEST_PG_BIN is required for private PostgreSQL bootstrap integration qualification",
  );
}
const qualifiedPgBin = pgBin;

const directories: string[] = [];
const LOCK_DIRECTORY = ".heptalogos-bootstrap.lock";
const LIFECYCLE: TestPreparePrivatePostgresOptions["lifecycle"] = {
  startupTimeoutMs: 60_000,
  shutdownTimeoutMs: 30_000,
  readinessPollIntervalMs: 100,
};

interface TestPreparePrivatePostgresOptions {
  readonly toolchainBinDirectory: string;
  readonly initialPort?: number;
  readonly lifecycle: {
    readonly startupTimeoutMs: number;
    readonly shutdownTimeoutMs: number;
    readonly readinessPollIntervalMs: number;
  };
  readonly keyProvider: BootstrapKeyProvider;
  readonly __testHook?: (phase: TestFaultPhase) => void | Promise<void>;
}

type TestFaultPhase =
  | "after-initdb-before-state-commit"
  | "after-state-commit-before-start"
  | "after-start-before-ready-return";

interface TestReadyPrivatePostgres {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly port: number;
  readonly clusterSystemIdentifier: string;
  readonly toolchainVersion: "18.6";
  readonly startupDisposition: "STARTED_BY_THIS_BOOTSTRAP" | "ALREADY_RUNNING";
  stop(): Promise<void>;
  restart(): Promise<void>;
}

type OwnedPreludeWithPrivatePostgres = OwnedBootstrapPrelude & {
  preparePrivatePostgres(
    options: TestPreparePrivatePostgresOptions,
  ): Promise<TestReadyPrivatePostgres>;
};

interface Fixture {
  readonly anchorRoot: string;
  readonly roots: Readonly<Record<LifecycleRootId, string>>;
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
}

function makeState(revision: number): BootstrapStateBodyV1 {
  return {
    schemaVersion: 1,
    revision,
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

async function makeFixture(): Promise<Fixture> {
  const anchorRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-bootstrap-anchor-"));
  directories.push(anchorRoot);
  const roots = {} as Record<LifecycleRootId, string>;
  for (const id of LIFECYCLE_ROOT_IDS) {
    roots[id] =
      id === "PROGRAM"
        ? anchorRoot
        : await mkdtemp(join(tmpdir(), `heptalogos-pg-bootstrap-${id.toLowerCase()}-`));
    if (id !== "PROGRAM") directories.push(roots[id]);
  }
  const installationId = createInstallationId();
  const instanceId = createInstanceId();
  await writeFile(
    join(anchorRoot, "heptalogos.bootstrap.json"),
    JSON.stringify({ schemaVersion: 1, installationId, instanceId, roots }),
  );
  await new BootstrapStateStore(join(roots.INSTANCE, "bootstrap-state")).commit(
    makeState(1),
  );
  return { anchorRoot, roots, installationId, instanceId };
}

function makeOptions(
  port: number | undefined,
  contexts: BootstrapKeyRequestContext[],
): TestPreparePrivatePostgresOptions {
  const keyProvider: BootstrapKeyProvider = {
    async withPrivatePostgresBootstrapPassword<T>(
      context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      contexts.push(context);
      return use(
        new TextEncoder().encode("PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6"),
      );
    },
    async withPrivatePostgresHostLeasePassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(new TextEncoder().encode("H".repeat(32)));
    },
    async withPrivatePostgresRuntimePassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(new TextEncoder().encode("R".repeat(32)));
    },
    async withPrivatePostgresMigrationPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(new TextEncoder().encode("M".repeat(32)));
    },
    async withPrivatePostgresDurableExecutionPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(new TextEncoder().encode("D".repeat(32)));
    },
  };
  return {
    toolchainBinDirectory: qualifiedPgBin,
    ...(port === undefined ? {} : { initialPort: port }),
    lifecycle: LIFECYCLE,
    keyProvider,
  };
}

function makeFaultHook(
  phaseToStop: TestFaultPhase,
): (phase: TestFaultPhase) => Promise<void> {
  return async (phase) => {
    if (phase === phaseToStop) {
      throw new Error(`test fault injection: ${phase}`);
    }
  };
}

function withFaultHook(
  options: TestPreparePrivatePostgresOptions,
  phase: TestFaultPhase,
): TestPreparePrivatePostgresOptions {
  return { ...options, __testHook: makeFaultHook(phase) };
}

function callable(owned: OwnedBootstrapPrelude): OwnedPreludeWithPrivatePostgres {
  return owned as OwnedPreludeWithPrivatePostgres;
}

async function loadState(fixture: Fixture) {
  return new BootstrapStateStore(
    join(fixture.roots.INSTANCE, "bootstrap-state"),
  ).load();
}

async function journalStages(
  fixture: Fixture,
  bootId: BootId,
): Promise<readonly string[]> {
  return (await new BootstrapJournal(fixture.roots.INSTANCE).read(bootId)).map(
    (entry) => entry.stage,
  );
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("private PostgreSQL bootstrap orchestration", () => {
  it("initializes, commits canonical private PostgreSQL state, returns ready, and keeps bootstrap ownership held", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const contexts: BootstrapKeyRequestContext[] = [];
    let ready: TestReadyPrivatePostgres | undefined;

    try {
      ready = await callable(owned).preparePrivatePostgres(
        makeOptions(55436, contexts),
      );
      expect(ready).toMatchObject({
        installationId: fixture.installationId,
        instanceId: fixture.instanceId,
        port: 55436,
        toolchainVersion: "18.6",
        startupDisposition: "STARTED_BY_THIS_BOOTSTRAP",
      });
      expect("mechanics" in ready).toBe(false);
      expect(typeof ready.stop).toBe("function");
      expect(typeof ready.restart).toBe("function");
      expect(ready.clusterSystemIdentifier).toMatch(/^[0-9]+$/u);
      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toMatchObject({
        installationId: fixture.installationId,
        instanceId: fixture.instanceId,
        bootId: prepared.bootId,
        purpose: "private-postgres-bootstrap-superuser",
      });

      const state = await loadState(fixture);
      expect(state).toMatchObject({
        status: "CURRENT",
        value: {
          state: {
            schemaVersion: 1,
            revision: 2,
            privatePostgres: {
              schemaVersion: 1,
              postgresMajor: 18,
              initializedByPostgresVersion: "18.6",
              installationId: fixture.installationId,
              instanceId: fixture.instanceId,
              bootstrapRoleName: "heptalogos_bootstrap",
              dataPlacement: {
                rootId: "DATA",
                relativePath: "private-postgres",
                dataLayoutVersion: 1,
              },
              persistedPort: 55436,
              clusterSystemIdentifier: ready.clusterSystemIdentifier,
              initializationProfileRevision: expect.any(String),
            },
          },
        },
      });
      expect(JSON.stringify(state)).not.toContain(
        "PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6",
      );
      const journal = await new BootstrapJournal(fixture.roots.INSTANCE).read(
        prepared.bootId,
      );
      expect(journal.map((entry) => entry.stage)).toEqual([
        "bootstrap.prelude.started",
        "bootstrap.locator.resolved",
        "bootstrap.roots.resolved",
        "bootstrap.state.preliminary_read",
        "bootstrap.ownership.acquired",
        "bootstrap.state.authoritative_reload",
        "bootstrap.prelude.owned",
        "bootstrap.postgres.toolchain_validated",
        "bootstrap.postgres.cluster_initialization_started",
        "bootstrap.postgres.cluster_initialized",
        "bootstrap.postgres.identity_committed",
        "bootstrap.postgres.cluster_validated",
        "bootstrap.postgres.start_started",
        "bootstrap.postgres.ready",
      ]);
      expect(JSON.stringify(journal)).not.toContain(
        "PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6",
      );
      await expect(
        access(join(fixture.roots.DATA, "private-postgres", "postmaster.pid")),
      ).resolves.toBeUndefined();

      expect(owned.ownershipState).toBe("HELD");
      const contender = await prepareBootstrapPrelude(fixture.anchorRoot);
      await expect(
        contender.acquireOwnership({ heartbeatMs: 1_000 }),
      ).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.ownership.lock_present" },
      });
      await expect(
        readFile(join(fixture.roots.LOG, "private-postgres.log"), "utf8"),
      ).resolves.not.toContain("PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6");
    } finally {
      await ready?.stop().catch(() => undefined);
      await owned.close();
    }
  }, 120_000);

  it("restarts from canonical state without initdb and preserves identity and port", async () => {
    const fixture = await makeFixture();
    const firstPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const firstOwned = await firstPrepared.acquireOwnership({ heartbeatMs: 1_000 });
    const firstContexts: BootstrapKeyRequestContext[] = [];
    let firstReady: TestReadyPrivatePostgres | undefined;

    try {
      firstReady = await callable(firstOwned).preparePrivatePostgres(
        makeOptions(55437, firstContexts),
      );
      const identity = firstReady.clusterSystemIdentifier;
      await firstReady.stop();
      await firstOwned.close();
      await expect(firstReady.restart()).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.ownership.not_held" },
      });

      const secondPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      const secondOwned = await secondPrepared.acquireOwnership({ heartbeatMs: 1_000 });
      const secondContexts: BootstrapKeyRequestContext[] = [];
      let secondReady: TestReadyPrivatePostgres | undefined;
      try {
        secondReady = await callable(secondOwned).preparePrivatePostgres(
          makeOptions(undefined, secondContexts),
        );
        expect(secondReady.clusterSystemIdentifier).toBe(identity);
        expect(secondReady.port).toBe(55437);
        expect(secondContexts).toHaveLength(0);
        await expect(loadState(fixture)).resolves.toMatchObject({
          status: "CURRENT",
          value: { state: { schemaVersion: 1, revision: 2 } },
        });
        await expect(
          journalStages(fixture, secondPrepared.bootId),
        ).resolves.not.toContain("bootstrap.postgres.cluster_initialization_started");
      } finally {
        await secondReady?.stop().catch(() => undefined);
        await secondOwned.close();
      }
    } finally {
      await firstReady?.stop().catch(() => undefined);
      if (firstOwned.ownershipState !== "RELEASED") {
        await firstOwned.close().catch(() => undefined);
      }
    }
  }, 120_000);

  it("rejects a stale Ready handle without changing a newer live session", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const firstContexts: BootstrapKeyRequestContext[] = [];
    let firstReady: TestReadyPrivatePostgres | undefined;
    let secondReady: TestReadyPrivatePostgres | undefined;
    const postmasterPath = join(
      fixture.roots.DATA,
      "private-postgres",
      "postmaster.pid",
    );

    try {
      firstReady = await callable(owned).preparePrivatePostgres(
        makeOptions(55460, firstContexts),
      );
      await firstReady.stop();
      await expect(access(postmasterPath)).rejects.toMatchObject({ code: "ENOENT" });

      secondReady = await callable(owned).preparePrivatePostgres(
        makeOptions(undefined, []),
      );
      await expect(access(postmasterPath)).resolves.toBeUndefined();

      await expect(firstReady.stop()).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.private_postgres.stale_handle" },
      });
      await expect(access(postmasterPath)).resolves.toBeUndefined();
      await expect(owned.close()).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.private_postgres.release_blocked" },
      });

      await secondReady.stop();
      await expect(access(postmasterPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(owned.close()).resolves.toBeUndefined();
    } finally {
      await secondReady?.stop().catch(() => undefined);
      await firstReady?.stop().catch(() => undefined);
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 120_000);

  it("treats initializedByPostgresVersion as provenance across a patch update", async () => {
    const fixture = await makeFixture();
    const firstPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const firstOwned = await firstPrepared.acquireOwnership({ heartbeatMs: 1_000 });
    const contexts: BootstrapKeyRequestContext[] = [];
    let firstReady: TestReadyPrivatePostgres | undefined;
    let secondReady: TestReadyPrivatePostgres | undefined;

    try {
      firstReady = await callable(firstOwned).preparePrivatePostgres(
        makeOptions(55455, contexts),
      );
      const identity = firstReady.clusterSystemIdentifier;
      await firstReady.stop();
      const loaded = await loadState(fixture);
      if (loaded.status !== "CURRENT" || loaded.value.state.schemaVersion !== 1) {
        throw new Error("expected authoritative BootstrapState V1");
      }
      const current: BootstrapStateBodyV1 = loaded.value.state;
      await firstOwned.state.commit({
        ...current,
        revision: current.revision + 1,
        privatePostgres: {
          ...current.privatePostgres!,
          initializedByPostgresVersion: "18.4",
        },
      });
      await firstOwned.close();

      const secondPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      const secondOwned = await secondPrepared.acquireOwnership({ heartbeatMs: 1_000 });
      try {
        secondReady = await callable(secondOwned).preparePrivatePostgres(
          makeOptions(undefined, []),
        );
        expect(secondReady.clusterSystemIdentifier).toBe(identity);
        expect(secondReady.port).toBe(55455);
      } finally {
        await secondReady?.stop().catch(() => undefined);
        await secondOwned.close();
      }
    } finally {
      await firstReady?.stop().catch(() => undefined);
      if (firstOwned.ownershipState !== "RELEASED") {
        await firstOwned.close().catch(() => undefined);
      }
    }
  }, 120_000);

  it("rejects a conflicting initial port before starting or mutating the canonical cluster", async () => {
    const fixture = await makeFixture();
    const firstPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const firstOwned = await firstPrepared.acquireOwnership({ heartbeatMs: 1_000 });
    const firstContexts: BootstrapKeyRequestContext[] = [];
    let firstReady: TestReadyPrivatePostgres | undefined;

    try {
      firstReady = await callable(firstOwned).preparePrivatePostgres(
        makeOptions(55438, firstContexts),
      );
      await firstReady.stop();
      await firstOwned.close();

      const before = await readFile(
        join(fixture.roots.INSTANCE, "bootstrap-state", "bootstrap-state.json"),
        "utf8",
      );
      const secondPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      const secondOwned = await secondPrepared.acquireOwnership({ heartbeatMs: 1_000 });
      const secondContexts: BootstrapKeyRequestContext[] = [];
      try {
        await expect(
          callable(secondOwned).preparePrivatePostgres(
            makeOptions(55439, secondContexts),
          ),
        ).rejects.toMatchObject({
          problem: { problemCode: "bootstrap.private_postgres.port_conflict" },
        });
        expect(secondContexts).toHaveLength(0);
        await expect(
          readFile(
            join(fixture.roots.INSTANCE, "bootstrap-state", "bootstrap-state.json"),
            "utf8",
          ),
        ).resolves.toBe(before);
        await expect(
          access(join(fixture.roots.DATA, "private-postgres", "postmaster.pid")),
        ).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await secondOwned.close();
      }
    } finally {
      await firstReady?.stop().catch(() => undefined);
      if (firstOwned.ownershipState !== "RELEASED") {
        await firstOwned.close().catch(() => undefined);
      }
    }
  }, 120_000);

  it("requires recovery after a fault between initdb and canonical state commit", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const contexts: BootstrapKeyRequestContext[] = [];

    try {
      await expect(
        callable(owned).preparePrivatePostgres(
          withFaultHook(
            makeOptions(55440, contexts),
            "after-initdb-before-state-commit",
          ),
        ),
      ).rejects.toThrow("after-initdb-before-state-commit");
      await owned.close();

      await expect(loadState(fixture)).resolves.toMatchObject({
        status: "CURRENT",
        value: { state: { schemaVersion: 1, revision: 1 } },
      });
      await expect(
        access(join(fixture.roots.DATA, "private-postgres", "PG_VERSION")),
      ).resolves.toBeUndefined();

      const recoveryPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      const recoveryOwned = await recoveryPrepared.acquireOwnership({
        heartbeatMs: 1_000,
      });
      try {
        await expect(
          callable(recoveryOwned).preparePrivatePostgres(makeOptions(undefined, [])),
        ).rejects.toMatchObject({
          problem: { problemCode: "bootstrap.private_postgres.recovery_required" },
        });
      } finally {
        await recoveryOwned.close();
      }
    } finally {
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 120_000);

  it("recovers after a fault between canonical state commit and PostgreSQL start", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const contexts: BootstrapKeyRequestContext[] = [];
    let ready: TestReadyPrivatePostgres | undefined;

    try {
      await expect(
        callable(owned).preparePrivatePostgres(
          withFaultHook(
            makeOptions(55441, contexts),
            "after-state-commit-before-start",
          ),
        ),
      ).rejects.toThrow("after-state-commit-before-start");
      await owned.close();

      await expect(loadState(fixture)).resolves.toMatchObject({
        status: "CURRENT",
        value: { state: { schemaVersion: 1, revision: 2 } },
      });
      await expect(
        access(join(fixture.roots.DATA, "private-postgres", "postmaster.pid")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const recoveryPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      const recoveryOwned = await recoveryPrepared.acquireOwnership({
        heartbeatMs: 1_000,
      });
      try {
        ready = await callable(recoveryOwned).preparePrivatePostgres(
          makeOptions(undefined, []),
        );
        expect(ready.port).toBe(55441);
        await ready.stop();
      } finally {
        await ready?.stop().catch(() => undefined);
        await recoveryOwned.close();
      }
    } finally {
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 120_000);

  it("recovers after a fault after start without changing the authoritative cluster", async () => {
    const fixture = await makeFixture();
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const contexts: BootstrapKeyRequestContext[] = [];

    try {
      await expect(
        callable(owned).preparePrivatePostgres(
          withFaultHook(
            makeOptions(55442, contexts),
            "after-start-before-ready-return",
          ),
        ),
      ).rejects.toThrow("after-start-before-ready-return");
      await owned.close();

      await expect(loadState(fixture)).resolves.toMatchObject({
        status: "CURRENT",
        value: { state: { schemaVersion: 1, revision: 2 } },
      });
      await expect(
        access(join(fixture.roots.DATA, "private-postgres", "postmaster.pid")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      const recoveryPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      const recoveryOwned = await recoveryPrepared.acquireOwnership({
        heartbeatMs: 1_000,
      });
      let ready: TestReadyPrivatePostgres | undefined;
      try {
        ready = await callable(recoveryOwned).preparePrivatePostgres(
          makeOptions(undefined, []),
        );
        expect(ready.port).toBe(55442);
      } finally {
        await ready?.stop().catch(() => undefined);
        await recoveryOwned.close();
      }
    } finally {
      if (owned.ownershipState !== "RELEASED") {
        await owned.close().catch(() => undefined);
      }
    }
  }, 120_000);

  it("does not adopt a valid-looking PostgreSQL directory without canonical identity", async () => {
    const fixture = await makeFixture();
    const toolchain = await resolvePrivatePostgresToolchain(qualifiedPgBin);
    const placement = resolvePrivatePostgresPlacement(fixture.roots.DATA);
    await initializePrivatePostgresCluster({
      toolchain,
      placement,
      credentialTempRoot: fixture.roots.TEMP,
      bootstrapPasswordUtf8: new TextEncoder().encode(
        "PRIVATE_POSTGRES_TEST_SENTINEL_DO_NOT_LEAK_4f88b1c6",
      ),
      port: 55443,
      lifecycle: LIFECYCLE,
      assertControlAuthority: () => undefined,
    });

    const before = await readFile(
      join(fixture.roots.INSTANCE, "bootstrap-state", "bootstrap-state.json"),
      "utf8",
    );
    const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
    const contexts: BootstrapKeyRequestContext[] = [];
    try {
      await expect(
        callable(owned).preparePrivatePostgres(makeOptions(undefined, contexts)),
      ).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.private_postgres.recovery_required" },
      });
      expect(contexts).toHaveLength(0);
      await expect(
        readFile(
          join(fixture.roots.INSTANCE, "bootstrap-state", "bootstrap-state.json"),
          "utf8",
        ),
      ).resolves.toBe(before);
    } finally {
      await owned.close();
    }
  }, 120_000);

  it("fails closed when an unrelated process occupies the authoritative port", async () => {
    const fixture = await makeFixture();
    const firstPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
    const firstOwned = await firstPrepared.acquireOwnership({ heartbeatMs: 1_000 });
    const firstContexts: BootstrapKeyRequestContext[] = [];
    let firstReady: TestReadyPrivatePostgres | undefined;
    const blocker = createServer();

    try {
      firstReady = await callable(firstOwned).preparePrivatePostgres(
        makeOptions(55444, firstContexts),
      );
      await firstReady.stop();
      await firstOwned.close();
      await new Promise<void>((resolve, reject) => {
        blocker.once("error", reject);
        blocker.listen(55444, "127.0.0.1", () => resolve());
      });

      const before = await readFile(
        join(fixture.roots.INSTANCE, "bootstrap-state", "bootstrap-state.json"),
        "utf8",
      );
      const secondPrepared = await prepareBootstrapPrelude(fixture.anchorRoot);
      const secondOwned = await secondPrepared.acquireOwnership({ heartbeatMs: 1_000 });
      const secondContexts: BootstrapKeyRequestContext[] = [];
      try {
        await expect(
          callable(secondOwned).preparePrivatePostgres(
            makeOptions(undefined, secondContexts),
          ),
        ).rejects.toMatchObject({
          problem: {
            problemCode: "private-postgres.lifecycle.start_cleanup_uncertain",
          },
        });
        expect(secondContexts).toHaveLength(0);
        await expect(
          readFile(
            join(fixture.roots.INSTANCE, "bootstrap-state", "bootstrap-state.json"),
            "utf8",
          ),
        ).resolves.toBe(before);
        await expect(secondOwned.close()).rejects.toMatchObject({
          problem: { problemCode: "bootstrap.private_postgres.release_blocked" },
        });
        expect(secondOwned.ownershipState).toBe("HELD");
      } finally {
        await rm(join(fixture.roots.INSTANCE, LOCK_DIRECTORY), {
          recursive: true,
          force: true,
        });
        await new Promise<void>((resolve) => {
          if (secondOwned.ownershipSignal.aborted) {
            resolve();
          } else {
            secondOwned.ownershipSignal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          }
        });
      }
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
      await firstReady?.stop().catch(() => undefined);
      if (firstOwned.ownershipState !== "RELEASED") {
        await firstOwned.close().catch(() => undefined);
      }
    }
  }, 120_000);
});
