// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { createBootId, createUuidV7Id } from "@heptalogos/foundation-contracts";
import { BootstrapOwnerWitnessStore } from "../../src/bootstrap-owner-witness-store.js";
import type {
  BootstrapLockGenerationId,
  BootstrapOwnerWitnessBodyV1,
} from "../../src/bootstrap-owner-witness-model.js";

const roots: string[] = [];

function makeBody(
  phase: BootstrapOwnerWitnessBodyV1["phase"],
  lockGenerationId = createUuidV7Id(
    "BootstrapLockGenerationId",
  ) as BootstrapLockGenerationId,
): BootstrapOwnerWitnessBodyV1 {
  return {
    schemaVersion: 1,
    phase,
    lockGenerationId,
    bootId: createBootId(),
    pid: process.pid,
    processStartedAtMs: Date.now() - 100,
    heartbeatMs: 1_000,
    createdAt: new Date().toISOString(),
  };
}

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-owner-witness-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("bootstrap owner witness store", () => {
  it("publishes and reloads the exact owner generation atomically", async () => {
    const root = await makeRoot();
    const store = new BootstrapOwnerWitnessStore(root);
    const body = makeBody("OWNER");

    const published = await store.publishOwner(body);

    await expect(store.readOwner()).resolves.toEqual(published);
    expect(published.witness).toEqual(body);
  });

  it("creates, lists, and removes attempt witnesses", async () => {
    const root = await makeRoot();
    const store = new BootstrapOwnerWitnessStore(root);
    const first = makeBody("ATTEMPT");
    const second = makeBody("ATTEMPT");

    await store.createAttempt(first);
    await store.createAttempt(second);

    await expect(store.listAttempts()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ witness: first }),
        expect.objectContaining({ witness: second }),
      ]),
    );

    await store.removeAttempt(first.lockGenerationId);
    await expect(store.listAttempts()).resolves.toEqual([
      expect.objectContaining({ witness: second }),
    ]);
  });

  it("fails closed when the owner witness is corrupt", async () => {
    const root = await makeRoot();
    const store = new BootstrapOwnerWitnessStore(root);
    await writeFile(join(root, ".heptalogos-bootstrap-owner.json"), "not-json");

    await expect(store.readOwner()).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.owner_witness.invalid_json" },
    });
  });

  it("does not remove a newer owner generation", async () => {
    const root = await makeRoot();
    const store = new BootstrapOwnerWitnessStore(root);
    const first = makeBody("OWNER");
    const second = makeBody("OWNER");
    await store.publishOwner(first);
    await store.publishOwner(second);

    await expect(
      store.removeCurrentOwnerWhileHeld(first.lockGenerationId),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.owner_witness.owner_generation_mismatch" },
    });
    await expect(store.readOwner()).resolves.toMatchObject({
      witness: second,
    });
  });

  it("removes the owner only when the generation matches", async () => {
    const root = await makeRoot();
    const store = new BootstrapOwnerWitnessStore(root);
    const body = makeBody("OWNER");
    await store.publishOwner(body);

    await expect(
      store.removeCurrentOwnerWhileHeld(body.lockGenerationId),
    ).resolves.toBeUndefined();
    await expect(store.readOwner()).resolves.toBeUndefined();
  });

  it("keeps generation-scoped releasing cleanup away from a newer owner", async () => {
    const root = await makeRoot();
    const store = new BootstrapOwnerWitnessStore(root);
    const first = makeBody("OWNER");
    const second = makeBody("OWNER");

    await store.publishOwner(first);
    await store.publishReleasing({ ...first, phase: "RELEASING" });
    await store.removeCurrentOwnerWhileHeld(first.lockGenerationId);
    await store.publishOwner(second);

    await store.removeReleasing(first.lockGenerationId);

    await expect(store.readOwner()).resolves.toMatchObject({
      witness: second,
    });
    await expect(store.listReleasing()).resolves.toEqual([]);
  });
});
