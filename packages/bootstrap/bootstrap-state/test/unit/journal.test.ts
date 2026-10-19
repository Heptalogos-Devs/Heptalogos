// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  asContentDigest,
  createInstallationId,
  createInstanceId,
  createUuidV7Id,
  digestCanonicalJson,
} from "@heptalogos/foundation-contracts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BootId, BootstrapJournalCheckpointV1 } from "../../src/journal.js";
import { BootstrapJournal } from "../../src/journal.js";

const directories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "heptalogos-bootstrap-journal-"));
  directories.push(directory);
  return directory;
}

function makeEntry(
  bootId: BootId,
  stage: string,
  outcome: BootstrapJournalCheckpointV1["outcome"] = "STARTED",
): BootstrapJournalCheckpointV1 {
  return {
    schemaVersion: 1,
    bootId,
    bootstrapActivityId: createUuidV7Id("ActivityId"),
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    attemptedBootstrapRuntimeGeneration: asContentDigest(
      "BootstrapRuntimeGenerationId",
      digestCanonicalJson("test.bootstrap-runtime/v1", { generation: "bootstrap" }),
    ),
    attemptedProductGeneration: asContentDigest(
      "ProductGenerationId",
      digestCanonicalJson("test.product-generation/v1", { generation: "product" }),
    ),
    stage,
    at: "2026-08-21T00:00:00.000Z",
    outcome,
  };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("BootstrapJournal", () => {
  it("rejects a selected journal file whose entries have another bootId", async () => {
    const directory = await makeDirectory();
    const journal = new BootstrapJournal(directory);
    const bootA = createUuidV7Id("BootId");
    const bootB = createUuidV7Id("BootId");
    const file = join(directory, "bootstrap-journal", `${bootA}.json`);

    await journal.checkpoint(makeEntry(bootB, "boot-b"));
    const bootBText = await readFile(
      join(directory, "bootstrap-journal", `${bootB}.json`),
      "utf8",
    );
    await writeFile(file, bootBText);

    await expect(journal.read(bootA)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.journal.boot_id_mismatch" },
    });
  });

  it("does not lose concurrent checkpoints for one BootId", async () => {
    const journal = new BootstrapJournal(await makeDirectory());
    const bootId = createUuidV7Id("BootId");
    const stages = Array.from({ length: 20 }, (_, index) => `stage-${index}`);

    await Promise.all(
      stages.map((stage) => journal.checkpoint(makeEntry(bootId, stage))),
    );

    const entries = await journal.read(bootId);

    expect(entries).toHaveLength(stages.length);
    expect(new Set(entries.map((entry) => entry.stage))).toEqual(new Set(stages));
  });
});
