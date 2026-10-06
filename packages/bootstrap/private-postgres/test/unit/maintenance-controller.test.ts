// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createInstallationId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import { PRIVATE_POSTGRES_BOOTSTRAP_ROLE_NAME } from "../../src/contracts.js";
import type {
  PrivatePostgresExpectedIdentity,
  PrivatePostgresToolchain,
} from "../../src/contracts.js";

const operations = vi.hoisted(() => ({
  observeValidatedClusterMock: vi.fn(),
  stopValidatedClusterMock: vi.fn(),
  startValidatedClusterMock: vi.fn(),
}));

vi.mock("../../src/lifecycle-operations.js", () => ({
  observeValidatedCluster: operations.observeValidatedClusterMock,
  stopValidatedCluster: operations.stopValidatedClusterMock,
  startValidatedCluster: operations.startValidatedClusterMock,
}));

const { openPrivatePostgresMaintenanceController } =
  await import("../../src/maintenance-controller.js");

function fixture(): {
  readonly options: Parameters<typeof openPrivatePostgresMaintenanceController>[0];
  readonly guard: ReturnType<typeof vi.fn>;
} {
  const root = "/tmp/heptalogos-maintenance-controller";
  const toolchain: PrivatePostgresToolchain = {
    version: "18.6",
    major: 18,
    binDirectory: root,
    postgres: `${root}/postgres`,
    initdb: `${root}/initdb`,
    pgCtl: `${root}/pg_ctl`,
    pgControldata: `${root}/pg_controldata`,
    pgIsReady: `${root}/pg_isready`,
  };
  const placement = {
    rootId: "DATA" as const,
    relativePath: "private-postgres" as const,
    dataLayoutVersion: 1 as const,
    canonicalDataDirectory: `${root}/private-postgres`,
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
    persistedPort: 55432,
    clusterSystemIdentifier: "123456789",
    initializationProfileRevision: "a".repeat(
      64,
    ) as PrivatePostgresExpectedIdentity["initializationProfileRevision"],
  };
  const guard = vi.fn();
  return {
    guard,
    options: {
      toolchain,
      placement,
      expectedIdentity,
      logFilePath: `${root}/private-postgres.log`,
      lifecycle: {
        startupTimeoutMs: 1_000,
        shutdownTimeoutMs: 1_000,
        readinessPollIntervalMs: 10,
      },
      assertControlAuthority: guard,
    },
  };
}

describe("existing-cluster private PostgreSQL maintenance controller", () => {
  beforeEach(() => {
    operations.observeValidatedClusterMock.mockReset();
    operations.stopValidatedClusterMock.mockReset();
    operations.startValidatedClusterMock.mockReset();
  });

  it("opens a fully validated running cluster as READY", async () => {
    const { options } = fixture();
    operations.observeValidatedClusterMock.mockResolvedValue("RUNNING");

    const controller = await openPrivatePostgresMaintenanceController(options);

    expect(controller.state).toBe("READY");
    expect(operations.observeValidatedClusterMock).toHaveBeenCalledOnce();
  });

  it("opens a fully validated stopped cluster as STOPPED", async () => {
    const { options } = fixture();
    operations.observeValidatedClusterMock.mockResolvedValue("STOPPED");

    const controller = await openPrivatePostgresMaintenanceController(options);

    expect(controller.state).toBe("STOPPED");
    await expect(controller.stop()).resolves.toBeUndefined();
    expect(operations.stopValidatedClusterMock).not.toHaveBeenCalled();
  });

  it("rejects ambiguous observation and never exposes READY", async () => {
    const { options } = fixture();
    operations.observeValidatedClusterMock.mockRejectedValue(
      new Error("status uncertain"),
    );

    await expect(openPrivatePostgresMaintenanceController(options)).rejects.toThrow(
      "status uncertain",
    );
  });

  it("rejects start from READY and stop from UNCERTAIN", async () => {
    const { options } = fixture();
    operations.observeValidatedClusterMock.mockResolvedValue("RUNNING");
    const ready = await openPrivatePostgresMaintenanceController(options);
    await expect(ready.start()).rejects.toMatchObject({
      problem: { problemCode: "private-postgres.maintenance.already_ready" },
    });

    operations.observeValidatedClusterMock.mockResolvedValue("STOPPED");
    operations.startValidatedClusterMock.mockRejectedValue(
      new Error("ambiguous start"),
    );
    const stopped = await openPrivatePostgresMaintenanceController(options);
    await expect(stopped.start()).rejects.toThrow("ambiguous start");
    expect(stopped.state).toBe("UNCERTAIN");
    await expect(stopped.stop()).rejects.toMatchObject({
      problem: { problemCode: "private-postgres.maintenance.state_uncertain" },
    });
  });

  it("requires the control guard before stop and leaves the process untouched", async () => {
    const { options, guard } = fixture();
    operations.observeValidatedClusterMock.mockResolvedValue("RUNNING");
    guard.mockImplementationOnce(() => {
      throw new Error("control lost");
    });
    const controller = await openPrivatePostgresMaintenanceController(options);

    await expect(controller.stop()).rejects.toThrow("control lost");
    expect(operations.stopValidatedClusterMock).not.toHaveBeenCalled();
    expect(controller.state).toBe("READY");
  });

  it("moves to STOPPED only after the stop operation proves the process stopped", async () => {
    const { options } = fixture();
    operations.observeValidatedClusterMock.mockResolvedValue("RUNNING");
    operations.stopValidatedClusterMock.mockResolvedValue(undefined);
    const controller = await openPrivatePostgresMaintenanceController(options);

    await expect(controller.stop()).resolves.toBeUndefined();
    expect(controller.state).toBe("STOPPED");
    expect(operations.stopValidatedClusterMock).toHaveBeenCalledOnce();
  });

  it("does not issue start after a stop outcome becomes uncertain", async () => {
    const { options } = fixture();
    operations.observeValidatedClusterMock.mockResolvedValue("RUNNING");
    operations.stopValidatedClusterMock.mockRejectedValue(
      new Error("stop outcome uncertain"),
    );
    const controller = await openPrivatePostgresMaintenanceController(options);

    await expect(controller.stop()).rejects.toThrow("stop outcome uncertain");
    expect(controller.state).toBe("UNCERTAIN");
    await expect(controller.start()).rejects.toMatchObject({
      problem: { problemCode: "private-postgres.maintenance.state_uncertain" },
    });
    expect(operations.startValidatedClusterMock).not.toHaveBeenCalled();
  });

  it("returns to READY only after start readiness and identity proof", async () => {
    const { options } = fixture();
    operations.observeValidatedClusterMock.mockResolvedValue("STOPPED");
    operations.startValidatedClusterMock.mockResolvedValue(undefined);
    const controller = await openPrivatePostgresMaintenanceController(options);

    await expect(controller.start()).resolves.toBeUndefined();
    expect(controller.state).toBe("READY");
    expect(operations.startValidatedClusterMock).toHaveBeenCalledOnce();
  });
});
