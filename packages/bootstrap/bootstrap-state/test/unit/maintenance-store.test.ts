// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBootId,
  createHostOwnershipToken,
  createInstallationId,
  createInstanceId,
  createUuidV7Id,
} from "@heptalogos/foundation-contracts";
import { parseMaintenanceJournal } from "../../src/maintenance/codec.js";
import { MaintenanceJournalStore } from "../../src/maintenance/store.js";
import type { MaintenanceJournalBodyV1 } from "../../src/maintenance/model.js";

const directories: string[] = [];

async function directory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "heptalogos-maintenance-journal-"));
  directories.push(path);
  return path;
}

function body(
  operationId = createUuidV7Id("MaintenanceOperationId"),
  revision = 1,
  phase: MaintenanceJournalBodyV1["phase"] = "PREPARED",
): MaintenanceJournalBodyV1 {
  return {
    schemaVersion: 1,
    revision,
    operationId,
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
    phase,
    updatedAt: "2026-08-22T08:30:00.000Z",
    ...(phase === "RECOVERY_REQUIRED"
      ? { problemCode: "bootstrap.recovery.failed" }
      : {}),
  };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("MaintenanceJournalStore", () => {
  it("returns EMPTY before creation and creates revision 1", async () => {
    const root = await directory();
    const store = new MaintenanceJournalStore(root);
    const operationId = createUuidV7Id("MaintenanceOperationId");

    await expect(store.load(operationId)).resolves.toEqual({ status: "EMPTY" });
    await expect(store.create(body(operationId))).resolves.toMatchObject({
      state: { revision: 1, phase: "PREPARED" },
    });
    await expect(store.load(operationId)).resolves.toMatchObject({
      status: "CURRENT",
      value: { state: { revision: 1, phase: "PREPARED" } },
    });
  });

  it("requires exact next revisions and exposes a coherent previous revision", async () => {
    const root = await directory();
    const store = new MaintenanceJournalStore(root);
    const operationId = createUuidV7Id("MaintenanceOperationId");
    await store.create(body(operationId));
    await store.advance(body(operationId, 2, "EXECUTING"));

    await expect(
      store.advance(body(operationId, 2, "EXECUTING")),
    ).rejects.toMatchObject({
      problem: { problemCode: "maintenance.journal.revision_conflict" },
    });
    await writeFile(
      join(root, "maintenance-journal", operationId, "maintenance-state.json"),
      "corrupt",
    );
    await expect(store.load(operationId)).resolves.toMatchObject({
      status: "RECOVERED_PREVIOUS",
      value: { state: { revision: 1, phase: "PREPARED" } },
    });
  });

  it("never advances from RECOVERED_PREVIOUS and does not mutate either file", async () => {
    const root = await directory();
    const store = new MaintenanceJournalStore(root);
    const operationId = createUuidV7Id("MaintenanceOperationId");
    await store.create(body(operationId));
    await store.advance(body(operationId, 2, "EXECUTING"));

    const journalPath = join(root, "maintenance-journal", operationId);
    await writeFile(join(journalPath, "maintenance-state.json"), "corrupt");
    const currentBefore = await readFile(
      join(journalPath, "maintenance-state.json"),
      "utf8",
    );
    const previousBefore = await readFile(
      join(journalPath, "maintenance-state.previous.json"),
      "utf8",
    );

    await expect(
      store.advance(body(operationId, 3, "RECOVERY_REQUIRED")),
    ).rejects.toMatchObject({
      problem: { problemCode: "maintenance.journal.current_authority_required" },
    });
    await expect(
      readFile(join(journalPath, "maintenance-state.json"), "utf8"),
    ).resolves.toBe(currentBefore);
    await expect(
      readFile(join(journalPath, "maintenance-state.previous.json"), "utf8"),
    ).resolves.toBe(previousBefore);
  });

  it("returns CORRUPT when both revisions are invalid", async () => {
    const root = await directory();
    const store = new MaintenanceJournalStore(root);
    const operationId = createUuidV7Id("MaintenanceOperationId");
    const path = join(root, "maintenance-journal", operationId);
    await store.create(body(operationId));
    await writeFile(
      join(path, "maintenance-state.json"),
      JSON.stringify({ invalid: true }),
    );
    await writeFile(
      join(path, "maintenance-state.previous.json"),
      JSON.stringify({ invalid: true }),
    );
    await expect(store.load(operationId)).resolves.toMatchObject({
      status: "CORRUPT",
      problem: { problemCode: "maintenance.journal.no_valid_revision" },
    });
  });

  it("serializes concurrent advances and leaves a parseable current revision", async () => {
    const root = await directory();
    const store = new MaintenanceJournalStore(root);
    const operationId = createUuidV7Id("MaintenanceOperationId");
    await store.create(body(operationId));
    const results = await Promise.allSettled([
      store.advance(body(operationId, 2, "EXECUTING")),
      store.advance(body(operationId, 2, "EXECUTING")),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const currentPath = join(
      root,
      "maintenance-journal",
      operationId,
      "maintenance-state.json",
    );
    const parsed = parseMaintenanceJournal(await readFile(currentPath, "utf8"));
    expect(parsed).toMatchObject({
      ok: true,
      value: { state: { revision: 2, phase: "EXECUTING" } },
    });
  });
});
