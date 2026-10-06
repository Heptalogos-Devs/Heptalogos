// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  asContentDigest,
  createInstallationId,
  createInstanceId,
  createUuidV7Id,
  digestCanonicalJson,
} from "@heptalogos/foundation-contracts";
import { parseBootstrapState } from "../../src/codec.js";
import { BootstrapJournal } from "../../src/journal.js";
import type { BootstrapJournalCheckpointV1, BootId } from "../../src/journal.js";
import { BootstrapStateStore } from "../../src/store.js";
import type { BootstrapStateBodyV1 } from "../../src/model.js";

const directories: string[] = [];

async function makeDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function makeState(revision: number): BootstrapStateBodyV1 {
  return {
    schemaVersion: 1,
    revision,
    activeBootstrapRuntimeGeneration: asContentDigest(
      "BootstrapRuntimeGenerationId",
      digestCanonicalJson("test.bootstrap-runtime/v1", { generation: "bootstrap" }),
    ),
    activeProductGeneration: asContentDigest(
      "ProductGenerationId",
      digestCanonicalJson("test.product-generation/v1", { generation: "product" }),
    ),
    continuityEpochId:
      "0197cfe0-0000-7000-8000-000000000001" as BootstrapStateBodyV1["continuityEpochId"],
  };
}

function makeEntry(bootId: BootId, stage: string): BootstrapJournalCheckpointV1 {
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
    outcome: "STARTED",
  };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("BootstrapState platform filesystem behavior", () => {
  it("commits and loads state and journal entries under a Unicode directory path", async () => {
    const directory = await makeDirectory("heptalogos-启动状态-");
    const store = new BootstrapStateStore(directory);
    await store.commit(makeState(1));
    await store.commit(makeState(2));

    await expect(store.load()).resolves.toMatchObject({
      status: "CURRENT",
      value: { state: { revision: 2 } },
    });

    const journal = new BootstrapJournal(directory);
    const bootId = createUuidV7Id("BootId");
    await journal.checkpoint(makeEntry(bootId, "anchor"));

    await expect(journal.read(bootId)).resolves.toHaveLength(1);
  });

  it("repeatedly atomically replaces existing state files across sequential commits", async () => {
    const directory = await makeDirectory("heptalogos-bootstrap-replace-");
    const store = new BootstrapStateStore(directory);

    for (let revision = 1; revision <= 5; revision += 1) {
      await store.commit(makeState(revision));
    }

    await expect(store.load()).resolves.toMatchObject({
      status: "CURRENT",
      value: { state: { revision: 5 } },
    });

    const previous = parseBootstrapState(
      await readFile(join(directory, "bootstrap-state.previous.json"), "utf8"),
    );
    expect(previous).toMatchObject({ ok: true, value: { state: { revision: 4 } } });
  });

  it.runIf(process.platform === "win32")(
    "resolves case-insensitive filename variants to the same state authority",
    async () => {
      const directory = await makeDirectory("heptalogos-bootstrap-case-");
      const store = new BootstrapStateStore(directory);
      await store.commit(makeState(1));

      const upperVariant = join(directory, "BOOTSTRAP-STATE.JSON");
      const viaUpperVariant = parseBootstrapState(await readFile(upperVariant, "utf8"));
      expect(viaUpperVariant).toMatchObject({
        ok: true,
        value: { state: { revision: 1 } },
      });

      await store.commit(makeState(2));
      await expect(store.load()).resolves.toMatchObject({
        status: "CURRENT",
        value: { state: { revision: 2 } },
      });

      const entries = await readdir(directory);
      expect(entries.filter((name) => name === "bootstrap-state.json")).toHaveLength(1);
    },
  );

  it.runIf(process.platform === "win32")(
    "operates through a junctioned storage root while bytes land in the target directory",
    async () => {
      const target = await makeDirectory("heptalogos-bootstrap-junction-");
      const linkParent = await makeDirectory("heptalogos-bootstrap-link-");
      const link = join(linkParent, "storage-junction");
      await symlink(target, link, "junction");

      const store = new BootstrapStateStore(link);
      await store.commit(makeState(1));
      await expect(store.load()).resolves.toMatchObject({
        status: "CURRENT",
        value: { state: { revision: 1 } },
      });
      await expect(
        readFile(join(target, "bootstrap-state.json"), "utf8"),
      ).resolves.toContain('"revision":1');

      const journal = new BootstrapJournal(link);
      const bootId = createUuidV7Id("BootId");
      await journal.checkpoint(makeEntry(bootId, "anchor"));
      await expect(journal.read(bootId)).resolves.toHaveLength(1);
      await expect(
        readFile(join(target, "bootstrap-journal", `${bootId}.json`), "utf8"),
      ).resolves.toContain('"stage":"anchor"');
    },
  );

  it.runIf(process.platform !== "win32")(
    "operates through a POSIX-symlinked storage root while bytes land in the target directory",
    async () => {
      const target = await makeDirectory("heptalogos-bootstrap-symlink-");
      const linkParent = await makeDirectory("heptalogos-bootstrap-plink-");
      const link = join(linkParent, "storage-symlink");
      await symlink(target, link);

      const store = new BootstrapStateStore(link);
      await store.commit(makeState(1));
      await expect(store.load()).resolves.toMatchObject({
        status: "CURRENT",
        value: { state: { revision: 1 } },
      });
      await expect(
        readFile(join(target, "bootstrap-state.json"), "utf8"),
      ).resolves.toContain('"revision":1');

      const journal = new BootstrapJournal(link);
      const bootId = createUuidV7Id("BootId");
      await journal.checkpoint(makeEntry(bootId, "anchor"));
      await expect(journal.read(bootId)).resolves.toHaveLength(1);
      await expect(
        readFile(join(target, "bootstrap-journal", `${bootId}.json`), "utf8"),
      ).resolves.toContain('"stage":"anchor"');
    },
  );

  it.runIf(process.platform === "linux")(
    "keeps state authority distinct from different-case decoy filenames on case-sensitive filesystems",
    async () => {
      const directory = await makeDirectory("heptalogos-bootstrap-case-");
      const store = new BootstrapStateStore(directory);
      await store.commit(makeState(1));

      await writeFile(join(directory, "BOOTSTRAP-STATE.JSON"), "decoy");

      await expect(store.load()).resolves.toMatchObject({
        status: "CURRENT",
        value: { state: { revision: 1 } },
      });

      const entries = await readdir(directory);
      expect(entries).toContain("bootstrap-state.json");
      expect(entries).toContain("BOOTSTRAP-STATE.JSON");
    },
  );
});
