// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  runPostgresToolMock,
  classifyClusterDirectoryMock,
  inspectPrivatePostgresClusterMock,
  writeCanonicalPrivatePostgresRuntimeProfileMock,
} = vi.hoisted(() => ({
  runPostgresToolMock: vi.fn(),
  classifyClusterDirectoryMock: vi.fn(),
  inspectPrivatePostgresClusterMock: vi.fn(),
  writeCanonicalPrivatePostgresRuntimeProfileMock: vi.fn(),
}));

vi.mock("../../src/process-adapter.js", () => ({
  runPostgresTool: runPostgresToolMock,
}));

vi.mock("../../src/cluster-layout.js", () => ({
  classifyClusterDirectory: classifyClusterDirectoryMock,
}));

vi.mock("../../src/cluster-inspection.js", () => ({
  inspectPrivatePostgresCluster: inspectPrivatePostgresClusterMock,
}));

vi.mock("../../src/runtime-profile.js", () => ({
  createCanonicalHbaProfile: vi.fn(),
  inspectEffectivePrivatePostgresProfile: vi.fn(),
  readCanonicalHbaProfile: vi.fn(),
  writeCanonicalPrivatePostgresRuntimeProfile:
    writeCanonicalPrivatePostgresRuntimeProfileMock,
}));

const {
  createPrivatePostgresInitializationProfileRevision,
  initializePrivatePostgresCluster,
} = await import("../../src/controller.js");
const { PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME } = await import("../../src/contracts.js");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  runPostgresToolMock.mockReset();
  classifyClusterDirectoryMock.mockReset();
  inspectPrivatePostgresClusterMock.mockReset();
  writeCanonicalPrivatePostgresRuntimeProfileMock.mockReset();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("private PostgreSQL initialization identity", () => {
  it("passes the fixed bootstrap role to initdb and returns it in cluster identity", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-controller-"));
    const tempRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-controller-"));
    temporaryDirectories.push(dataRoot, tempRoot);
    const dataDirectory = join(dataRoot, "private-postgres");
    const toolchain = {
      version: "18.6" as const,
      major: 18 as const,
      binDirectory: dataRoot,
      postgres: join(dataRoot, "postgres.exe"),
      initdb: join(dataRoot, "initdb.exe"),
      pgCtl: join(dataRoot, "pg_ctl.exe"),
      pgControldata: join(dataRoot, "pg_controldata.exe"),
      pgIsReady: join(dataRoot, "pg_isready.exe"),
    };
    const placement = {
      rootId: "DATA" as const,
      relativePath: "private-postgres" as const,
      dataLayoutVersion: 1 as const,
      canonicalDataDirectory: dataDirectory,
    };
    classifyClusterDirectoryMock.mockResolvedValue({ kind: "ABSENT" });
    runPostgresToolMock.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    inspectPrivatePostgresClusterMock.mockResolvedValue({
      postgresMajor: 18,
      clusterSystemIdentifier: "123456789",
      databaseClusterState: "shut down",
      catalogVersionNumber: "202507181",
      dataPageChecksumVersion: 1,
    });

    const result = await initializePrivatePostgresCluster({
      toolchain,
      placement,
      credentialTempRoot: tempRoot,
      bootstrapPasswordUtf8: new TextEncoder().encode("controller-test-password"),
      port: 55432,
      lifecycle: {
        startupTimeoutMs: 10_000,
        shutdownTimeoutMs: 10_000,
        readinessPollIntervalMs: 100,
      },
      assertControlAuthority: () => undefined,
    });

    const initdbCall = runPostgresToolMock.mock.calls.find(
      ([executable]) => executable === toolchain.initdb,
    );
    expect(initdbCall).toBeDefined();
    const initdbArgs = initdbCall?.[1] as readonly string[];
    expect(initdbArgs).toContain(`--username=${PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME}`);
    expect(result.identity.bootstrapRoleName).toBe(
      PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME,
    );
    expect(result.initializationProfileRevision).toBe(
      createPrivatePostgresInitializationProfileRevision(55432),
    );
  });
});
