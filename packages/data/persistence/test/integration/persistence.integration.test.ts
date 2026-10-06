// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { CompiledQuery } from "kysely";
import { Client } from "pg";
import {
  createActivityId,
  createBootId,
  createContinuityEpochId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  type BootId,
  type InstanceId,
} from "@heptalogos/foundation-contracts";
import {
  acquireBootstrapHostReservation,
  acquireHostLeaseConnection,
  deriveHostAdvisoryKey,
  ensureHostOwnershipSchema,
  HOST_LEASE_ROLE,
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  HOST_OWNERSHIP_OWNER_ROLE,
  HOST_RUNTIME_ROLE,
  provisionHostOwnershipDatabase,
  publishHostOwnershipToken,
  type BootstrapAdminPasswordProvider,
  type HostPersistenceAuthority,
  type HostOwnershipTimingOptions,
} from "@heptalogos/host-ownership";
import {
  resolvePrivatePostgresToolchain,
  type PrivatePostgresToolchain,
} from "@heptalogos/private-postgres";
import {
  createPersistenceService,
  type PersistenceExecutionContextProvider,
  type PersistenceExecutionMetadata,
  type PersistenceRuntimeOptions,
  type PersistenceTransactionContext,
} from "../../src/index.js";
import { resolveTransactionContext } from "../../src/transaction-context.js";

const qualifiedPgBin = process.env.HEPTALOGOS_TEST_PG_BIN;
if (!qualifiedPgBin) {
  throw new Error(
    "BLOCKED: HEPTALOGOS_TEST_PG_BIN is required for persistence PostgreSQL qualification",
  );
}

const execFileAsync = promisify(execFile);
const BOOTSTRAP_PASSWORD = "PERSISTENCE_TEST_BOOTSTRAP_PASSWORD_0123456789";
const HOST_LEASE_PASSWORD = "PERSISTENCE_TEST_HOST_LEASE_PASSWORD_0123456789";
const RUNTIME_PASSWORD = "PERSISTENCE_TEST_RUNTIME_PASSWORD_0123456789";
const MIGRATION_PASSWORD = "PERSISTENCE_TEST_MIGRATION_PASSWORD_0123456789";
const QUALIFICATION_TABLE = "persistence_qualification";
const TIMING: HostOwnershipTimingOptions = {
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  fenceLockTimeoutMs: 10_000,
  keepAliveInitialDelayMs: 1_000,
};
const mutationAuthority = { assertCurrent(): void {} };

let resolvedToolchain: PrivatePostgresToolchain | undefined;

interface Fixture {
  readonly root: string;
  readonly dataDirectory: string;
  readonly port: number;
  readonly installationId: ReturnType<typeof createInstallationId>;
  readonly instanceId: InstanceId;
  readonly continuityEpochId: ReturnType<typeof createContinuityEpochId>;
  readonly provider: BootstrapAdminPasswordProvider;
  readonly stop: () => Promise<void>;
}

interface PublishedHost {
  readonly token: ReturnType<typeof createHostOwnershipToken>;
  readonly bootId: BootId;
}

interface AuthorityHandle {
  readonly authority: HostPersistenceAuthority;
  setActive(active: boolean): void;
  abort(): void;
}

const fixtures: Fixture[] = [];

function runtimeOptions(): PersistenceRuntimeOptions {
  return {
    maxConnections: 4,
    idleTimeoutMs: 5_000,
    connectionTimeoutMs: 10_000,
    statementTimeoutMs: 10_000,
    lockTimeoutMs: 10_000,
    idleInTransactionSessionTimeoutMs: 30_000,
    onBackgroundError() {},
  };
}

