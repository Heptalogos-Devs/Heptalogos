// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import {
  asContentDigest,
  createInstallationId,
  createInstanceId,
  digestCanonicalJson,
} from "@heptalogos/foundation-contracts";
import { parseBootstrapState, sealBootstrapState } from "../../src/codec.js";
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

function makeStateWithPrivatePostgres(revision: number): BootstrapStateBodyV1 {
  return {
    ...makeState(revision),
    privatePostgres: {
      schemaVersion: 1,
      postgresMajor: 18,
      initializedByPostgresVersion: "18.6",
      installationId: createInstallationId(),
      instanceId: createInstanceId(),
      bootstrapRoleName: "heptalogos_bootstrap",
      dataPlacement: {
        rootId: "DATA",
        relativePath: "private-postgres",
        dataLayoutVersion: 1,
      },
      persistedPort: 55432,
      clusterSystemIdentifier: "12345678901234567890",
      initializationProfileRevision: asContentDigest(
        "PrivatePostgresInitializationProfileRevision",
        digestCanonicalJson("test.private-postgres-profile/v1", {
          profile: "canonical",
        }),
      ),
    },
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
  it("returns EMPTY for a directory with no state files", async () => {
    const store = new BootstrapStateStore(await makeDirectory());

    await expect(store.load()).resolves.toEqual({ status: "EMPTY" });
  });

  it("commits revision 1 and loads it as CURRENT", async () => {
    const store = new BootstrapStateStore(await makeDirectory());
    await store.commit(makeState(1));

    await expect(store.load()).resolves.toMatchObject({
      status: "CURRENT",
      value: { state: { revision: 1 } },
    });
  });

  it("commits canonical V1 without private PostgreSQL and later adds V1 private PostgreSQL", async () => {
    const store = new BootstrapStateStore(await makeDirectory());
    await store.commit(makeState(1));

    await expect(store.commit(makeStateWithPrivatePostgres(2))).resolves.toMatchObject({
      state: { schemaVersion: 1, revision: 2, privatePostgres: { schemaVersion: 1 } },
    });
  });

  it("preserves revision 1 as previous when revision 2 is committed", async () => {
    const directory = await makeDirectory();
    const store = new BootstrapStateStore(directory);
    await store.commit(makeState(1));
    await store.commit(makeState(2));

    const previous = parseBootstrapState(
      await readFile(join(directory, "bootstrap-state.previous.json"), "utf8"),
    );
    expect(previous).toMatchObject({ ok: true, value: { state: { revision: 1 } } });
  });

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
