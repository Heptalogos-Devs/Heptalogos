// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "pg";
import { expect } from "vitest";
import { createCanonicalSchemaInitializer } from "@heptalogos/canonical-schema";
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
  HOST_OWNERSHIP_CANONICAL_DATABASE,
  type HostOwnershipTimingOptions,
} from "@heptalogos/host-ownership";
import {
  resolvePrivatePostgresToolchain,
  type PrivatePostgresToolchain,
} from "@heptalogos/private-postgres";
import type {
  BootstrapKeyProvider,
  BootstrapKeyRequestContext,
} from "../../../packages/bootstrap/bootstrap-runtime/dist/bootstrap/key-provider.js";
import { prepareBootstrapPrelude } from "../../../packages/bootstrap/bootstrap-runtime/dist/bootstrap/prelude.js";
import type { BootstrapManagedHostContext } from "../../../packages/bootstrap/bootstrap-runtime/dist/host/managed-host.js";

export const qualifiedPgBin = process.env.HEPTALOGOS_TEST_PG_BIN;
export const describeRealPostgres = qualifiedPgBin === undefined ? undefined : true;
const execFileAsync = promisify(execFile);
const directories: string[] = [];
const postgresDataDirectories: string[] = [];
const LIFECYCLE = {
  startupTimeoutMs: 60_000,
  shutdownTimeoutMs: 30_000,
  readinessPollIntervalMs: 100,
} as const;
export const HOST_TIMING: HostOwnershipTimingOptions = {
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  fenceLockTimeoutMs: 10_000,
  keepAliveInitialDelayMs: 1_000,
};
export const CANONICAL_OPTIONS = {
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  lockTimeoutMs: 10_000,
  idleInTransactionSessionTimeoutMs: 30_000,
  onBackgroundError() {},
} as const;
export const BOOTSTRAP_PASSWORD = "CANONICAL_PG_TEST_BOOTSTRAP_PASSWORD_0123456789";
const HOST_LEASE_PASSWORD = "CANONICAL_PG_TEST_HOST_LEASE_PASSWORD_0123456789";
export const RUNTIME_PASSWORD = "CANONICAL_PG_TEST_RUNTIME_PASSWORD_0123456789";
export const MIGRATION_PASSWORD = "CANONICAL_PG_TEST_MIGRATION_PASSWORD_0123456789";
export const DURABLE_EXECUTION_PASSWORD =
  "CANONICAL_PG_TEST_DURABLE_EXECUTION_PASSWORD_0123456789";

export interface Fixture {
  readonly anchorRoot: string;
  readonly roots: Readonly<Record<LifecycleRootId, string>>;
  readonly installationId: ReturnType<typeof createInstallationId>;
  readonly instanceId: ReturnType<typeof createInstanceId>;
  readonly port: number;
}

type OwnedPrelude = Awaited<
  ReturnType<Awaited<ReturnType<typeof prepareBootstrapPrelude>>["acquireOwnership"]>
>;
type ReadyPostgres = Awaited<ReturnType<OwnedPrelude["preparePrivatePostgres"]>>;

export interface BootResult {
  readonly fixture: Fixture;
  readonly owned: OwnedPrelude;
  readonly ready: ReadyPostgres;
  readonly host: BootstrapManagedHostContext;
  readonly epoch: BootstrapStateBodyV1["continuityEpochId"];
}

function selection() {
  return {
    activeBootstrapRuntimeGeneration: asContentDigest(
      "BootstrapRuntimeGenerationId",
      digestCanonicalJson("test.bootstrap-runtime/v1", { generation: "bootstrap" }),
    ),
    activeProductGeneration: asContentDigest(
      "ProductGenerationId",
      digestCanonicalJson("test.product-generation/v1", { generation: "product" }),
    ),
  } as const;
}

export function makeKeyProvider(): BootstrapKeyProvider {
  return {
    async withPrivatePostgresBootstrapPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(new TextEncoder().encode(BOOTSTRAP_PASSWORD));
    },
    async withPrivatePostgresHostLeasePassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(new TextEncoder().encode(HOST_LEASE_PASSWORD));
    },
    async withPrivatePostgresRuntimePassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(new TextEncoder().encode(RUNTIME_PASSWORD));
    },
    async withPrivatePostgresMigrationPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(new TextEncoder().encode(MIGRATION_PASSWORD));
    },
    async withPrivatePostgresDurableExecutionPassword<T>(
      _context: BootstrapKeyRequestContext,
      use: (passwordUtf8: Uint8Array) => Promise<T>,
    ): Promise<T> {
      return use(new TextEncoder().encode(DURABLE_EXECUTION_PASSWORD));
    },
  };
}

async function freePort(): Promise<number> {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("could not allocate a PostgreSQL test port");
  }
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

