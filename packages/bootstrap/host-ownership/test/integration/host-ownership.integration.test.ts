// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createServer, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  createBootId,
  createHostOwnershipToken,
  createInstanceId,
  type InstanceId,
} from "@heptalogos/foundation-contracts";
import {
  acquireBootstrapHostReservation,
  acquireHostLeaseConnection,
  deriveHostAdvisoryKey,
  ensureHostOwnershipSchema,
  HOST_DURABLE_EXECUTION_ROLE,
  HOST_LEASE_ROLE,
  HOST_MIGRATION_ROLE,
  HOST_OWNERSHIP_OWNER_ROLE,
  HOST_RUNTIME_ROLE,
  provisionHostOwnershipDatabase,
  publishHostOwnershipToken,
  revokeHostOwnershipTokenForBootstrap,
  type BootstrapAdminPasswordProvider,
  type HostOwnershipTimingOptions,
} from "../../src/index.js";
import {
  resolvePrivatePostgresToolchain,
  type PrivatePostgresToolchain,
} from "@heptalogos/private-postgres";

const qualifiedPgBin: string =
  process.env.HEPTALOGOS_TEST_PG_BIN ??
  (() => {
    throw new Error(
      "BLOCKED: HEPTALOGOS_TEST_PG_BIN is required for Host ownership PostgreSQL qualification",
    );
  })();
let resolvedToolchain: PrivatePostgresToolchain | undefined;

const execFileAsync = promisify(execFile);
const BOOTSTRAP_PASSWORD = "HOST_OWNERSHIP_TEST_BOOTSTRAP_PASSWORD_0123456789";
const HOST_LEASE_PASSWORD = "HOST_OWNERSHIP_TEST_HOST_LEASE_PASSWORD_0123456789";
const RUNTIME_PASSWORD = "HOST_OWNERSHIP_TEST_RUNTIME_PASSWORD_0123456789";
const MIGRATION_PASSWORD = "HOST_OWNERSHIP_TEST_MIGRATION_PASSWORD_0123456789";
const DURABLE_EXECUTION_PASSWORD =
  "HOST_OWNERSHIP_TEST_DURABLE_EXECUTION_PASSWORD_0123456789";
const TIMING: HostOwnershipTimingOptions = {
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  fenceLockTimeoutMs: 10_000,
  keepAliveInitialDelayMs: 1_000,
};
const mutationAuthority = { assertCurrent(): void {} };

interface ClusterFixture {
  readonly root: string;
  readonly dataDirectory: string;
  readonly port: number;
  readonly instanceId: InstanceId;
  readonly provider: BootstrapAdminPasswordProvider;
  readonly stop: () => Promise<void>;
}

const fixtures: ClusterFixture[] = [];

async function runTool(executable: string, args: readonly string[]): Promise<void> {
  await execFileAsync(executable, [...args], {
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function runPgCtl(args: readonly string[]): Promise<void> {
  const toolchain = await getToolchain();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(toolchain.pgCtl, [...args], {
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`pg_ctl exited with code ${String(code)}`));
      }
    });
  });
}