function makeProvider(): BootstrapAdminPasswordProvider {
  return {
    async withBootstrapPassword<T>(use: (password: Uint8Array) => Promise<T>) {
      const password = new TextEncoder().encode(BOOTSTRAP_PASSWORD);
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withHostLeasePassword<T>(use: (password: Uint8Array) => Promise<T>) {
      const password = new TextEncoder().encode(HOST_LEASE_PASSWORD);
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withRuntimePassword<T>(use: (password: Uint8Array) => Promise<T>) {
      const password = new TextEncoder().encode(RUNTIME_PASSWORD);
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withMigrationPassword<T>(use: (password: Uint8Array) => Promise<T>) {
      const password = new TextEncoder().encode(MIGRATION_PASSWORD);
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withDurableExecutionPassword<T>(use: (password: Uint8Array) => Promise<T>) {
      const password = new TextEncoder().encode("D".repeat(32));
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
  };
}

async function toolchain(): Promise<PrivatePostgresToolchain> {
  return (resolvedToolchain ??= await resolvePrivatePostgresToolchain(qualifiedPgBin!));
}

async function runTool(executable: string, args: readonly string[]): Promise<void> {
  await execFileAsync(executable, [...args], {
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function runPgCtl(args: readonly string[]): Promise<void> {
  const pg = await toolchain();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(pg.pgCtl, [...args], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_ctl exited with code ${String(code)}`));
    });
  });
}

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (port === 0) throw new Error("Could not allocate a PostgreSQL test port");
  return port;
}

async function waitUntilReady(port: number): Promise<void> {
  const pg = await toolchain();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await runTool(pg.pgIsReady, ["--host", "127.0.0.1", "--port", String(port)]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("PostgreSQL did not become ready within the integration budget");
}

async function createCluster(): Promise<Fixture> {
  const pg = await toolchain();
  const root = await mkdtemp(join(tmpdir(), "heptalogos-persistence-pg-"));
  const dataDirectory = join(root, "data");
  const tempDirectory = join(root, "temp");
  const logDirectory = join(root, "log");
  const passwordFile = join(tempDirectory, "bootstrap-password");
  const port = await freePort();
  const installationId = createInstallationId();
  const instanceId = createInstanceId();
  const continuityEpochId = createContinuityEpochId();
  const provider = makeProvider();
  await Promise.all(
    [dataDirectory, tempDirectory, logDirectory].map((directory) =>
      import("node:fs/promises").then(({ mkdir }) =>
        mkdir(directory, { recursive: true }),
      ),
    ),
  );
  await writeFile(passwordFile, `${BOOTSTRAP_PASSWORD}\n`, { encoding: "utf8" });
  await runTool(pg.initdb, [
    "--pgdata",
    dataDirectory,
    "--encoding=UTF8",
    "--data-checksums",
    "--auth-host=scram-sha-256",
    "--auth-local=scram-sha-256",
    "--username=heptalogos_bootstrap",
    `--pwfile=${passwordFile}`,
  ]);
  await writeFile(
    join(dataDirectory, "postgresql.auto.conf"),
    `listen_addresses = '127.0.0.1'\nunix_socket_directories = ''\nport = ${port}\npassword_encryption = 'scram-sha-256'\n`,
  );
  await writeFile(
    join(dataDirectory, "pg_hba.conf"),
    "# Heptalogos Host-fenced persistence integration HBA\nhost all all 127.0.0.1/32 scram-sha-256\n",
  );
  await runPgCtl([
    "start",
    "--pgdata",
    dataDirectory,
    "--log",
    join(logDirectory, "postgres.log"),
    "--wait",
    "--timeout",
    "60",
  ]);
  await waitUntilReady(port);
  const fixture: Fixture = {
    root,
    dataDirectory,
    port,
    installationId,
    instanceId,
    continuityEpochId,
    provider,
    stop: async () => {
      await runPgCtl([
        "stop",
        "--pgdata",
        dataDirectory,
        "--mode=fast",
        "--wait",
        "--timeout",
        "60",
      ]).catch(() => undefined);
    },
  };
  fixtures.push(fixture);
  return fixture;
}

async function bootstrapClient(
  fixture: Fixture,
  database = "postgres",
): Promise<Client> {
  const client = new Client({
    host: "127.0.0.1",
    port: fixture.port,
    database,
    user: "heptalogos_bootstrap",
    password: BOOTSTRAP_PASSWORD,
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  return client;
}

async function prepareQualificationTable(fixture: Fixture): Promise<void> {
  const client = await bootstrapClient(fixture, HOST_OWNERSHIP_CANONICAL_DATABASE);
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" (id integer PRIMARY KEY, value text NOT NULL)`,
    );
    await client.query(
      `ALTER TABLE "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" OWNER TO "${HOST_OWNERSHIP_OWNER_ROLE}"`,
    );
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" TO "${HOST_RUNTIME_ROLE}"`,
    );
  } finally {
    await client.end();
  }
}

async function prepareHostLease(fixture: Fixture) {
  await provisionHostOwnershipDatabase({
    port: fixture.port,
    passwordProvider: fixture.provider,
    mutationAuthority,
  });
  const reservation = await acquireBootstrapHostReservation({
    port: fixture.port,
    advisoryKey: deriveHostAdvisoryKey(fixture.instanceId),
    passwordProvider: fixture.provider,
    mutationAuthority,
  });
  if (reservation === undefined) throw new Error("expected bootstrap reservation");
  await ensureHostOwnershipSchema({
    port: fixture.port,
    instanceId: fixture.instanceId,
    passwordProvider: fixture.provider,
    mutationAuthority,
  });
  await reservation.release();
  await prepareQualificationTable(fixture);
  const lease = await acquireHostLeaseConnection({
    target: {
      host: "127.0.0.1",
      port: fixture.port,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
    },
    advisoryKey: deriveHostAdvisoryKey(fixture.instanceId),
    timing: TIMING,
    passwordProvider: fixture.provider,
    mutationAuthority,
  });
  if (lease === undefined) throw new Error("expected Host lease connection");
  return lease;
}

async function publish(
  fixture: Fixture,
  lease: Awaited<ReturnType<typeof acquireHostLeaseConnection>>,
): Promise<PublishedHost> {
  if (lease === undefined) throw new Error("Host lease is unavailable");
  const token = createHostOwnershipToken();
  const bootId = createBootId();
  await publishHostOwnershipToken({
    connection: lease,
    instanceId: fixture.instanceId,
    bootId,
    token,
    fenceLockTimeoutMs: TIMING.fenceLockTimeoutMs,
    statementTimeoutMs: TIMING.statementTimeoutMs,
    mutationAuthority,
  });
  return { token, bootId };
}

function makeAuthority(
  fixture: Fixture,
  lease: Awaited<ReturnType<typeof acquireHostLeaseConnection>>,
  published: PublishedHost,
  checkLease = true,
): AuthorityHandle {
  if (lease === undefined) throw new Error("Host lease is unavailable");
  const controller = new AbortController();
  let active = true;
  const authority: HostPersistenceAuthority = {
    installationId: fixture.installationId,
    instanceId: fixture.instanceId,
    bootId: published.bootId,
    continuityEpochId: fixture.continuityEpochId,
    token: published.token,
    target: {
      host: "127.0.0.1",
      port: fixture.port,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: HOST_RUNTIME_ROLE,
    },
    signal: controller.signal,
    assertActive() {
      if (!active) throw new Error("process-local Host is fenced");
      if (checkLease) lease.assertActive();
    },
    async withRuntimeDatabasePassword(use) {
      if (!active) throw new Error("process-local Host is fenced");
      return use(new TextEncoder().encode(RUNTIME_PASSWORD));
    },
  };
  return {
    authority,
    setActive(value) {
      active = value;
    },
    abort() {
      controller.abort();
    },
  };
}

function executionProviderFor(
  authority: HostPersistenceAuthority,
): PersistenceExecutionContextProvider {
  const execution: PersistenceExecutionMetadata = Object.freeze({
    activityId: createActivityId(),
    installationId: authority.installationId,
    instanceId: authority.instanceId,
    bootId: authority.bootId,
    continuityEpochId: authority.continuityEpochId,
    hostOwnershipToken: authority.token,
  });
  return { current: () => execution };
}

async function internalQuery<Row = Record<string, unknown>>(
  context: PersistenceTransactionContext,
  text: string,
  parameters: readonly unknown[] = [],
): Promise<{ readonly rows: readonly Row[] }> {
  const transaction = resolveTransactionContext(context);
  const result = await transaction.executeQuery<Row>(
    CompiledQuery.raw(text, [...parameters]),
  );
  return { rows: result.rows };
}

async function readQualificationRows(fixture: Fixture): Promise<readonly unknown[]> {
  const client = await bootstrapClient(fixture, HOST_OWNERSHIP_CANONICAL_DATABASE);
  try {
    const result = await client.query(
      `SELECT id, value FROM "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" ORDER BY id`,
    );
    return result.rows;
  } finally {
    await client.end();
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async (fixture) => {
      await fixture.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }),
  );
});

describe("Host-fenced persistence PostgreSQL 18.6 qualification", () => {
  it("admits a current Host mutation and commits through the runtime pool", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const published = await publish(fixture, lease);
    const handle = makeAuthority(fixture, lease, published);
    const service = createPersistenceService(
      handle.authority,
      runtimeOptions(),
      executionProviderFor(handle.authority),
    );
    try {
      await service.mutate(async (context) => {
        await internalQuery(
          context,
          `INSERT INTO "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" (id, value) VALUES ($1, $2)`,
          [1, "current-mutation"],
        );
      });
      await expect(readQualificationRows(fixture)).resolves.toEqual([
        { id: 1, value: "current-mutation" },
      ]);
    } finally {
      await service.close().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("rejects a stale token at the database fence before operation invocation", async () => {
    const fixture = await createCluster();
    const leaseA = await prepareHostLease(fixture);
    const publishedA = await publish(fixture, leaseA);
    const admin = await bootstrapClient(fixture, HOST_OWNERSHIP_CANONICAL_DATABASE);
    let leaseB: Awaited<ReturnType<typeof acquireHostLeaseConnection>> | undefined;
    try {
      await admin.query(
        `INSERT INTO "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" (id, value) VALUES (1, 'before')`,
      );
      await leaseA.close();
      leaseB = await prepareHostLease(fixture);
      const publishedB = await publish(fixture, leaseB);
      const stale = makeAuthority(fixture, leaseB, publishedA, false);
      const service = createPersistenceService(
        stale.authority,
        runtimeOptions(),
        executionProviderFor(stale.authority),
      );
      let invoked = 0;
      try {
        await expect(
          service.mutate(async () => {
            invoked += 1;
            return undefined;
          }),
        ).rejects.toMatchObject({
          problem: { problemCode: "persistence.host_fence.stale_owner" },
        });
        expect(invoked).toBe(0);
        expect(publishedB.token).not.toBe(publishedA.token);
        await expect(readQualificationRows(fixture)).resolves.toEqual([
          { id: 1, value: "before" },
        ]);
      } finally {
        await service.close().catch(() => undefined);
      }
    } finally {
      await admin.end().catch(() => undefined);
      await leaseB?.close().catch(() => undefined);
      await leaseA.close().catch(() => undefined);
    }
  }, 120_000);

  it("serializes new token publication behind an admitted old mutation", async () => {
    const fixture = await createCluster();
    const leaseA = await prepareHostLease(fixture);
    const publishedA = await publish(fixture, leaseA);
    const handleA = makeAuthority(fixture, leaseA, publishedA);
    const serviceA = createPersistenceService(
      handleA.authority,
      runtimeOptions(),
      executionProviderFor(handleA.authority),
    );
    const entered = deferred<void>();
    const release = deferred<void>();
    let leaseB: Awaited<ReturnType<typeof acquireHostLeaseConnection>> | undefined;
    try {
      const mutation = serviceA.mutate(async (context) => {
        entered.resolve();
        await release.promise;
        await internalQuery(
          context,
          `INSERT INTO "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" (id, value) VALUES ($1, $2)`,
          [3, "serialized-publication"],
        );
      });
      await entered.promise;
      await leaseA.close();
      handleA.setActive(false);

      leaseB = await prepareHostLease(fixture);
      let publishedBeforeRelease = false;
      const publishBPromise = publish(fixture, leaseB).then((value) => {
        publishedBeforeRelease = true;
        return value;
      });
      await delay(250);
      expect(publishedBeforeRelease).toBe(false);

      release.resolve();
      await mutation;
      const publishedB = await publishBPromise;
      expect(publishedB.token).not.toBe(publishedA.token);
      await expect(readQualificationRows(fixture)).resolves.toEqual([
        { id: 3, value: "serialized-publication" },
      ]);
    } finally {
      release.resolve();
      await serviceA.close().catch(() => undefined);
      await leaseB?.close().catch(() => undefined);
      await leaseA.close().catch(() => undefined);
    }
  }, 120_000);

  it("rejects new mutations after the old Host loses its lease", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const published = await publish(fixture, lease);
    const handle = makeAuthority(fixture, lease, published);
    const service = createPersistenceService(
      handle.authority,
      runtimeOptions(),
      executionProviderFor(handle.authority),
    );
    try {
      await lease.close();
      handle.setActive(false);
      let invoked = 0;
      await expect(
        service.mutate(async () => {
          invoked += 1;
          return undefined;
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "persistence.service.fenced" },
      });
      expect(invoked).toBe(0);
    } finally {
      await service.close().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("enforces READ ONLY in PostgreSQL, not in application SQL inspection", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const published = await publish(fixture, lease);
    const handle = makeAuthority(fixture, lease, published);
    const service = createPersistenceService(
      handle.authority,
      runtimeOptions(),
      executionProviderFor(handle.authority),
    );
    try {
      await expect(
        service.read(async (context) =>
          internalQuery(
            context,
            `INSERT INTO "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" (id, value) VALUES (5, 'forbidden')`,
          ),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "persistence.transaction.failed" },
      });
      await expect(readQualificationRows(fixture)).resolves.toEqual([]);
    } finally {
      await service.close().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("allows Host token publication while a read transaction is paused", async () => {
    const fixture = await createCluster();
    const leaseA = await prepareHostLease(fixture);
    const publishedA = await publish(fixture, leaseA);
    const handleA = makeAuthority(fixture, leaseA, publishedA);
    const serviceA = createPersistenceService(
      handleA.authority,
      runtimeOptions(),
      executionProviderFor(handleA.authority),
    );
    const entered = deferred<void>();
    const release = deferred<void>();
    let leaseB: Awaited<ReturnType<typeof acquireHostLeaseConnection>> | undefined;
    try {
      const read = serviceA.read(async () => {
        entered.resolve();
        await release.promise;
        return "read held";
      });
      await entered.promise;
      await leaseA.close();
      handleA.setActive(false);
      leaseB = await prepareHostLease(fixture);
      let publishedBeforeReadRelease = false;
      const publishBPromise = publish(fixture, leaseB).then((value) => {
        publishedBeforeReadRelease = true;
        return value;
      });
      await delay(250);
      expect(publishedBeforeReadRelease).toBe(true);
      release.resolve();
      await expect(read).resolves.toBe("read held");
      await publishBPromise;
    } finally {
      release.resolve();
      await serviceA.close().catch(() => undefined);
      await leaseB?.close().catch(() => undefined);
      await leaseA.close().catch(() => undefined);
    }
  }, 120_000);

  it("classifies lost commit acknowledgement as explicit uncertainty", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const published = await publish(fixture, lease);
    const handle = makeAuthority(fixture, lease, published);
    const service = createPersistenceService(
      handle.authority,
      runtimeOptions(),
      executionProviderFor(handle.authority),
    );
    const admin = await bootstrapClient(fixture, HOST_OWNERSHIP_CANONICAL_DATABASE);
    try {
      await expect(
        service.mutate(async (context) => {
          await internalQuery(
            context,
            `INSERT INTO "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" (id, value) VALUES (7, 'uncertain')`,
          );
          const pid = await internalQuery<{ readonly pid: number }>(
            context,
            "SELECT pg_backend_pid() AS pid",
          );
          await admin.query("SELECT pg_terminate_backend($1)", [pid.rows[0]?.pid]);
        }),
      ).rejects.toMatchObject({
        problem: {
          problemCode: "persistence.transaction.commit_uncertain",
          retryClass: "manual",
        },
      });
    } finally {
      await admin.end().catch(() => undefined);
      await service.close().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("proves runtime role connect, explicit DML, and privilege closure", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const runtime = new Client({
      host: "127.0.0.1",
      port: fixture.port,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: HOST_RUNTIME_ROLE,
      password: RUNTIME_PASSWORD,
      connectionTimeoutMillis: 10_000,
    });
    try {
      await runtime.connect();
      await expect(
        runtime.query(
          `SELECT singleton FROM "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."host_ownership_fence"`,
        ),
      ).resolves.toMatchObject({ rows: [{ singleton: true }] });
      await expect(
        runtime.query(
          `SELECT singleton FROM "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."host_ownership_fence" WHERE singleton = true FOR SHARE`,
        ),
      ).rejects.toThrow();
      await expect(
        runtime.query(
          `SELECT singleton FROM "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."lock_host_ownership_fence"()`,
        ),
      ).resolves.toMatchObject({ rows: [{ singleton: true }] });
      await runtime.query(
        `INSERT INTO "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" (id, value) VALUES (8, 'dml')`,
      );
      await runtime.query(
        `UPDATE "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" SET value = 'dml-updated' WHERE id = 8`,
      );
      await runtime.query(
        `DELETE FROM "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."${QUALIFICATION_TABLE}" WHERE id = 8`,
      );
      await expect(
        runtime.query(
          `UPDATE "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."host_ownership_fence" SET ownership_revision = ownership_revision + 1`,
        ),
      ).rejects.toThrow();
      await expect(
        runtime.query(
          `CREATE TABLE "${HOST_OWNERSHIP_CANONICAL_DATABASE}"."restricted_table" (value integer)`,
        ),
      ).rejects.toThrow();
      await expect(
        runtime.query("CREATE DATABASE restricted_database"),
      ).rejects.toThrow();
      await expect(runtime.query("CREATE ROLE restricted_role")).rejects.toThrow();
      await expect(
        runtime.query(`SET ROLE "${HOST_OWNERSHIP_OWNER_ROLE}"`),
      ).rejects.toThrow();
      expect(HOST_RUNTIME_ROLE).not.toBe(HOST_LEASE_ROLE);
    } finally {
      await runtime.end().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("rejects stale execution origin before the database fence, then rejects stale Host ownership", async () => {
    const fixture = await createCluster();
    const leaseA = await prepareHostLease(fixture);
    const publishedA = await publish(fixture, leaseA);
    const handleA = makeAuthority(fixture, leaseA, publishedA, false);
    const capturedExecutionA = executionProviderFor(handleA.authority);
    const serviceA = createPersistenceService(
      handleA.authority,
      runtimeOptions(),
      capturedExecutionA,
    );
    let leaseB: Awaited<ReturnType<typeof acquireHostLeaseConnection>> | undefined;
    let serviceB: ReturnType<typeof createPersistenceService> | undefined;
    try {
      await leaseA.close();
      leaseB = await prepareHostLease(fixture);
      const publishedB = await publish(fixture, leaseB);
      const handleB = makeAuthority(fixture, leaseB, publishedB);
      serviceB = createPersistenceService(
        handleB.authority,
        runtimeOptions(),
        capturedExecutionA,
      );

      let staleOriginInvoked = 0;
      await expect(
        serviceB.mutate(async () => {
          staleOriginInvoked += 1;
          return undefined;
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "persistence.execution_context.stale_origin" },
      });
      expect(staleOriginInvoked).toBe(0);

      let staleFenceInvoked = 0;
      await expect(
        serviceA.mutate(async () => {
          staleFenceInvoked += 1;
          return undefined;
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "persistence.host_fence.stale_owner" },
      });
      expect(staleFenceInvoked).toBe(0);
      expect(publishedB.token).not.toBe(publishedA.token);
    } finally {
      await serviceB?.close().catch(() => undefined);
      await serviceA.close().catch(() => undefined);
      await leaseB?.close().catch(() => undefined);
      await leaseA.close().catch(() => undefined);
    }
  }, 120_000);
});
