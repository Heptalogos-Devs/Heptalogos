// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createBootId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import type { HostOwnershipContext } from "@heptalogos/host-ownership";
import {
  createHostMaintenanceOperations,
  type HostMaintenanceOperationProvenance,
} from "../../src/maintenance/operation.js";

function provenance(
  trace: string[],
  closeError?: Error,
): HostMaintenanceOperationProvenance {
  let state: HostOwnershipContext["state"] = "ACTIVE";
  const host: HostOwnershipContext = {
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    bootId: createBootId(),
    token: createHostOwnershipToken(),
    get state() {
      return state;
    },
    signal: new AbortController().signal,
    assertActive() {
      if (state !== "ACTIVE") throw new Error("Host is not active");
    },
    async close() {
      trace.push("host.close");
      if (closeError !== undefined) throw closeError;
      state = "CLOSED";
    },
  };
  return {
    host,
    bootstrap: {} as HostMaintenanceOperationProvenance["bootstrap"],
    handoff: {} as HostMaintenanceOperationProvenance["handoff"],
    privatePostgres: {} as HostMaintenanceOperationProvenance["privatePostgres"],
    terminalizeManagedHost: () => trace.push("host.terminal"),
    beginOldHostRetirement: () => host.close(),
    onOldHostTerminal: () => trace.push("host.terminal.observed"),
  };
}

describe("terminal Host maintenance operations", () => {
  it("retires product work before closing the old Host", async () => {
    const trace: string[] = [];
    const operations = createHostMaintenanceOperations(provenance(trace));

    await operations.shutdownKeepingPrivatePostgres({
      async retire() {
        trace.push("runtime.retire");
      },
    });

    expect(trace).toEqual([
      "host.terminal",
      "runtime.retire",
      "host.close",
      "host.terminal.observed",
    ]);
  });

  it("keeps the Host non-serving when product retirement fails", async () => {
    const trace: string[] = [];
    const operations = createHostMaintenanceOperations(provenance(trace));
    const failure = new Error("runtime retirement failed");

    await expect(
      operations.shutdownKeepingPrivatePostgres({
        async retire() {
          trace.push("runtime.retire");
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(trace).toEqual([
      "host.terminal",
      "runtime.retire",
      "host.close",
      "host.terminal.observed",
    ]);
  });

  it("reports Host close failure without restoring active admission", async () => {
    const trace: string[] = [];
    const operations = createHostMaintenanceOperations(
      provenance(trace, new Error("Host close failed")),
    );

    await expect(
      operations.shutdownKeepingPrivatePostgres({ retire: async () => undefined }),
    ).rejects.toThrow("Host close failed");
    expect(trace).toEqual(["host.terminal", "host.close", "host.terminal.observed"]);
  });
});
