// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createInstallationId,
  createInstanceId,
  ProblemError,
} from "@heptalogos/foundation-contracts";
import { PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME } from "../../src/contracts.js";
import type {
  PrivatePostgresExpectedIdentity,
  PrivatePostgresToolchain,
} from "../../src/contracts.js";

const { runPostgresToolMock } = vi.hoisted(() => ({
  runPostgresToolMock: vi.fn(),
}));

vi.mock("../../src/process-adapter.js", () => ({
  runPostgresTool: runPostgresToolMock,
}));

const {
  createPrivatePostgresInitializationProfileRevision,
  startPrivatePostgresCluster,
} = await import("../../src/controller.js");

async function makeLifecycleFixture(port: number): Promise<{
  readonly root: string;
  readonly dataDirectory: string;
  readonly toolchain: PrivatePostgresToolchain;
  readonly placement: {
    readonly rootId: "DATA";
    readonly relativePath: "private-postgres";
    readonly dataLayoutVersion: 1;
    readonly canonicalDataDirectory: string;
  };
  readonly expectedIdentity: PrivatePostgresExpectedIdentity;
  readonly logFilePath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-pg-lifecycle-unit-"));
  const dataDirectory = join(root, "private-postgres");
  const logFilePath = join(root, "private-postgres.log");
  const toolchain: PrivatePostgresToolchain = {
    version: "18.6",
    major: 18,
    binDirectory: root,
    postgres: join(root, "postgres.exe"),
    initdb: join(root, "initdb.exe"),
    pgCtl: join(root, "pg_ctl.exe"),
    pgControldata: join(root, "pg_controldata.exe"),
    pgIsReady: join(root, "pg_isready.exe"),
  };
  const placement = {
    rootId: "DATA" as const,
    relativePath: "private-postgres" as const,
    dataLayoutVersion: 1 as const,
    canonicalDataDirectory: dataDirectory,
  };
  const expectedIdentity: PrivatePostgresExpectedIdentity = {
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    postgresMajor: 18,
    bootstrapRoleName: PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME,
    placement: {
      rootId: placement.rootId,
      relativePath: placement.relativePath,
      dataLayoutVersion: placement.dataLayoutVersion,
    },
    persistedPort: port,
    clusterSystemIdentifier: "123456789",
    initializationProfileRevision:
      createPrivatePostgresInitializationProfileRevision(port),
  };

  await mkdir(dataDirectory, { recursive: true });
  await writeFile(join(dataDirectory, "PG_VERSION"), "18\n");
  await writeFile(
    join(dataDirectory, "pg_hba.conf"),
    "# Heptalogos private PostgreSQL HBA profile v1\nhost all all 127.0.0.1/32 scram-sha-256\n",
  );
  return {
    root,
    dataDirectory,
    toolchain,
    placement,
    expectedIdentity,
    logFilePath,
  };
}

function timeoutProblem(detail: string): ProblemError {
  return new ProblemError({
    schemaVersion: 1,
    problemCode: "private-postgres.process.timed_out",
    category: "unavailable",
    retryClass: "backoff",
    title: "PostgreSQL tool invocation timed out",
    detail,
  });
}

