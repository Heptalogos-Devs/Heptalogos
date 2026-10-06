// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  asContentDigest,
  createBootId,
  createInstallationId,
  createInstanceId,
  createUuidV7Id,
  digestCanonicalJson,
} from "@heptalogos/foundation-contracts";
import { BootstrapJournal } from "../../src/journal.js";
import type { BootstrapJournalCheckpointV1, BootId } from "../../src/journal.js";

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
  it("writes Boot A and Boot B to different files", async () => {
    const directory = await makeDirectory();
    const journal = new BootstrapJournal(directory);
    const bootA = createUuidV7Id("BootId");
    const bootB = createUuidV7Id("BootId");

    await journal.checkpoint(makeEntry(bootA, "anchor"));
    await journal.checkpoint(makeEntry(bootB, "anchor"));

    await expect(journal.read(bootA)).resolves.toHaveLength(1);
    await expect(journal.read(bootB)).resolves.toHaveLength(1);
  });

  it("preserves checkpoint order for one BootId", async () => {
    const journal = new BootstrapJournal(await makeDirectory());
    const bootId = createUuidV7Id("BootId");

    await journal.checkpoint(makeEntry(bootId, "anchor"));
    await journal.checkpoint(makeEntry(bootId, "runtime", "SUCCEEDED"));

    await expect(journal.read(bootId)).resolves.toMatchObject([
      { stage: "anchor" },
      { stage: "runtime", outcome: "SUCCEEDED" },
    ]);
  });

  it("never returns Boot B checkpoints while reading Boot A", async () => {
    const journal = new BootstrapJournal(await makeDirectory());
    const bootA = createUuidV7Id("BootId");
    const bootB = createUuidV7Id("BootId");

    await journal.checkpoint(makeEntry(bootB, "boot-b"));

    const entries = await journal.read(bootA);
    expect(entries).toEqual([]);
    expect(entries.some((entry) => entry.bootId === bootB)).toBe(false);
  });

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

  it("rejects a runtime BootId that is not UUIDv7 before deriving a filename", async () => {
    const journal = new BootstrapJournal(await makeDirectory());

    await expect(journal.read("banana" as BootId)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.journal.invalid_boot_id" },
    });
  });

  it("rejects persisted generation references that are not content digests", async () => {
    const directory = await makeDirectory();
    const journal = new BootstrapJournal(directory);
    const bootId = createUuidV7Id("BootId");
    const file = join(directory, "bootstrap-journal", `${bootId}.json`);

    await journal.checkpoint(makeEntry(bootId, "anchor"));
    const text = await readFile(file, "utf8");
    const entries = JSON.parse(text) as Array<Record<string, unknown>>;
    entries[0].attemptedProductGeneration = "banana";
    await writeFile(file, JSON.stringify(entries));

    await expect(journal.read(bootId)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.journal.invalid_entry" },
    });
  });

  it("rejects a persisted at value that is not a canonical Instant", async () => {
    const journal = new BootstrapJournal(await makeDirectory());
    const bootId = createUuidV7Id("BootId");

    await expect(
      journal.checkpoint({
        ...makeEntry(bootId, "anchor"),
        at: "banana",
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.journal.invalid_entry" },
    });
  });

  it("rejects an impossible canonical-looking Instant", async () => {
    const journal = new BootstrapJournal(await makeDirectory());
    const bootId = createUuidV7Id("BootId");

    await expect(
      journal.checkpoint({
        ...makeEntry(bootId, "anchor"),
        at: "2026-02-30T00:00:00.000Z",
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.journal.invalid_entry" },
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

  it("keeps parser and schema details stable and bounded", async () => {
    const directory = await makeDirectory();
    const journal = new BootstrapJournal(directory);
    const bootId = createUuidV7Id("BootId");
    const file = join(directory, "bootstrap-journal", `${bootId}.json`);

    await journal.checkpoint(makeEntry(bootId, "anchor"));
    await writeFile(file, '[{"bootId":"');
    await expect(journal.read(bootId)).rejects.toMatchObject({
      problem: {
        problemCode: "bootstrap.journal.invalid_json",
        detail: "Bootstrap journal JSON could not be parsed",
      },
    });
  });

  it("does not import or expose BootstrapState authority", async () => {
    const source = await readFile(
      new URL("../../src/journal.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain('from "./store.js"');
    expect(source).not.toMatch(/\.commit\s*\(/u);
    expect(source).not.toMatch(/\bactivate\s*\(/u);
  });

  it("writes and reads a canonical V1 checkpoint before generation selection", async () => {
    const directory = await makeDirectory();
    const journal = new BootstrapJournal(directory);
    const entry: BootstrapJournalCheckpointV1 = {
      schemaVersion: 1,
      bootId: createBootId(),
      bootstrapActivityId: createUuidV7Id("ActivityId"),
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      stage: "bootstrap.locator.resolved",
      at: "2026-08-21T09:00:00.000Z",
      outcome: "SUCCEEDED",
    };

    await journal.checkpoint(entry);

    await expect(journal.read(entry.bootId)).resolves.toEqual([entry]);
  });

  it("rejects a checkpoint missing required installation and instance identity", async () => {
    const directory = await makeDirectory();
    const journal = new BootstrapJournal(directory);
    const entry = {
      schemaVersion: 1,
      bootId: createBootId(),
      bootstrapActivityId: createUuidV7Id("ActivityId"),
      stage: "bootstrap.invalid",
      at: "2026-08-21T00:00:00.000Z",
      outcome: "STARTED",
    };
    await mkdir(join(directory, "bootstrap-journal"), { recursive: true });
    await writeFile(
      join(directory, "bootstrap-journal", `${entry.bootId}.json`),
      JSON.stringify([entry]),
    );

    await expect(journal.read(entry.bootId)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.journal.invalid_entry" },
    });
  });

  it("rejects a canonical checkpoint whose bootId does not match its filename", async () => {
    const directory = await makeDirectory();
    const journal = new BootstrapJournal(directory);
    const fileBootId = createBootId();
    const entry: BootstrapJournalCheckpointV1 = {
      schemaVersion: 1,
      bootId: createBootId(),
      bootstrapActivityId: createUuidV7Id("ActivityId"),
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      stage: "bootstrap.locator.resolved",
      at: "2026-08-21T09:00:00.000Z",
      outcome: "SUCCEEDED",
    };

    await journal.checkpoint(entry);
    const entryText = await readFile(
      join(directory, "bootstrap-journal", `${entry.bootId}.json`),
      "utf8",
    );
    await writeFile(
      join(directory, "bootstrap-journal", `${fileBootId}.json`),
      entryText,
    );

    await expect(journal.read(fileBootId)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.journal.boot_id_mismatch" },
    });
  });
});
