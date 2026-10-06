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
  MAINTENANCE_JOURNAL_DIGEST_DOMAIN,
  parseMaintenanceJournal,
  sealMaintenanceJournal,
} from "../../src/maintenance/codec.js";
import type { MaintenanceJournalBodyV1 } from "../../src/maintenance/model.js";

function body(): MaintenanceJournalBodyV1 {
  return {
    schemaVersion: 1,
    revision: 1,
    operationId: createUuidV7Id("MaintenanceOperationId"),
    activityId: createUuidV7Id("ActivityId"),
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    operationType: "PRIVATE_POSTGRES_STOP",
    source: {
      hostOwnershipToken: createHostOwnershipToken(),
      hostBootId: createBootId(),
      hostOwnershipRevision: "0",
      postgresClusterSystemIdentifier: "123",
      persistedPort: 55432,
    },
    target: { privatePostgres: "STOPPED" },
    phase: "EXECUTING",
    updatedAt: "2026-08-22T08:30:00.000Z",
  };
}

describe("MaintenanceJournal envelope integrity", () => {
  it("uses the fixed domain-separated digest envelope", () => {
    const sealed = sealMaintenanceJournal(body());
    expect(sealed.digest).toMatchObject({
      algorithm: "sha256",
      canonicalization: "RFC8785-JCS",
      domain: MAINTENANCE_JOURNAL_DIGEST_DOMAIN,
    });
    expect(parseMaintenanceJournal(JSON.stringify(sealed))).toEqual({
      ok: true,
      value: sealed,
    });
  });

  it("rejects body tampering even when the envelope shape remains valid", () => {
    const sealed = sealMaintenanceJournal(body());
    const tampered = {
      ...sealed,
      state: {
        ...sealed.state,
        source: { ...sealed.state.source, persistedPort: 55433 },
      },
    };
    expect(parseMaintenanceJournal(JSON.stringify(tampered))).toMatchObject({
      ok: false,
      problem: { problemCode: "maintenance.journal.digest_mismatch" },
    });
  });

  it("rejects an unsupported stage-shaped envelope", () => {
    const sealed = sealMaintenanceJournal(body());
    const unsupported = {
      ...sealed,
      state: {
        ...sealed.state,
        phase: undefined,
        lastCompletedStage: "POSTGRES_STOPPED",
      },
    };
    expect(parseMaintenanceJournal(JSON.stringify(unsupported))).toMatchObject({
      ok: false,
      problem: { problemCode: "maintenance.journal.invalid_schema" },
    });
  });
});
