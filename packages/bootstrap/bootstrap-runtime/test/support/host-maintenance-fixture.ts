// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import {
  BootstrapStateStore,
  type BootstrapStateBodyV1,
} from "@heptalogos/bootstrap-state";
import {
  asContentDigest,
  createInstallationId,
  createInstanceId,
  digestCanonicalJson,
  LIFECYCLE_ROOT_IDS,
  type LifecycleRootId,
} from "@heptalogos/foundation-contracts";
import {
  deriveHostAdvisoryKey,
  inspectHostOwnershipCanonicalSnapshot,
  type BootstrapAdminPasswordProvider,
} from "@heptalogos/host-ownership";
import {
  resolvePrivatePostgresToolchain,
  type PrivatePostgresToolchain,
} from "@heptalogos/private-postgres";
import type {
  BootstrapKeyProvider,
  BootstrapKeyRequestContext,
} from "../../src/bootstrap/key-provider.js";
import {
  type BootstrapManagedHostContext,
  type HostRuntimeRetirement,
} from "../../src/host/managed-host.js";

export const qualifiedPgBin: string =
  process.env.HEPTALOGOS_TEST_PG_BIN ??
  (() => {
    throw new Error(
      "BLOCKED: HEPTALOGOS_TEST_PG_BIN is required for Host maintenance PostgreSQL qualification",
    );
  })();

const execFileAsync = promisify(execFile);
const directories: string[] = [];
export const LIFECYCLE = {
  startupTimeoutMs: 60_000,
  shutdownTimeoutMs: 30_000,
  readinessPollIntervalMs: 100,
} as const;
export const HOST_TIMING = {
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  fenceLockTimeoutMs: 10_000,
  keepAliveInitialDelayMs: 1_000,
} as const;

export async function initializeCanonicalHost({
  authority,
}: {
  readonly authority: { readonly assertCurrent: () => void };
}): Promise<void> {
  authority.assertCurrent();
}

interface Fixture {
  readonly anchorRoot: string;
  readonly roots: Readonly<Record<LifecycleRootId, string>>;
}

function makeState(): BootstrapStateBodyV1 {
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

export async function makeFixture(): Promise<Fixture> {
  const anchorRoot = await mkdtemp(
    join(tmpdir(), "heptalogos-host-maintenance-anchor-"),
  );
  directories.push(anchorRoot);
  const roots = {} as Record<LifecycleRootId, string>;
  for (const id of LIFECYCLE_ROOT_IDS) {
    roots[id] =
      id === "PROGRAM"
        ? anchorRoot
        : await mkdtemp(
            join(tmpdir(), `heptalogos-host-maintenance-${id.toLowerCase()}-`),
          );
    if (id !== "PROGRAM") directories.push(roots[id]);
  }
  await writeFile(
    join(anchorRoot, "heptalogos.bootstrap.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      roots,
    }),
  );
  await new BootstrapStateStore(join(roots.INSTANCE, "bootstrap-state")).commit(
    makeState(),
  );
  return { anchorRoot, roots };
}

