// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
import {
  BootstrapJournal,
  BootstrapStateStore,
  type BootstrapStateBodyV1,
  type BootstrapJournalCheckpointV1,
} from "@heptalogos/bootstrap-state";
import {
  acquireBootstrapOwnership,
  type BootstrapOwnershipLease,
} from "../../src/bootstrap/ownership.js";
import { openBootstrapStateAccess } from "../../src/bootstrap/state-access.js";
import type {
  BootstrapPathProfile,
  ResolvedLifecycleRoot,
} from "../../src/bootstrap/roots.js";

const directories: string[] = [];

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

function makeJournalEntry(
  installationId: ReturnType<typeof createInstallationId>,
  instanceId: ReturnType<typeof createInstanceId>,
): BootstrapJournalCheckpointV1 {
  return {
    schemaVersion: 1,
    bootId: createBootId(),
    bootstrapActivityId: createUuidV7Id("ActivityId"),
    installationId,
    instanceId,
    stage: "bootstrap.preliminary",
    at: "2026-08-21T09:00:00.000Z",
    outcome: "STARTED",
  };
}

async function makeProfile(): Promise<{
  readonly profile: BootstrapPathProfile;
  readonly instanceRoot: string;
}> {
  const instanceRoot = await mkdtemp(
    join(tmpdir(), "heptalogos-bootstrap-state-access-"),
  );
  directories.push(instanceRoot);
  const resolved: ResolvedLifecycleRoot = {
    id: "INSTANCE",
    configuredPath: instanceRoot,
    canonicalPath: instanceRoot,
  };
  const installationId = createInstallationId();
  const instanceId = createInstanceId();
  return {
    instanceRoot,
    profile: {
      installationId,
      instanceId,
      resolve(root) {
        if (root !== "INSTANCE") throw new Error(`unexpected root ${root}`);
        return resolved;
      },
      list() {
        return [resolved];
      },
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

describe("owned bootstrap state access", () => {
  it("rejects a structurally forged HELD lease before constructing state access", async () => {
    const { profile } = await makeProfile();
    const fakeLease: BootstrapOwnershipLease = {
      state: "HELD",
      signal: new AbortController().signal,
      assertHeld() {},
      async release() {},
    };
    let thrown: unknown;

    try {
      openBootstrapStateAccess(profile, fakeLease);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      problem: { problemCode: "bootstrap.ownership.invalid_capability" },
    });
  });

  it("rejects an issued lease when used with a different INSTANCE root", async () => {
    const first = await makeProfile();
    const second = await makeProfile();
    const lease = await acquireBootstrapOwnership(
      {
        id: "INSTANCE",
        configuredPath: first.instanceRoot,
        canonicalPath: first.instanceRoot,
      },
      { heartbeatMs: 1000, bootId: createBootId() },
    );
    let thrown: unknown;

    try {
      openBootstrapStateAccess(second.profile, lease);
    } catch (error) {
      thrown = error;
    } finally {
      await lease.release();
    }

    expect(thrown).toMatchObject({
      problem: { problemCode: "bootstrap.ownership.scope_mismatch" },
    });
    expect(
      await stat(join(second.instanceRoot, "bootstrap-state")).catch(() => undefined),
    ).toBe(undefined);
  });

  it("keeps raw state reads and journal evidence available before ownership", async () => {
    const { profile, instanceRoot } = await makeProfile();
    const rawState = new BootstrapStateStore(join(instanceRoot, "bootstrap-state"));
    const journal = new BootstrapJournal(instanceRoot);

    await expect(rawState.load()).resolves.toEqual({ status: "EMPTY" });
    const early = makeJournalEntry(profile.installationId, profile.instanceId);
    await journal.checkpoint(early);
    await expect(journal.read(early.bootId)).resolves.toEqual([early]);
  });

  it("commits with a genuine issued lease and rejects after release", async () => {
    const { profile, instanceRoot } = await makeProfile();
    const lease = await acquireBootstrapOwnership(
      {
        id: "INSTANCE",
        configuredPath: instanceRoot,
        canonicalPath: instanceRoot,
      },
      { heartbeatMs: 1000, bootId: createBootId() },
    );
    const access = openBootstrapStateAccess(profile, lease);

    await expect(access.state.commit(makeState(1))).resolves.toMatchObject({
      state: { revision: 1 },
    });
    await expect(
      access.state.commit(makeStateWithPrivatePostgres(2)),
    ).resolves.toMatchObject({
      state: { schemaVersion: 1, revision: 2 },
    });
    const statePath = join(instanceRoot, "bootstrap-state", "bootstrap-state.json");
    const beforeRelease = {
      text: await readFile(statePath, "utf8"),
      mtimeMs: (await stat(statePath)).mtimeMs,
    };

    await lease.release();
    await expect(
      access.state.commit(makeStateWithPrivatePostgres(3)),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.ownership.not_held" },
    });
    expect({
      text: await readFile(statePath, "utf8"),
      mtimeMs: (await stat(statePath)).mtimeMs,
    }).toEqual(beforeRelease);
  });

  it("rejects a commit after a genuine lease is compromised", async () => {
    const { profile, instanceRoot } = await makeProfile();
    const lease = await acquireBootstrapOwnership(
      {
        id: "INSTANCE",
        configuredPath: instanceRoot,
        canonicalPath: instanceRoot,
      },
      { heartbeatMs: 1000, bootId: createBootId() },
    );
    const access = openBootstrapStateAccess(profile, lease);
    await access.state.commit(makeStateWithPrivatePostgres(1));
    const statePath = join(instanceRoot, "bootstrap-state", "bootstrap-state.json");
    const beforeCompromise = {
      text: await readFile(statePath, "utf8"),
      mtimeMs: (await stat(statePath)).mtimeMs,
    };

    await rm(join(instanceRoot, ".heptalogos-bootstrap.lock"), {
      recursive: true,
      force: true,
    });
    await new Promise<void>((resolve) => {
      if (lease.signal.aborted) {
        resolve();
      } else {
        lease.signal.addEventListener("abort", () => resolve(), { once: true });
      }
    });

    await expect(
      access.state.commit(makeStateWithPrivatePostgres(2)),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.ownership.compromised" },
    });
    expect({
      text: await readFile(statePath, "utf8"),
      mtimeMs: (await stat(statePath)).mtimeMs,
    }).toEqual(beforeCompromise);
    await lease.release();
  });
});
