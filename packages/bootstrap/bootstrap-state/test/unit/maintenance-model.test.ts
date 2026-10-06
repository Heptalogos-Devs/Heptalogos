// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createBootId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  createUuidV7Id,
} from "@heptalogos/foundation-contracts";
import {
  createMaintenanceOperationId,
  parseMaintenanceJournal,
  sealMaintenanceJournal,
} from "../../src/maintenance/codec.js";
import type { MaintenanceJournalBodyV1 } from "../../src/maintenance/model.js";

const INSTANT = "2026-08-22T08:30:00.000Z";

function makeBody(
  overrides: Partial<MaintenanceJournalBodyV1> = {},
): MaintenanceJournalBodyV1 {
  return {
    schemaVersion: 1,
    revision: 1,
    operationId: createMaintenanceOperationId(),
    activityId: createUuidV7Id("ActivityId"),
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    operationType: "PRIVATE_POSTGRES_RESTART",
    source: {
      hostOwnershipToken: createHostOwnershipToken(),
      hostBootId: createBootId(),
      hostOwnershipRevision: "4",
      postgresClusterSystemIdentifier: "12345678901234567890",
      persistedPort: 55432,
    },
    target: { privatePostgres: "RUNNING_SAME_IDENTITY" },
    phase: "PREPARED",
    updatedAt: INSTANT,
    ...overrides,
  };
}

describe("MaintenanceJournal V1 model", () => {
  it("creates UUIDv7 operation identities and round-trips a compact witness", () => {
    const body = makeBody();
    const envelope = sealMaintenanceJournal(body);

    expect(createMaintenanceOperationId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(parseMaintenanceJournal(JSON.stringify(envelope))).toEqual({
      ok: true,
      value: envelope,
    });
  });

  it.each([
    "PREPARED",
    "EXECUTING",
    "RECOVERY_REQUIRED",
    "SUCCEEDED",
    "ABORTED",
  ] as const)("accepts phase %s without a historical stage program", (phase) => {
    const body = makeBody({ phase });
    const result = parseMaintenanceJournal(
      JSON.stringify(sealMaintenanceJournal(body)),
    );
    expect(result).toMatchObject({ ok: true, value: { state: { phase } } });
  });

  it("requires the target to agree with the operation type", () => {
    const body = makeBody({
      operationType: "PRIVATE_POSTGRES_STOP",
      target: { privatePostgres: "RUNNING_SAME_IDENTITY" },
    });
    expect(
      parseMaintenanceJournal(JSON.stringify(sealMaintenanceJournal(body))),
    ).toMatchObject({
      ok: false,
      problem: { problemCode: "maintenance.journal.invalid_semantics" },
    });
  });

  it("does not accept problem evidence on a non-recovery phase", () => {
    const body = makeBody({ problemCode: "bootstrap.recovery.failed" });
    expect(
      parseMaintenanceJournal(JSON.stringify(sealMaintenanceJournal(body))),
    ).toMatchObject({
      ok: false,
      problem: { problemCode: "maintenance.journal.invalid_semantics" },
    });
  });
});
