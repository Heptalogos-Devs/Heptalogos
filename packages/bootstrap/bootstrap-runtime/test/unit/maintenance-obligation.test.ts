// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBootId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  createUuidV7Id,
  asContentDigest,
  digestCanonicalJson,
} from "@heptalogos/foundation-contracts";
import {
  BootstrapStateStore,
  createMaintenanceOperationId,
  MaintenanceJournalStore,
} from "@heptalogos/bootstrap-state";
import type { MaintenanceJournalBodyV1 } from "@heptalogos/bootstrap-state";
import { inspectMaintenanceObligation } from "../../src/maintenance/obligation.js";

const roots: string[] = [];

function body(phase: MaintenanceJournalBodyV1["phase"]): MaintenanceJournalBodyV1 {
  return {
    schemaVersion: 1,
    revision: 1,
    operationId: createMaintenanceOperationId(),
    activityId: createUuidV7Id("ActivityId"),
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    operationType: "PRIVATE_POSTGRES_STOP",
    source: {
      hostOwnershipToken: createHostOwnershipToken(),
      hostBootId: createBootId(),
      hostOwnershipRevision: "1",
      postgresClusterSystemIdentifier: "123",
      persistedPort: 55432,
    },
    target: { privatePostgres: "STOPPED" },
    phase,
    updatedAt: "2026-08-22T08:30:00.000Z",
    ...(phase === "RECOVERY_REQUIRED"
      ? { problemCode: "bootstrap.recovery.failed" }
      : {}),
  };
}

async function fixture(phase: MaintenanceJournalBodyV1["phase"]): Promise<{
  root: string;
  state: Awaited<ReturnType<BootstrapStateStore["load"]>>;
  operationId: MaintenanceJournalBodyV1["operationId"];
}> {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-obligation-"));
  roots.push(root);
  const stateStore = new BootstrapStateStore(join(root, "bootstrap-state"));
  const state = await stateStore.commit({
    schemaVersion: 1,
    revision: 1,
    activeBootstrapRuntimeGeneration: asContentDigest(
      "BootstrapRuntimeGenerationId",
      digestCanonicalJson("test.bootstrap-runtime/v1", { generation: "bootstrap" }),
    ),
    activeProductGeneration: asContentDigest(
      "ProductGenerationId",
      digestCanonicalJson("test.product-generation/v1", { generation: "product" }),
    ),
    continuityEpochId: "0197cfe0-0000-7000-8000-000000000003" as never,
  });
  const candidate = body(phase);
  const journal = new MaintenanceJournalStore(root);
  await journal.create(candidate);
  const pointer = {
    ...state.state,
    revision: state.state.revision + 1,
    lastCommittedOperationRef: `maintenance-journal/v1/${candidate.operationId}`,
  };
  const current = await stateStore.commit(pointer);
  return {
    root,
    state: { status: "CURRENT", value: current },
    operationId: candidate.operationId,
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("maintenance obligation classification", () => {
  it.each([
    ["PREPARED", true],
    ["EXECUTING", true],
    ["RECOVERY_REQUIRED", true],
    ["SUCCEEDED", false],
    ["ABORTED", false],
  ] as const)("classifies %s as incomplete=%s", async (phase, incomplete) => {
    const fixtureValue = await fixture(phase);
    await expect(
      inspectMaintenanceObligation(fixtureValue.root, fixtureValue.state),
    ).resolves.toMatchObject({
      operationId: fixtureValue.operationId,
      incomplete,
    });
  });
});
