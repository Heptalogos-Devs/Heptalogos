// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { asContentDigest, digestCanonicalJson } from "@heptalogos/foundation-contracts";
import { BootstrapStateStore } from "../../src/store.js";
import type { BootstrapStateBodyV1 } from "../../src/model.js";

const directories: string[] = [];

async function makeDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "heptalogos-bootstrap-state-"));
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

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("BootstrapStateStore", () => {
  it("rejects skipped and repeated candidate revisions", async () => {
    const store = new BootstrapStateStore(await makeDirectory());
    await store.commit(makeState(1));

    await expect(store.commit(makeState(3))).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.state.revision_conflict" },
    });
    await expect(store.commit(makeState(1))).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.state.revision_conflict" },
    });
  });

  it("recovers the previous valid revision when current bytes are corrupt", async () => {
    const directory = await makeDirectory();
    const store = new BootstrapStateStore(directory);
    await store.commit(makeState(1));
    await store.commit(makeState(2));
    await writeFile(join(directory, "bootstrap-state.json"), "corrupt");

    await expect(store.load()).resolves.toMatchObject({
      status: "RECOVERED_PREVIOUS",
      value: { state: { revision: 1 } },
      problem: { problemCode: "bootstrap.state.current_corrupt" },
    });
  });

  it("returns CORRUPT when both state files are invalid", async () => {
    const directory = await makeDirectory();
    const store = new BootstrapStateStore(directory);
    await writeFile(join(directory, "bootstrap-state.json"), "bad-current");
    await writeFile(join(directory, "bootstrap-state.previous.json"), "bad-previous");

    await expect(store.load()).resolves.toMatchObject({
      status: "CORRUPT",
      problem: { problemCode: "bootstrap.state.no_valid_revision" },
    });
  });

  it("preserves the current schema problem when no previous revision exists", async () => {
    const directory = await makeDirectory();
    const { continuityEpochId: _continuityEpochId, ...invalidState } = makeState(1);
    await writeFile(
      join(directory, "bootstrap-state.json"),
      JSON.stringify(sealBootstrapState(invalidState as never)),
    );

    await expect(new BootstrapStateStore(directory).load()).resolves.toMatchObject({
      status: "CORRUPT",
      problem: { problemCode: "bootstrap.state.invalid_schema" },
    });
  });

  it("never commits from RECOVERED_PREVIOUS and does not mutate either file", async () => {
    const directory = await makeDirectory();
    const store = new BootstrapStateStore(directory);
    await store.commit(makeState(1));
    await store.commit(makeState(2));
    await writeFile(join(directory, "bootstrap-state.json"), "corrupt");
    const currentBefore = await readFile(
      join(directory, "bootstrap-state.json"),
      "utf8",
    );
    const previousBefore = await readFile(
      join(directory, "bootstrap-state.previous.json"),
      "utf8",
    );

    await expect(store.commit(makeState(2))).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.state.current_authority_required" },
    });

    await expect(store.load()).resolves.toMatchObject({
      status: "RECOVERED_PREVIOUS",
      value: { state: { revision: 1 } },
    });
    await expect(
      readFile(join(directory, "bootstrap-state.json"), "utf8"),
    ).resolves.toBe(currentBefore);
    await expect(
      readFile(join(directory, "bootstrap-state.previous.json"), "utf8"),
    ).resolves.toBe(previousBefore);
  });
});