export async function makeFixture(): Promise<Fixture> {
  const anchorRoot = await mkdtemp(
    join(tmpdir(), "heptalogos-canonical-postgres-anchor-"),
  );
  directories.push(anchorRoot);
  const roots = {} as Record<LifecycleRootId, string>;
  for (const id of LIFECYCLE_ROOT_IDS) {
    roots[id] =
      id === "PROGRAM"
        ? anchorRoot
        : await mkdtemp(
            join(tmpdir(), `heptalogos-canonical-postgres-${id.toLowerCase()}-`),
          );
    if (id !== "PROGRAM") directories.push(roots[id]);
  }
  const installationId = createInstallationId();
  const instanceId = createInstanceId();
  await writeFile(
    join(anchorRoot, "heptalogos.bootstrap.json"),
    JSON.stringify({ schemaVersion: 1, installationId, instanceId, roots }),
  );
  return { anchorRoot, roots, installationId, instanceId, port: await freePort() };
}

async function stopCluster(
  toolchain: PrivatePostgresToolchain,
  dataDirectory: string,
): Promise<void> {
  await execFileAsync(
    toolchain.pgCtl,
    ["stop", "--pgdata", dataDirectory, "--mode=fast", "--wait", "--timeout", "60"],
    { windowsHide: true, timeout: 120_000 },
  ).catch(() => undefined);
}

export async function prepareOwned(fixture: Fixture) {
  if (qualifiedPgBin === undefined)
    throw new Error("HEPTALOGOS_TEST_PG_BIN is required");
  const prepared = await prepareBootstrapPrelude(fixture.anchorRoot);
  const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
  const state = await owned.ensureBootstrapStateInitialized(selection());
  const ready = await owned.preparePrivatePostgres({
    toolchainBinDirectory: qualifiedPgBin,
    initialPort: fixture.port,
    lifecycle: LIFECYCLE,
    keyProvider: makeKeyProvider(),
  });
  postgresDataDirectories.push(join(fixture.roots.DATA, "private-postgres"));
  return { prepared, owned, ready, epoch: state.state.continuityEpochId };
}

export async function boot(
  fixture: Fixture,
  initializeCanonicalHost = createCanonicalSchemaInitializer(CANONICAL_OPTIONS),
): Promise<BootResult> {
  const prepared = await prepareOwned(fixture);
  const host = await prepared.owned.handoffPrivatePostgresToHost(prepared.ready, {
    initializeCanonicalHost,
    keyProvider: makeKeyProvider(),
    timing: HOST_TIMING,
  });
  return {
    fixture,
    owned: prepared.owned,
    ready: prepared.ready,
    host,
    epoch: prepared.epoch,
  };
}

export async function stopManagedHostWithoutRuntime(
  host: BootstrapManagedHostContext,
): Promise<void> {
  if (host.state !== "ACTIVE") return;
  const maintenance = await host.preparePrivatePostgresMaintenance({
    kind: "STOP_PRIVATE_POSTGRES",
  });
  await maintenance.execute({
    async retire() {
      // The caller owns no product Runtime composition in this helper.
    },
  });
}

/** Stops the fixture PostgreSQL cluster after a child process was killed. */
export async function stopFixturePrivatePostgres(fixture: Fixture): Promise<void> {
  if (qualifiedPgBin === undefined) return;
  const toolchain = await resolvePrivatePostgresToolchain(qualifiedPgBin);
  await stopCluster(toolchain, join(fixture.roots.DATA, "private-postgres"));
}

export async function queryAs(
  fixture: Fixture,
  user: string,
  password: string,
  text: string,
  values: readonly unknown[] = [],
  options?: string,
): Promise<{ readonly rows: readonly Record<string, unknown>[] }> {
  const client = new Client({
    host: "127.0.0.1",
    port: fixture.port,
    database: HOST_OWNERSHIP_CANONICAL_DATABASE,
    user,
    password,
    options,
  });
  try {
    await client.connect();
    return await client.query<Record<string, unknown>>(text, [...values]);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function expectQueryDenied(
  fixture: Fixture,
  user: string,
  password: string,
  text: string,
  values: readonly unknown[] = [],
): Promise<void> {
  await expect(queryAs(fixture, user, password, text, values)).rejects.toBeDefined();
}

export async function mutateAsBootstrap(
  fixture: Fixture,
  text: string,
  values: readonly unknown[] = [],
): Promise<void> {
  await queryAs(fixture, "heptalogos_bootstrap", BOOTSTRAP_PASSWORD, text, values);
}

export async function currentState(fixture: Fixture) {
  return new BootstrapStateStore(
    join(fixture.roots.INSTANCE, "bootstrap-state"),
  ).load();
}

export async function cleanupCanonicalPostgresFixtures(): Promise<void> {
  const toolchain =
    qualifiedPgBin === undefined
      ? undefined
      : await resolvePrivatePostgresToolchain(qualifiedPgBin);
  if (toolchain !== undefined) {
    await Promise.all(
      postgresDataDirectories
        .splice(0)
        .map((directory) => stopCluster(toolchain, directory)),
    );
  }
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
}
