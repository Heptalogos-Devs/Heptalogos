// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";

describe("recovery maintenance process argument contract", () => {
  it("distinguishes maintenance and recovery positional arguments by role", async () => {
    const parserModule =
      await import("../support/fixtures/recovery-maintenance-process-args.mjs").catch(
        () => ({}),
      );
    expect(typeof parserModule.parseRecoveryMaintenanceProcessArgs).toBe("function");
    if (typeof parserModule.parseRecoveryMaintenanceProcessArgs !== "function") return;

    const maintenance = parserModule.parseRecoveryMaintenanceProcessArgs([
      "/anchor",
      "maintenance",
      "/pg/bin",
      "55620",
      "EXECUTING",
    ]);
    expect(maintenance).toMatchObject({
      role: "maintenance",
      pgBin: "/pg/bin",
      portText: "55620",
      targetPhase: "EXECUTING",
    });
    expect(maintenance.operationIdText).toBeUndefined();

    expect(
      parserModule.parseRecoveryMaintenanceProcessArgs([
        "/anchor",
        "maintenance-prepared",
        "/pg/bin",
        "55620",
      ]),
    ).toMatchObject({
      role: "maintenance-prepared",
      pgBin: "/pg/bin",
      portText: "55620",
    });

    expect(
      parserModule.parseRecoveryMaintenanceProcessArgs([
        "/anchor",
        "recovery",
        "/pg/bin",
        "55620",
        "operation-id",
        "EXECUTING",
      ]),
    ).toMatchObject({
      role: "recovery",
      pgBin: "/pg/bin",
      portText: "55620",
      operationIdText: "operation-id",
      targetPhase: "EXECUTING",
    });
  });
});
