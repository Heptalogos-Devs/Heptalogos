// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUuidV7Id } from "@heptalogos/foundation-contracts";
import type { BootstrapRecoveryInspection } from "../../src/recovery/bootstrap.js";

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  recover: vi.fn(),
  continue: vi.fn(),
}));

vi.mock("../../src/recovery/bootstrap.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/recovery/bootstrap.js")
  >("../../src/recovery/bootstrap.js");
  return {
    ...actual,
    inspectBootstrapRecovery: mocks.inspect,
    recoverAbandonedBootstrapToHost: mocks.continue,
  };
});

vi.mock("../../src/maintenance/recovery.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/maintenance/recovery.js")
  >("../../src/maintenance/recovery.js");
  return { ...actual, recoverInterruptedHostMaintenance: mocks.recover };
});

const { executeBootstrapRecoveryCommand, parseBootstrapRecoveryCommand } =
  await import("../../src/recovery/command.js");

const operationId = createUuidV7Id("MaintenanceOperationId");
const inspection = {
  disposition: "INCOMPLETE_MAINTENANCE",
  operationId,
  maintenanceIncomplete: true,
} as BootstrapRecoveryInspection;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inspect.mockResolvedValue(inspection);
});

describe("bounded bootstrap recovery commands", () => {
  it("supports read-only INSPECT without an execution context", async () => {
    await expect(
      executeBootstrapRecoveryCommand("/installation", { kind: "INSPECT" }),
    ).resolves.toEqual({ kind: "INSPECTED", inspection });
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("rejects an expected operation mismatch before dispatching recovery", async () => {
    await expect(
      executeBootstrapRecoveryCommand(
        "/installation",
        {
          kind: "RECOVER",
          expectedOperationId: createUuidV7Id("MaintenanceOperationId"),
        },
        {
          kind: "MAINTENANCE",
          recovery: {} as never,
        },
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.recovery.operation_mismatch" },
    });
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("dispatches only the fixed RECOVER operation with its expected identity", async () => {
    mocks.recover.mockResolvedValue({ kind: "STOPPED" });
    const context = { kind: "MAINTENANCE", recovery: { principal: {} } } as never;

    await expect(
      executeBootstrapRecoveryCommand(
        "/installation",
        { kind: "RECOVER", expectedOperationId: operationId },
        context,
      ),
    ).resolves.toMatchObject({
      kind: "RECOVERED",
      operationId,
      result: { kind: "STOPPED" },
    });
    expect(mocks.recover).toHaveBeenCalledWith({
      principal: {},
      anchorRoot: "/installation",
      expectedOperationId: operationId,
    });
  });

  it("routes no-lock dead-witness incomplete maintenance to MAINTENANCE recovery", async () => {
    mocks.inspect.mockResolvedValue({
      ...inspection,
      lockPresent: false,
      ownerProcessStatus: "PROCESS_DEAD",
      disposition: "INCOMPLETE_MAINTENANCE",
      maintenanceIncomplete: true,
    });
    mocks.recover.mockResolvedValue({ kind: "STOPPED" });

    await expect(
      executeBootstrapRecoveryCommand(
        "/installation",
        { kind: "RECOVER", expectedOperationId: operationId },
        { kind: "MAINTENANCE", recovery: { principal: {} } } as never,
      ),
    ).resolves.toMatchObject({
      kind: "RECOVERED",
      recoveryKind: "MAINTENANCE",
      operationId,
    });
    expect(mocks.recover).toHaveBeenCalledOnce();
    expect(mocks.continue).not.toHaveBeenCalled();
  });

  it("dispatches abandoned bootstrap continuation when no maintenance is incomplete", async () => {
    const abandoned = {
      ...inspection,
      disposition: "ABANDONED_OWNER_ELIGIBLE",
      operationId: undefined,
      maintenanceIncomplete: false,
    } as BootstrapRecoveryInspection;
    const host = { token: "host" };
    mocks.inspect.mockResolvedValue(abandoned);
    mocks.continue.mockResolvedValue(host);

    await expect(
      executeBootstrapRecoveryCommand("/installation", { kind: "RECOVER" }, {
        kind: "BOOTSTRAP_CONTINUATION",
        continuation: { principal: {} },
      } as never),
    ).resolves.toEqual({
      kind: "RECOVERED",
      recoveryKind: "BOOTSTRAP_CONTINUATION",
      host,
    });
    expect(mocks.continue).toHaveBeenCalledWith({
      anchorRoot: "/installation",
      principal: {},
    });
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it("blocks a maintenance context for abandoned bootstrap without mutation", async () => {
    mocks.inspect.mockResolvedValue({
      ...inspection,
      disposition: "ABANDONED_OWNER_ELIGIBLE",
      operationId: undefined,
      maintenanceIncomplete: false,
    });

    await expect(
      executeBootstrapRecoveryCommand("/installation", { kind: "RECOVER" }, {
        kind: "MAINTENANCE",
        recovery: {},
      } as never),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.recovery.context_state_mismatch" },
    });
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.continue).not.toHaveBeenCalled();
  });

  it("blocks a bootstrap context for incomplete maintenance without mutation", async () => {
    mocks.inspect.mockResolvedValue({
      ...inspection,
      disposition: "INCOMPLETE_MAINTENANCE",
      operationId,
      maintenanceIncomplete: true,
    });

    await expect(
      executeBootstrapRecoveryCommand(
        "/installation",
        { kind: "RECOVER", expectedOperationId: operationId },
        { kind: "BOOTSTRAP_CONTINUATION", continuation: { principal: {} } } as never,
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.recovery.context_state_mismatch" },
    });
    expect(mocks.recover).not.toHaveBeenCalled();
    expect(mocks.continue).not.toHaveBeenCalled();
  });

  it("rejects unsupported force, shell, SQL, and destructive verbs", () => {
    for (const kind of [
      "FORCE_UNLOCK",
      "EXEC_SQL",
      "EXEC_SHELL",
      "DELETE_PATH",
      "REINITIALIZE_POSTGRES",
      "REPLACE_CLUSTER",
      "DISABLE_FENCE",
    ]) {
      let thrown: unknown;
      try {
        parseBootstrapRecoveryCommand({ kind });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({
        problem: { problemCode: "bootstrap.recovery.command_invalid" },
      });
    }
  });
});
