// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createActivityId,
  createBootId,
  createContinuityEpochId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
} from "@heptalogos/foundation-contracts";
import type {
  PersistenceExecutionMetadata,
  PersistenceMutationTransactionContext,
} from "@heptalogos/persistence";
import { describe, expect, it } from "vitest";
import { createEvidenceService } from "../../src/index.js";
import { createFakeTimeService } from "@heptalogos/time-service";
import { parseInstant } from "@heptalogos/foundation-contracts";

function mutationContext(): PersistenceMutationTransactionContext {
  const execution: PersistenceExecutionMetadata = {
    activityId: createActivityId(),
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    bootId: createBootId(),
    continuityEpochId: createContinuityEpochId(),
    hostOwnershipToken: createHostOwnershipToken(),
  };
  return { mode: "MUTATION", execution };
}

describe("EvidenceService", () => {
  it.each([
    ["empty kind", { evidenceKind: "" }, "evidence.invalid_kind"],
    [
      "empty contract version",
      { evidenceContractVersion: " " },
      "evidence.invalid_contract_version",
    ],
    ["empty reference", { subjectRef: "\t" }, "evidence.invalid_reference"],
    [
      "ephemeral retention",
      { retentionClass: "ephemeral" },
      "evidence.retention_not_durable",
    ],
  ] as const)(
    "rejects %s inside the mutation transaction",
    async (_name, override, code) => {
      const time = createFakeTimeService(parseInstant("2026-08-24T15:00:00.000Z")!);
      const service = createEvidenceService(time);
      const draft = {
        evidenceKind: "test.fact",
        evidenceContractVersion: "v1",
        retentionClass: "retained" as const,
        sensitivity: "operational" as const,
        ...override,
      };

      await expect(
        service.recordRequired(mutationContext(), draft),
      ).rejects.toMatchObject({
        problem: { problemCode: code },
      });
    },
  );
});