async function getToolchain(): Promise<PrivatePostgresToolchain> {
  resolvedToolchain ??= await resolvePrivatePostgresToolchain(qualifiedPgBin);
  return resolvedToolchain;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function makeProvider(): BootstrapAdminPasswordProvider {
  return {
    async withBootstrapPassword<T>(
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      const password = new TextEncoder().encode(BOOTSTRAP_PASSWORD);
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withHostLeasePassword<T>(
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      const password = new TextEncoder().encode(HOST_LEASE_PASSWORD);
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withRuntimePassword<T>(
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      const password = new TextEncoder().encode(RUNTIME_PASSWORD);
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withMigrationPassword<T>(
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      const password = new TextEncoder().encode(MIGRATION_PASSWORD);
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withDurableExecutionPassword<T>(
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      const password = new TextEncoder().encode(DURABLE_EXECUTION_PASSWORD);
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
  };
}

async function waitUntilReady(port: number): Promise<void> {
  const readyTool = (await getToolchain()).pgIsReady;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      await runTool(readyTool, ["--host", "127.0.0.1", "--port", String(port)]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("PostgreSQL did not become ready within the integration budget");
}

async function createCluster(): Promise<ClusterFixture> {
  const toolchain = await getToolchain();
  const root = await mkdtemp(join(tmpdir(), "heptalogos-host-ownership-pg-"));
  const dataDirectory = join(root, "data");
  const tempDirectory = join(root, "temp");
  const logDirectory = join(root, "log");
  const passwordFile = join(tempDirectory, "bootstrap-password");
  const port = await freePort();
  const instanceId = createInstanceId();
  const provider = makeProvider();
  await Promise.all(
    [dataDirectory, tempDirectory, logDirectory].map((directory) =>
      import("node:fs/promises").then(({ mkdir }) =>
        mkdir(directory, { recursive: true }),
      ),
    ),
  );
  await writeFile(passwordFile, `${BOOTSTRAP_PASSWORD}\n`, { encoding: "utf8" });
  await runTool(toolchain.initdb, [
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
    "# Heptalogos host ownership integration HBA\nhost all all 127.0.0.1/32 scram-sha-256\n",
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
  const fixture: ClusterFixture = {
    root,
    dataDirectory,
    port,
    instanceId,
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
  fixture: ClusterFixture,
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

async function prepareHostLease(fixture: ClusterFixture) {
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
  return acquireHostLeaseConnection({
    target: { host: "127.0.0.1", port: fixture.port, database: "heptalogos" },
    advisoryKey: deriveHostAdvisoryKey(fixture.instanceId),
    timing: TIMING,
    passwordProvider: fixture.provider,
    mutationAuthority,
  });
}

async function publish(
  fixture: ClusterFixture,
  connection: Awaited<ReturnType<typeof acquireHostLeaseConnection>>,
) {
  const token = createHostOwnershipToken();
  const bootId = createBootId();
  await publishHostOwnershipToken({
    connection,
    instanceId: fixture.instanceId,
    bootId,
    token,
    fenceLockTimeoutMs: TIMING.fenceLockTimeoutMs,
    statementTimeoutMs: TIMING.statementTimeoutMs,
    mutationAuthority,
  });
  return { token, bootId };
}

afterEach(async () => {
  await Promise.all(
    fixtures.splice(0).map(async (fixture) => {
      await fixture.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }),
  );
});

describe("Host ownership real PostgreSQL 18.6 qualification", () => {
  it("creates the least-privilege roles, fence, dedicated login, and fresh token", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    try {
      const identity = await lease.query<{
        readonly current_user: string;
        readonly current_database: string;
      }>("SELECT current_user, current_database()");
      expect(identity.rows[0]).toMatchObject({
        current_user: HOST_LEASE_ROLE,
        current_database: "heptalogos",
      });
      const published = await publish(fixture, lease);
      const row = await lease.query<{
        readonly instance_id: string;
        readonly ownership_revision: string;
        readonly host_ownership_token: string;
        readonly boot_id: string;
      }>(
        "SELECT instance_id, ownership_revision, host_ownership_token, boot_id FROM heptalogos.host_ownership_fence WHERE singleton = true",
      );
      expect(row.rows[0]).toMatchObject({
        instance_id: fixture.instanceId,
        ownership_revision: "1",
        host_ownership_token: published.token,
        boot_id: published.bootId,
      });
    } finally {
      await lease.close();
    }
  }, 120_000);

  it("proves the durable role is the fifth database-only protected role", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const admin = await bootstrapClient(fixture);
    const durable = new Client({
      host: "127.0.0.1",
      port: fixture.port,
      database: "heptalogos",
      user: HOST_DURABLE_EXECUTION_ROLE,
      password: DURABLE_EXECUTION_PASSWORD,
      connectionTimeoutMillis: 10_000,
    });
    try {
      const roles = await admin.query<{
        readonly rolname: string;
        readonly rolcanlogin: boolean;
        readonly rolsuper: boolean;
        readonly rolcreatedb: boolean;
        readonly rolcreaterole: boolean;
        readonly rolreplication: boolean;
        readonly rolbypassrls: boolean;
        readonly rolconnlimit: number;
        readonly rolinherit: boolean;
      }>(
        `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
                rolreplication, rolbypassrls, rolconnlimit, rolinherit
         FROM pg_catalog.pg_roles
         WHERE rolname IN ($1, $2, $3, $4, $5)
         ORDER BY rolname`,
        [
          HOST_OWNERSHIP_OWNER_ROLE,
          HOST_LEASE_ROLE,
          HOST_RUNTIME_ROLE,
          HOST_MIGRATION_ROLE,
          HOST_DURABLE_EXECUTION_ROLE,
        ],
      );
      expect(roles.rows).toHaveLength(5);
      expect(roles.rows.map((role) => role.rolname)).toEqual(
        [
          HOST_DURABLE_EXECUTION_ROLE,
          HOST_LEASE_ROLE,
          HOST_MIGRATION_ROLE,
          HOST_OWNERSHIP_OWNER_ROLE,
          HOST_RUNTIME_ROLE,
        ].sort(),
      );
      expect(
        roles.rows.find((role) => role.rolname === HOST_DURABLE_EXECUTION_ROLE),
      ).toEqual({
        rolname: HOST_DURABLE_EXECUTION_ROLE,
        rolcanlogin: true,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        rolconnlimit: -1,
        rolinherit: true,
      });

      const memberships = await admin.query(
        `SELECT member.rolname AS member_role,
                granted_role.rolname AS granted_role
         FROM pg_catalog.pg_auth_members AS memberships
         JOIN pg_catalog.pg_roles AS member ON member.oid = memberships.member
         JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = memberships.roleid
         WHERE member.rolname = $1 OR granted_role.rolname = $1`,
        [HOST_DURABLE_EXECUTION_ROLE],
      );
      expect(memberships.rows).toEqual([]);

      await durable.connect();
      await expect(durable.query("SELECT current_user")).resolves.toMatchObject({
        rows: [{ current_user: HOST_DURABLE_EXECUTION_ROLE }],
      });
      await expect(
        durable.query("SELECT singleton FROM heptalogos.host_ownership_fence"),
      ).rejects.toThrow();
      await expect(
        durable.query("CREATE TABLE heptalogos.durable_forbidden (value integer)"),
      ).rejects.toThrow();
      await expect(
        durable.query(`SET ROLE "${HOST_OWNERSHIP_OWNER_ROLE}"`),
      ).rejects.toThrow();
    } finally {
      await durable.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("proves the runtime role privilege closure", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const admin = await bootstrapClient(fixture);
    const runtime = new Client({
      host: "127.0.0.1",
      port: fixture.port,
      database: "heptalogos",
      user: HOST_RUNTIME_ROLE,
      password: RUNTIME_PASSWORD,
      connectionTimeoutMillis: 10_000,
    });
    try {
      await runtime.connect();
      const role = await admin.query<{
        readonly rolname: string;
        readonly rolcanlogin: boolean;
        readonly rolsuper: boolean;
        readonly rolcreatedb: boolean;
        readonly rolcreaterole: boolean;
        readonly rolreplication: boolean;
        readonly rolbypassrls: boolean;
        readonly rolconnlimit: number;
        readonly rolinherit: boolean;
      }>(
        `SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
                rolreplication, rolbypassrls, rolconnlimit, rolinherit
         FROM pg_catalog.pg_roles WHERE rolname = $1`,
        [HOST_RUNTIME_ROLE],
      );
      expect(role.rows).toHaveLength(1);
      expect(role.rows[0]).toEqual({
        rolname: HOST_RUNTIME_ROLE,
        rolcanlogin: true,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        rolconnlimit: -1,
        rolinherit: false,
      });

      await expect(
        runtime.query("SELECT singleton FROM heptalogos.host_ownership_fence"),
      ).resolves.toMatchObject({ rows: [{ singleton: true }] });
      await expect(
        runtime.query(
          "UPDATE heptalogos.host_ownership_fence SET ownership_revision = ownership_revision + 1",
        ),
      ).rejects.toThrow();
      await expect(
        runtime.query("CREATE TABLE heptalogos.runtime_forbidden (value integer)"),
      ).rejects.toThrow();
      await expect(
        runtime.query("CREATE DATABASE runtime_forbidden_database"),
      ).rejects.toThrow();
      await expect(
        runtime.query("CREATE ROLE runtime_forbidden_role"),
      ).rejects.toThrow();
      await expect(
        runtime.query(`SET ROLE "${HOST_OWNERSHIP_OWNER_ROLE}"`),
      ).rejects.toThrow();
    } finally {
      await runtime.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("proves migration can assume owner while runtime cannot", async () => {
    const fixture = await createCluster();
    await provisionHostOwnershipDatabase({
      port: fixture.port,
      passwordProvider: fixture.provider,
      mutationAuthority,
    });
    const admin = await bootstrapClient(fixture);
    const migration = new Client({
      host: "127.0.0.1",
      port: fixture.port,
      database: "heptalogos",
      user: HOST_MIGRATION_ROLE,
      password: MIGRATION_PASSWORD,
      connectionTimeoutMillis: 10_000,
    });
    const runtime = new Client({
      host: "127.0.0.1",
      port: fixture.port,
      database: "heptalogos",
      user: HOST_RUNTIME_ROLE,
      password: RUNTIME_PASSWORD,
      connectionTimeoutMillis: 10_000,
    });
    try {
      await migration.connect();
      await runtime.connect();
      await expect(
        migration.query("SELECT session_user, current_user"),
      ).resolves.toMatchObject({
        rows: [
          { session_user: HOST_MIGRATION_ROLE, current_user: HOST_MIGRATION_ROLE },
        ],
      });
      await migration.query(`SET ROLE "${HOST_OWNERSHIP_OWNER_ROLE}"`);
      await expect(migration.query("SELECT current_user")).resolves.toMatchObject({
        rows: [{ current_user: HOST_OWNERSHIP_OWNER_ROLE }],
      });
      await expect(
        runtime.query(`SET ROLE "${HOST_OWNERSHIP_OWNER_ROLE}"`),
      ).rejects.toThrow();
      await expect(
        runtime.query(`SET ROLE "${HOST_MIGRATION_ROLE}"`),
      ).rejects.toThrow();

      const memberships = await admin.query<{
        readonly member_role: string;
        readonly granted_role: string;
        readonly admin_option: boolean;
        readonly inherit_option: boolean;
        readonly set_option: boolean;
      }>(
        `SELECT member.rolname AS member_role,
                granted_role.rolname AS granted_role,
                memberships.admin_option,
                memberships.inherit_option,
                memberships.set_option
         FROM pg_catalog.pg_auth_members AS memberships
         JOIN pg_catalog.pg_roles AS member ON member.oid = memberships.member
         JOIN pg_catalog.pg_roles AS granted_role ON granted_role.oid = memberships.roleid
         WHERE member.rolname = $1`,
        [HOST_MIGRATION_ROLE],
      );
      expect(memberships.rows).toEqual([
        {
          member_role: HOST_MIGRATION_ROLE,
          granted_role: HOST_OWNERSHIP_OWNER_ROLE,
          admin_option: false,
          inherit_option: false,
          set_option: true,
        },
      ]);
    } finally {
      await migration.end().catch(() => undefined);
      await runtime.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
    }
  }, 120_000);

  it("confines the Host lease role and rejects a second Host reservation", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const secondClient = new Client({
      host: "127.0.0.1",
      port: fixture.port,
      database: "heptalogos",
      user: HOST_LEASE_ROLE,
      password: HOST_LEASE_PASSWORD,
    });
    try {
      await expect(
        acquireBootstrapHostReservation({
          port: fixture.port,
          advisoryKey: deriveHostAdvisoryKey(fixture.instanceId),
          passwordProvider: fixture.provider,
          mutationAuthority,
        }),
      ).resolves.toBeUndefined();
      await expect(
        acquireHostLeaseConnection({
          target: { host: "127.0.0.1", port: fixture.port, database: "heptalogos" },
          advisoryKey: deriveHostAdvisoryKey(fixture.instanceId),
          timing: TIMING,
          passwordProvider: fixture.provider,
          mutationAuthority,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "host-ownership.lease.connection_failed" },
      });

      await lease.close();
      await secondClient.connect();
      await expect(
        secondClient.query("CREATE DATABASE host_ownership_forbidden_database"),
      ).rejects.toThrow();
      await expect(
        secondClient.query("CREATE ROLE host_ownership_forbidden_role"),
      ).rejects.toThrow();
      await expect(
        secondClient.query("CREATE SCHEMA host_ownership_forbidden_schema"),
      ).rejects.toThrow();
      await expect(
        secondClient.query(
          "CREATE TABLE public.host_ownership_forbidden_table (value integer)",
        ),
      ).rejects.toThrow();
      await expect(
        secondClient.query(
          "ALTER TABLE heptalogos.host_ownership_fence ADD COLUMN host_ownership_forbidden integer",
        ),
      ).rejects.toThrow();
      await expect(
        secondClient.query(
          "INSERT INTO heptalogos.host_ownership_fence VALUES (false, $1, 0, NULL, NULL)",
          [fixture.instanceId],
        ),
      ).rejects.toThrow();
      await expect(
        secondClient.query("DELETE FROM heptalogos.host_ownership_fence"),
      ).rejects.toThrow();
    } finally {
      await secondClient.end().catch(() => undefined);
      await lease.close();
    }
  }, 120_000);

  it("serializes an entered old transaction before a new token and rejects stale mutation", async () => {
    const fixture = await createCluster();
    const leaseA = await prepareHostLease(fixture);
    const transaction = await bootstrapClient(fixture, "heptalogos");
    let leaseB: Awaited<ReturnType<typeof acquireHostLeaseConnection>> | undefined;
    try {
      const publishedA = await publish(fixture, leaseA);
      await transaction.query("BEGIN");
      const shared = await transaction.query<{ readonly host_ownership_token: string }>(
        "SELECT host_ownership_token FROM heptalogos.host_ownership_fence WHERE singleton = true FOR SHARE",
      );
      expect(shared.rows[0]?.host_ownership_token).toBe(publishedA.token);
      await leaseA.close();

      leaseB = await prepareHostLease(fixture);
      const publishedBPromise = publish(fixture, leaseB);
      let completedBeforeCommit = false;
      void publishedBPromise.then(() => {
        completedBeforeCommit = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(completedBeforeCommit).toBe(false);
      await transaction.query("COMMIT");
      const publishedB = await publishedBPromise;
      expect(publishedB.token).not.toBe(publishedA.token);

      const stale = await transaction.query<{ readonly ownership_revision: string }>(
        "UPDATE heptalogos.host_ownership_fence SET ownership_revision = ownership_revision + 1 WHERE singleton = true AND host_ownership_token = $1 RETURNING ownership_revision",
        [publishedA.token],
      );
      expect(stale.rows).toHaveLength(0);
    } finally {
      await transaction.query("ROLLBACK").catch(() => undefined);
      await transaction.end().catch(() => undefined);
      await leaseB?.close().catch(() => undefined);
      await leaseA.close().catch(() => undefined);
    }
  }, 120_000);

  it("blocks bootstrap-admin revocation behind an entered FOR SHARE transaction", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const transaction = await bootstrapClient(fixture, "heptalogos");
    try {
      const published = await publish(fixture, lease);
      await transaction.query("BEGIN");
      const shared = await transaction.query<{
        readonly host_ownership_token: string;
      }>(
        "SELECT host_ownership_token FROM heptalogos.host_ownership_fence WHERE singleton = true FOR SHARE",
      );
      expect(shared.rows[0]?.host_ownership_token).toBe(published.token);

      const revocation = revokeHostOwnershipTokenForBootstrap({
        port: fixture.port,
        instanceId: fixture.instanceId,
        bootId: published.bootId,
        token: published.token,
        lockTimeoutMs: TIMING.fenceLockTimeoutMs,
        statementTimeoutMs: TIMING.statementTimeoutMs,
        passwordProvider: fixture.provider,
        mutationAuthority,
      });
      let completedBeforeCommit = false;
      void revocation.then(() => {
        completedBeforeCommit = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(completedBeforeCommit).toBe(false);

      await transaction.query("COMMIT");
      await expect(revocation).resolves.toMatchObject({
        previousRevision: "1",
        revokedRevision: "2",
      });
    } finally {
      await transaction.query("ROLLBACK").catch(() => undefined);
      await transaction.end().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("fences the Host context when its dedicated PostgreSQL session is terminated", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const admin = await bootstrapClient(fixture, "heptalogos");
    try {
      await publish(fixture, lease);
      const pidRow = await lease.query<{ readonly pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await admin.query("SELECT pg_terminate_backend($1)", [pidRow.rows[0]?.pid]);
      const deadline = Date.now() + 10_000;
      while (!lease.signal.aborted && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(lease.state).toBe("FENCED");
      expect(lease.signal.aborted).toBe(true);
    } finally {
      await admin.end().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("keeps the Host password out of the stored verifier and PostgreSQL log", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const admin = await bootstrapClient(fixture, "postgres");
    try {
      const verifier = await admin.query<{ readonly rolpassword: string }>(
        "SELECT rolpassword FROM pg_authid WHERE rolname = $1",
        [HOST_LEASE_ROLE],
      );
      expect(verifier.rows[0]?.rolpassword).toBeTruthy();
      expect(verifier.rows[0]?.rolpassword).not.toContain(HOST_LEASE_PASSWORD);
      expect(
        await readFile(join(fixture.root, "log", "postgres.log"), "utf8"),
      ).not.toContain(HOST_LEASE_PASSWORD);
    } finally {
      await admin.end().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("rejects adversarial ACL and protected-role membership edges", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const admin = await bootstrapClient(fixture, "postgres");
    let ownershipAdmin: Client | undefined;
    const intruder = "host_ownership_intruder";
    try {
      ownershipAdmin = await bootstrapClient(fixture, "heptalogos");
      const published = await publish(fixture, lease);
      const before = await lease.query<{
        readonly ownership_revision: string;
        readonly host_ownership_token: string;
      }>(
        "SELECT ownership_revision, host_ownership_token FROM heptalogos.host_ownership_fence WHERE singleton = true",
      );
      await admin.query(`CREATE ROLE "${intruder}" NOLOGIN`);
      await ownershipAdmin.query(
        `GRANT UPDATE ON TABLE heptalogos.host_ownership_fence TO "${intruder}"`,
      );
      await expect(
        ensureHostOwnershipSchema({
          port: fixture.port,
          instanceId: fixture.instanceId,
          passwordProvider: fixture.provider,
          mutationAuthority,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "host-ownership.schema.incompatible" },
      });
      const afterAclAttack = await lease.query<{
        readonly ownership_revision: string;
        readonly host_ownership_token: string;
      }>(
        "SELECT ownership_revision, host_ownership_token FROM heptalogos.host_ownership_fence WHERE singleton = true",
      );
      expect(afterAclAttack.rows[0]).toEqual(before.rows[0]);
      expect(afterAclAttack.rows[0]?.host_ownership_token).toBe(published.token);

      await ownershipAdmin.query(
        `REVOKE UPDATE ON TABLE heptalogos.host_ownership_fence FROM "${intruder}"`,
      );
      for (const protectedRole of [HOST_OWNERSHIP_OWNER_ROLE, HOST_LEASE_ROLE]) {
        await admin.query(`GRANT "${protectedRole}" TO "${intruder}"`);
        await expect(
          provisionHostOwnershipDatabase({
            port: fixture.port,
            passwordProvider: fixture.provider,
            mutationAuthority,
          }),
        ).rejects.toMatchObject({
          problem: {
            problemCode: "host-ownership.bootstrap_admin.incompatible_role",
          },
        });
        await admin.query(`REVOKE "${protectedRole}" FROM "${intruder}"`);
      }
    } finally {
      await admin.query(`DROP ROLE IF EXISTS "${intruder}"`).catch(() => undefined);
      await ownershipAdmin?.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);

  it("rejects grant options and column-specific ACL edges", async () => {
    const fixture = await createCluster();
    const lease = await prepareHostLease(fixture);
    const admin = await bootstrapClient(fixture, "postgres");
    const ownershipAdmin = await bootstrapClient(fixture, "heptalogos");
    const intruder = "host_ownership_intruder";
    try {
      await publish(fixture, lease);
      await admin.query(`CREATE ROLE "${intruder}" NOLOGIN`);

      await ownershipAdmin.query(
        `GRANT UPDATE ON TABLE heptalogos.host_ownership_fence TO "${HOST_LEASE_ROLE}" WITH GRANT OPTION`,
      );
      await expect(
        ensureHostOwnershipSchema({
          port: fixture.port,
          instanceId: fixture.instanceId,
          passwordProvider: fixture.provider,
          mutationAuthority,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "host-ownership.schema.incompatible" },
      });

      await ownershipAdmin.query(
        `REVOKE ALL ON TABLE heptalogos.host_ownership_fence FROM "${HOST_LEASE_ROLE}"`,
      );
      await ownershipAdmin.query(
        `GRANT INSERT (instance_id) ON TABLE heptalogos.host_ownership_fence TO "${HOST_LEASE_ROLE}"`,
      );
      await expect(
        ensureHostOwnershipSchema({
          port: fixture.port,
          instanceId: fixture.instanceId,
          passwordProvider: fixture.provider,
          mutationAuthority,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "host-ownership.schema.incompatible" },
      });

      await ownershipAdmin.query(
        `REVOKE ALL (instance_id) ON TABLE heptalogos.host_ownership_fence FROM "${HOST_LEASE_ROLE}"`,
      );
      await ownershipAdmin.query(
        `GRANT UPDATE (host_ownership_token) ON TABLE heptalogos.host_ownership_fence TO "${intruder}"`,
      );
      await expect(
        ensureHostOwnershipSchema({
          port: fixture.port,
          instanceId: fixture.instanceId,
          passwordProvider: fixture.provider,
          mutationAuthority,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "host-ownership.schema.incompatible" },
      });
    } finally {
      await ownershipAdmin
        .query(
          `REVOKE ALL (host_ownership_token) ON TABLE heptalogos.host_ownership_fence FROM "${intruder}"`,
        )
        .catch(() => undefined);
      await admin.query(`DROP ROLE IF EXISTS "${intruder}"`).catch(() => undefined);
      await ownershipAdmin.end().catch(() => undefined);
      await admin.end().catch(() => undefined);
      await lease.close().catch(() => undefined);
    }
  }, 120_000);
});