export function makeKeyProvider(
  onRequest?: (context: BootstrapKeyRequestContext) => void,
): BootstrapKeyProvider {
  return {
    async withPrivatePostgresBootstrapPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (password: Uint8Array) => Promise<T>,
    ): Promise<T> {
      onRequest?.(_context);
      const password = new TextEncoder().encode(
        "HOST_MAINTENANCE_TEST_BOOTSTRAP_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresHostLeasePassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (password: Uint8Array) => Promise<T>,
    ): Promise<T> {
      onRequest?.(_context);
      const password = new TextEncoder().encode(
        "HOST_MAINTENANCE_TEST_HOST_LEASE_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresRuntimePassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (password: Uint8Array) => Promise<T>,
    ): Promise<T> {
      onRequest?.(_context);
      const password = new TextEncoder().encode(
        "HOST_MAINTENANCE_TEST_RUNTIME_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresMigrationPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (password: Uint8Array) => Promise<T>,
    ): Promise<T> {
      onRequest?.(_context);
      const password = new TextEncoder().encode(
        "HOST_MAINTENANCE_TEST_MIGRATION_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresDurableExecutionPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(
        new TextEncoder().encode(
          "HOST_MAINTENANCE_TEST_DURABLE_EXECUTION_PASSWORD_0123456789",
        ),
      );
    },
  };
}

export function maintenanceRetirement(): HostRuntimeRetirement {
  return {
    async retire() {
      // These scenarios do not compose a product Runtime.
    },
  };
}

export async function hostOwnershipSnapshot(
  host: BootstrapManagedHostContext,
  keyProvider: BootstrapKeyProvider,
  port: number,
): Promise<Awaited<ReturnType<typeof inspectHostOwnershipCanonicalSnapshot>>> {
  const passwordProvider: BootstrapAdminPasswordProvider = {
    withBootstrapPassword(use) {
      return keyProvider.withPrivatePostgresBootstrapPassword(
        {
          installationId: host.installationId,
          instanceId: host.instanceId,
          bootId: host.bootId,
          purpose: "private-postgres-bootstrap-superuser",
        },
        use,
      );
    },
    withHostLeasePassword(use) {
      return keyProvider.withPrivatePostgresHostLeasePassword(
        {
          installationId: host.installationId,
          instanceId: host.instanceId,
          bootId: host.bootId,
          purpose: "private-postgres-host-lease-role",
        },
        use,
      );
    },
    withRuntimePassword(use) {
      return keyProvider.withPrivatePostgresRuntimePassword(
        {
          installationId: host.installationId,
          instanceId: host.instanceId,
          bootId: host.bootId,
          purpose: "private-postgres-runtime-role",
        },
        use,
      );
    },
    withMigrationPassword(use) {
      return keyProvider.withPrivatePostgresMigrationPassword(
        {
          installationId: host.installationId,
          instanceId: host.instanceId,
          bootId: host.bootId,
          purpose: "private-postgres-migration-role",
        },
        use,
      );
    },
    withDurableExecutionPassword(use) {
      return keyProvider.withPrivatePostgresDurableExecutionPassword(
        {
          installationId: host.installationId,
          instanceId: host.instanceId,
          bootId: host.bootId,
          purpose: "private-postgres-durable-execution-role",
        },
        use,
      );
    },
  };
  return inspectHostOwnershipCanonicalSnapshot({
    port,
    passwordProvider,
  });
}

export async function assertReady(
  toolchain: PrivatePostgresToolchain,
  port: number,
): Promise<void> {
  await execFileAsync(toolchain.pgIsReady, [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
  ]);
}

export async function postmasterPid(dataDirectory: string): Promise<string> {
  const contents = await readFile(join(dataDirectory, "postmaster.pid"), "utf8");
  const pid = contents.split("\n", 1)[0]?.trim();
  if (pid === undefined || pid.length === 0) {
    throw new Error("postmaster.pid did not contain a PID");
  }
  return pid;
}

export async function connectBootstrapClient(
  host: BootstrapManagedHostContext,
  keyProvider: BootstrapKeyProvider,
  port: number,
): Promise<Client> {
  let client: Client | undefined;
  await keyProvider.withPrivatePostgresBootstrapPassword(
    {
      installationId: host.installationId,
      instanceId: host.instanceId,
      bootId: host.bootId,
      purpose: "private-postgres-bootstrap-superuser",
    },
    async (passwordUtf8) => {
      const candidate = new Client({
        host: "127.0.0.1",
        port,
        database: "heptalogos",
        user: "heptalogos_bootstrap",
        password: new TextDecoder().decode(passwordUtf8),
        connectionTimeoutMillis: 10_000,
      });
      await candidate.connect();
      client = candidate;
    },
  );
  if (client === undefined) throw new Error("bootstrap admin client was not connected");
  return client;
}

export async function findHostLeaseBackend(
  client: Client,
  instanceId: BootstrapManagedHostContext["instanceId"],
): Promise<number> {
  const key = deriveHostAdvisoryKey(instanceId);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await client.query<{
      readonly pid: number;
      readonly classid: string | null;
      readonly objid: string | null;
    }>(
      `
SELECT activity.pid, locks.classid::text, locks.objid::text
FROM pg_locks AS locks
JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
WHERE locks.locktype = 'advisory'
  AND activity.usename = 'heptalogos_host_lease'
  AND activity.datname = 'heptalogos'
`,
    );
    const asUnsigned = (value: number): number => value >>> 0;
    const matching = result.rows.find(
      (row) =>
        row.classid !== null &&
        row.objid !== null &&
        ((Number(row.classid) === key.key1 && Number(row.objid) === key.key2) ||
          (Number(row.classid) === asUnsigned(key.key1) &&
            Number(row.objid) === asUnsigned(key.key2))),
    );
    const pid = matching?.pid;
    if (pid !== undefined) return pid;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("dedicated Host lease backend was not found");
}

export async function waitForHostLeaseLoss(
  host: BootstrapManagedHostContext,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (host.signal.aborted) return;
    try {
      host.assertActive();
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Host lease did not report loss after backend termination");
}

export async function postmasterStartTime(client: Client): Promise<string> {
  const result = await client.query<{ readonly started_at: string }>(
    "SELECT pg_postmaster_start_time()::text AS started_at",
  );
  const startedAt = result.rows[0]?.started_at;
  if (startedAt === undefined)
    throw new Error("postmaster start time was not returned");
  return startedAt;
}

export async function stopPostgres(
  toolchain: PrivatePostgresToolchain,
  dataDirectory: string,
): Promise<void> {
  try {
    await access(join(dataDirectory, "postmaster.pid"));
  } catch {
    return;
  }
  await execFileAsync(
    toolchain.pgCtl,
    ["stop", "--pgdata", dataDirectory, "--mode=fast", "--wait", "--timeout", "60"],
    { timeout: 70_000 },
  ).catch(() => undefined);
}

export async function getToolchain(): Promise<PrivatePostgresToolchain> {
  return resolvePrivatePostgresToolchain(qualifiedPgBin);
}

export async function cleanupHostMaintenanceFixtures(): Promise<void> {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}