function configureLifecycleMock(
  fixture: Awaited<ReturnType<typeof makeLifecycleFixture>>,
  options: {
    readonly statusExitCodes: number[];
    readonly startError?: ProblemError;
    readonly restartError?: ProblemError;
  },
): { readonly stopCalls: number[] } {
  const statusExitCodes = [...options.statusExitCodes];
  const stopCalls: number[] = [];
  runPostgresToolMock.mockImplementation(
    async (executable: string, args: readonly string[]) => {
      if (executable === fixture.toolchain.pgCtl && args[0] === "start") {
        if (options.startError) throw options.startError;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (executable === fixture.toolchain.pgCtl && args[0] === "restart") {
        if (options.restartError) throw options.restartError;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (executable === fixture.toolchain.pgCtl && args[0] === "status") {
        return {
          exitCode: statusExitCodes.shift() ?? 3,
          stdout: "",
          stderr: "",
        };
      }
      if (executable === fixture.toolchain.pgCtl && args[0] === "stop") {
        stopCalls.push(1);
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (executable === fixture.toolchain.pgControldata) {
        return {
          exitCode: 0,
          stdout:
            "Database system identifier:           123456789\n" +
            "Database cluster state:               shut down\n" +
            "Catalog version number:               202507181\n" +
            "Data page checksum version:           1\n",
          stderr: "",
        };
      }
      if (executable === fixture.toolchain.pgIsReady) {
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (executable === fixture.toolchain.postgres) {
        const setting = args.at(-1);
        const values: Record<string, string> = {
          listen_addresses: "127.0.0.1",
          unix_socket_directories: "",
          port: String(fixture.expectedIdentity.persistedPort),
          password_encryption: "scram-sha-256",
          data_directory: fixture.dataDirectory,
          hba_file: join(fixture.dataDirectory, "pg_hba.conf"),
        };
        return { exitCode: 0, stdout: values[setting ?? ""] ?? "", stderr: "" };
      }
      throw new Error(`unexpected executable ${executable}`);
    },
  );
  return { stopCalls };
}

describe("private PostgreSQL lifecycle uncertainty", () => {
  it("preserves the start log target when restarting", async () => {
    const fixture = await makeLifecycleFixture(55450);
    configureLifecycleMock(fixture, { statusExitCodes: [3, 0, 0, 0] });

    try {
      const ready = await startPrivatePostgresCluster({
        toolchain: fixture.toolchain,
        placement: fixture.placement,
        expectedIdentity: fixture.expectedIdentity,
        logFilePath: fixture.logFilePath,
        lifecycle: {
          startupTimeoutMs: 1_000,
          shutdownTimeoutMs: 1_000,
          readinessPollIntervalMs: 10,
        },
        assertControlAuthority: () => undefined,
      });
      expect(ready.startupDisposition).toBe("STARTED_BY_THIS_BOOTSTRAP");
      await ready.restart();

      const pgCtlCalls = runPostgresToolMock.mock.calls.filter(
        ([executable]) => executable === fixture.toolchain.pgCtl,
      );
      const startCall = pgCtlCalls.find(([, args]) => args[0] === "start");
      const restartCall = pgCtlCalls.find(([, args]) => args[0] === "restart");
      expect(startCall?.[1]).toEqual(
        expect.arrayContaining(["--log", fixture.logFilePath]),
      );
      expect(restartCall?.[1]).toEqual(
        expect.arrayContaining(["--log", fixture.logFilePath]),
      );
    } finally {
      runPostgresToolMock.mockReset();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("recognizes an already-running cluster without issuing start or allowing control", async () => {
    const fixture = await makeLifecycleFixture(55456);
    configureLifecycleMock(fixture, { statusExitCodes: [0, 0] });

    try {
      const ready = await startPrivatePostgresCluster({
        toolchain: fixture.toolchain,
        placement: fixture.placement,
        expectedIdentity: fixture.expectedIdentity,
        logFilePath: fixture.logFilePath,
        lifecycle: {
          startupTimeoutMs: 1_000,
          shutdownTimeoutMs: 1_000,
          readinessPollIntervalMs: 10,
        },
        assertControlAuthority: () => undefined,
      });

      expect(ready.startupDisposition).toBe("ALREADY_RUNNING");
      const pgCtlCalls = runPostgresToolMock.mock.calls.filter(
        ([executable]) => executable === fixture.toolchain.pgCtl,
      );
      expect(pgCtlCalls.some(([, args]) => args[0] === "start")).toBe(false);
      await expect(ready.stop()).rejects.toMatchObject({
        problem: {
          problemCode: "private-postgres.lifecycle.already_running_control_denied",
        },
      });
      await expect(ready.restart()).rejects.toMatchObject({
        problem: {
          problemCode: "private-postgres.lifecycle.already_running_control_denied",
        },
      });
    } finally {
      runPostgresToolMock.mockReset();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("proves and cleans up a start whose pg_ctl wait returns a timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "heptalogos-pg-lifecycle-unit-"));
    const dataDirectory = join(root, "private-postgres");
    const logFilePath = join(root, "private-postgres.log");
    const toolchain: PrivatePostgresToolchain = {
      version: "18.6",
      major: 18,
      binDirectory: root,
      postgres: join(root, "postgres.exe"),
      initdb: join(root, "initdb.exe"),
      pgCtl: join(root, "pg_ctl.exe"),
      pgControldata: join(root, "pg_controldata.exe"),
      pgIsReady: join(root, "pg_isready.exe"),
    };
    const placement = {
      rootId: "DATA" as const,
      relativePath: "private-postgres" as const,
      dataLayoutVersion: 1 as const,
      canonicalDataDirectory: dataDirectory,
    };
    const port = 55451;
    const expectedIdentity: PrivatePostgresExpectedIdentity = {
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      postgresMajor: 18,
      bootstrapRoleName: PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME,
      placement: {
        rootId: placement.rootId,
        relativePath: placement.relativePath,
        dataLayoutVersion: placement.dataLayoutVersion,
      },
      persistedPort: port,
      clusterSystemIdentifier: "123456789",
      initializationProfileRevision:
        createPrivatePostgresInitializationProfileRevision(port),
    };
    let statusCalls = 0;

    await mkdir(dataDirectory, { recursive: true });
    await writeFile(join(dataDirectory, "PG_VERSION"), "18\n");
    await writeFile(
      join(dataDirectory, "pg_hba.conf"),
      "# Heptalogos private PostgreSQL HBA profile v1\nhost all all 127.0.0.1/32 scram-sha-256\n",
    );
    runPostgresToolMock.mockImplementation(
      async (executable: string, args: readonly string[]) => {
        if (executable === toolchain.pgCtl && args[0] === "start") {
          throw new ProblemError({
            schemaVersion: 1,
            problemCode: "private-postgres.process.timed_out",
            category: "unavailable",
            retryClass: "backoff",
            title: "PostgreSQL tool invocation timed out",
            detail: "The mocked pg_ctl start continues in the background",
          });
        }
        if (executable === toolchain.pgCtl && args[0] === "status") {
          statusCalls += 1;
          return { exitCode: statusCalls === 2 ? 0 : 3, stdout: "", stderr: "" };
        }
        if (executable === toolchain.pgCtl && args[0] === "stop") {
          return { exitCode: 0, stdout: "", stderr: "" };
        }
        if (executable === toolchain.pgControldata) {
          return {
            exitCode: 0,
            stdout:
              "Database system identifier:           123456789\n" +
              "Database cluster state:               shut down\n" +
              "Catalog version number:               202507181\n" +
              "Data page checksum version:           1\n",
            stderr: "",
          };
        }
        if (executable === toolchain.postgres) {
          const setting = args.at(-1);
          const values: Record<string, string> = {
            listen_addresses: "127.0.0.1",
            unix_socket_directories: "",
            port: String(port),
            password_encryption: "scram-sha-256",
            data_directory: dataDirectory,
            hba_file: join(dataDirectory, "pg_hba.conf"),
          };
          return { exitCode: 0, stdout: values[setting ?? ""] ?? "", stderr: "" };
        }
        throw new Error(`unexpected executable ${executable}`);
      },
    );

    try {
      await expect(
        startPrivatePostgresCluster({
          toolchain,
          placement,
          expectedIdentity,
          logFilePath,
          lifecycle: {
            startupTimeoutMs: 1_000,
            shutdownTimeoutMs: 1_000,
            readinessPollIntervalMs: 10,
          },
          assertControlAuthority: () => undefined,
        }),
      ).rejects.toMatchObject({
        problem: { problemCode: "private-postgres.process.timed_out" },
      });

      expect(statusCalls).toBe(3);
      expect(runPostgresToolMock).toHaveBeenCalledWith(
        toolchain.pgCtl,
        expect.arrayContaining(["stop", "--pgdata", dataDirectory]),
        expect.any(Object),
      );
    } finally {
      runPostgresToolMock.mockReset();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not treat immediate STOPPED as cleanup proof after an ambiguous initial start", async () => {
    const fixture = await makeLifecycleFixture(55452);
    const { stopCalls } = configureLifecycleMock(fixture, {
      statusExitCodes: [3],
      startError: timeoutProblem(
        "The mocked pg_ctl start may continue in the background",
      ),
    });

    try {
      await expect(
        startPrivatePostgresCluster({
          toolchain: fixture.toolchain,
          placement: fixture.placement,
          expectedIdentity: fixture.expectedIdentity,
          logFilePath: fixture.logFilePath,
          lifecycle: {
            startupTimeoutMs: 1_000,
            shutdownTimeoutMs: 1_000,
            readinessPollIntervalMs: 10,
          },
          assertControlAuthority: () => undefined,
        }),
      ).rejects.toMatchObject({
        problem: {
          problemCode: "private-postgres.lifecycle.start_cleanup_uncertain",
        },
      });
      expect(stopCalls).toHaveLength(0);
    } finally {
      runPostgresToolMock.mockReset();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("keeps a restart handle usable for bounded stop when the first cleanup status is STOPPED", async () => {
    const fixture = await makeLifecycleFixture(55453);
    const { stopCalls } = configureLifecycleMock(fixture, {
      statusExitCodes: [3, 0, 0, 3],
      restartError: timeoutProblem(
        "The mocked pg_ctl restart may continue in the background",
      ),
    });

    try {
      const ready = await startPrivatePostgresCluster({
        toolchain: fixture.toolchain,
        placement: fixture.placement,
        expectedIdentity: fixture.expectedIdentity,
        logFilePath: fixture.logFilePath,
        lifecycle: {
          startupTimeoutMs: 1_000,
          shutdownTimeoutMs: 1_000,
          readinessPollIntervalMs: 10,
        },
        assertControlAuthority: () => undefined,
      });
      await expect(ready.restart()).rejects.toMatchObject({
        problem: { problemCode: "private-postgres.process.timed_out" },
      });
      await expect(ready.stop()).rejects.toMatchObject({
        problem: { problemCode: "private-postgres.lifecycle.stop_uncertain" },
      });
      expect(stopCalls).toHaveLength(0);
    } finally {
      runPostgresToolMock.mockReset();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("clears restart uncertainty only after RUNNING, bounded stop, and STOPPED proof", async () => {
    const fixture = await makeLifecycleFixture(55454);
    const { stopCalls } = configureLifecycleMock(fixture, {
      statusExitCodes: [3, 0, 0, 0, 3],
      restartError: timeoutProblem(
        "The mocked pg_ctl restart may continue in the background",
      ),
    });

    try {
      const ready = await startPrivatePostgresCluster({
        toolchain: fixture.toolchain,
        placement: fixture.placement,
        expectedIdentity: fixture.expectedIdentity,
        logFilePath: fixture.logFilePath,
        lifecycle: {
          startupTimeoutMs: 1_000,
          shutdownTimeoutMs: 1_000,
          readinessPollIntervalMs: 10,
        },
        assertControlAuthority: () => undefined,
      });
      await expect(ready.restart()).rejects.toMatchObject({
        problem: { problemCode: "private-postgres.process.timed_out" },
      });
      await expect(ready.stop()).resolves.toBeUndefined();
      expect(stopCalls).toHaveLength(1);
    } finally {
      runPostgresToolMock.mockReset();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
