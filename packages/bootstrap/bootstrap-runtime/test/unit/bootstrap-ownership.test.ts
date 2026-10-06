// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BootstrapOwnerWitnessStore } from "@heptalogos/bootstrap-state";
import { createBootId } from "@heptalogos/foundation-contracts";
import {
  acquireBootstrapOwnership,
  acquireBootstrapRecoveryOwnership,
} from "../../src/bootstrap/ownership.js";
import type { ResolvedLifecycleRoot } from "../../src/bootstrap/roots.js";

const directories: string[] = [];
const LOCK_DIRECTORY = ".heptalogos-bootstrap.lock";

function ownershipOptions(heartbeatMs = 1_000) {
  return { heartbeatMs, bootId: createBootId() };
}

async function makeInstanceRoot(): Promise<ResolvedLifecycleRoot> {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-bootstrap-owner-"));
  directories.push(root);
  return { id: "INSTANCE", configuredPath: root, canonicalPath: root };
}

async function waitForChild(
  child: ReturnType<typeof spawn>,
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("bootstrap ownership", () => {
  it("enforces heartbeat input and exposes HELD to RELEASED state", async () => {
    const instanceRoot = await makeInstanceRoot();

    await expect(
      acquireBootstrapOwnership(instanceRoot, ownershipOptions(999)),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.ownership.invalid_heartbeat" },
    });

    const lease = await acquireBootstrapOwnership(instanceRoot, ownershipOptions());
    expect(lease.state).toBe("HELD");
    expect(Object.isFrozen(lease)).toBe(true);
    expect(lease.signal.aborted).toBe(false);
    expect(() => lease.assertHeld()).not.toThrow();

    await lease.release();
    expect(lease.state).toBe("RELEASED");
    expect(lease.signal.aborted).toBe(true);
    await lease.release();

    expect(() => lease.assertHeld()).toThrowError();
    try {
      lease.assertHeld();
    } catch (error) {
      expect(error).toMatchObject({
        problem: { problemCode: "bootstrap.ownership.not_held" },
      });
    }
  });

  it("fences ownership assertions synchronously when release begins", async () => {
    const instanceRoot = await makeInstanceRoot();
    const lease = await acquireBootstrapOwnership(instanceRoot, ownershipOptions());

    const releasePromise = lease.release();

    expect(lease.state).toBe("RELEASING");
    expect(() => lease.assertHeld()).toThrow();
    await expect(releasePromise).resolves.toBeUndefined();
    expect(lease.state).toBe("RELEASED");
  });

  it("blocks a second in-process owner without a retry policy", async () => {
    const instanceRoot = await makeInstanceRoot();
    const first = await acquireBootstrapOwnership(instanceRoot, ownershipOptions());

    await expect(
      acquireBootstrapOwnership(instanceRoot, ownershipOptions()),
    ).rejects.toMatchObject({
      problem: {
        problemCode: "bootstrap.ownership.lock_present",
        category: "conflict",
        retryClass: "after-change",
        detail:
          "The instance bootstrap lock is present; it may belong to an active bootstrap attempt or require recovery",
      },
    });

    await first.release();
  });

  it("fails safe when the held lock is compromised", async () => {
    const instanceRoot = await makeInstanceRoot();
    const lease = await acquireBootstrapOwnership(instanceRoot, ownershipOptions());

    await rm(join(instanceRoot.canonicalPath, LOCK_DIRECTORY), {
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

    expect(lease.state).toBe("COMPROMISED");
    expect(() => lease.assertHeld()).toThrowError();
    try {
      lease.assertHeld();
    } catch (error) {
      expect(error).toMatchObject({
        problem: { problemCode: "bootstrap.ownership.compromised" },
      });
    }
    await lease.release();
  });

  it("does not reclaim an abandoned lock even when its mtime is old", async () => {
    const instanceRoot = await makeInstanceRoot();
    const lockDirectory = join(instanceRoot.canonicalPath, LOCK_DIRECTORY);
    await mkdir(lockDirectory);
    await utimes(lockDirectory, new Date(0), new Date(0));

    await expect(
      acquireBootstrapOwnership(instanceRoot, ownershipOptions()),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.ownership.lock_present" },
    });
    await expect(lstat(lockDirectory)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
  });

  it("uses the fixed recovery stale policy only for recovery acquisition", async () => {
    const instanceRoot = await makeInstanceRoot();
    const lockDirectory = join(instanceRoot.canonicalPath, LOCK_DIRECTORY);
    await mkdir(lockDirectory);
    await utimes(lockDirectory, new Date(0), new Date(0));

    const lease = await acquireBootstrapRecoveryOwnership(
      instanceRoot,
      ownershipOptions(),
    );
    expect(lease.state).toBe("HELD");
    await lease.release();
    await expect(lstat(lockDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("accepts the maximum recovery heartbeat", async () => {
    const instanceRoot = await makeInstanceRoot();

    const lease = await acquireBootstrapRecoveryOwnership(
      instanceRoot,
      ownershipOptions(15_000),
    );
    await lease.release();
  });

  it("rejects a recovery heartbeat above the stale-policy bound", async () => {
    const instanceRoot = await makeInstanceRoot();

    await expect(
      acquireBootstrapRecoveryOwnership(instanceRoot, ownershipOptions(15_001)),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.ownership.invalid_recovery_heartbeat" },
    });
  });

  it("returns a lease only after publishing its matching owner witness", async () => {
    const instanceRoot = await makeInstanceRoot();
    const bootId = createBootId();
    const store = new BootstrapOwnerWitnessStore(instanceRoot.canonicalPath);
    const lease = await acquireBootstrapOwnership(instanceRoot, {
      heartbeatMs: 1_000,
      bootId,
    });

    await expect(store.readOwner()).resolves.toMatchObject({
      witness: {
        phase: "OWNER",
        bootId,
        pid: process.pid,
        heartbeatMs: 1_000,
      },
    });
    await expect(store.listAttempts()).resolves.toHaveLength(0);

    await lease.release();
    await expect(store.readOwner()).resolves.toBeUndefined();
  });

  it("removes a failed contender's attempt witness without touching the owner", async () => {
    const instanceRoot = await makeInstanceRoot();
    const first = await acquireBootstrapOwnership(instanceRoot, ownershipOptions());
    const store = new BootstrapOwnerWitnessStore(instanceRoot.canonicalPath);

    await expect(
      acquireBootstrapOwnership(instanceRoot, ownershipOptions()),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.ownership.lock_present" },
    });
    await expect(store.listAttempts()).resolves.toHaveLength(0);
    await expect(store.readOwner()).resolves.toMatchObject({
      witness: { phase: "OWNER" },
    });

    await first.release();
  });

  it("preserves B when A's generation-scoped cleanup resumes after B acquires", async () => {
    const instanceRoot = await makeInstanceRoot();
    const first = await acquireBootstrapOwnership(instanceRoot, ownershipOptions());
    const store = new BootstrapOwnerWitnessStore(instanceRoot.canonicalPath);
    const firstOwner = await store.readOwner();
    if (firstOwner === undefined) throw new Error("missing first owner witness");
    const firstGeneration = firstOwner.witness.lockGenerationId;

    let releaseCleanupStarted!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => {
      releaseCleanupStarted = resolve;
    });
    let resumeReleaseCleanup!: () => void;
    const resumeCleanup = new Promise<void>((resolve) => {
      resumeReleaseCleanup = resolve;
    });
    let firstCleanupBlocked = false;
    const originalRemoveReleasing = Reflect.get(
      BootstrapOwnerWitnessStore.prototype,
      "removeReleasing",
    ) as (this: BootstrapOwnerWitnessStore, generationId: string) => Promise<void>;
    const cleanupSpy = vi
      .spyOn(BootstrapOwnerWitnessStore.prototype, "removeReleasing")
      .mockImplementation(async function (
        this: BootstrapOwnerWitnessStore,
        generationId,
      ) {
        if (generationId === firstGeneration && !firstCleanupBlocked) {
          firstCleanupBlocked = true;
          releaseCleanupStarted();
          await resumeCleanup;
        }
        await Reflect.apply(originalRemoveReleasing, this, [generationId]);
      });

    const firstRelease = first.release();
    await cleanupStarted;

    const second = await acquireBootstrapOwnership(instanceRoot, ownershipOptions());
    const secondOwner = await store.readOwner();
    expect(secondOwner?.witness.lockGenerationId).not.toBe(firstGeneration);

    resumeReleaseCleanup();
    await expect(firstRelease).resolves.toBeUndefined();
    cleanupSpy.mockRestore();
    await expect(store.readOwner()).resolves.toMatchObject({
      witness: secondOwner?.witness,
    });

    await second.release();
  });

  it("proves cross-process exclusive ownership with the selected lock settings", async () => {
    const instanceRoot = await makeInstanceRoot();
    const fixture = fileURLToPath(
      new URL("../support/fixtures/lock-contender.mjs", import.meta.url),
    );
    const resultFiles = [
      join(instanceRoot.canonicalPath, "contender-a.result"),
      join(instanceRoot.canonicalPath, "contender-b.result"),
    ];
    const children = resultFiles.map((resultFile) =>
      spawn(
        process.execPath,
        [fixture, instanceRoot.canonicalPath, "250", resultFile],
        {
          stdio: "ignore",
        },
      ),
    );

    const results = await Promise.all(children.map(waitForChild));
    const statuses = await Promise.all(
      resultFiles.map((file) => readFile(file, "utf8")),
    );

    expect(results.filter((result) => result.code === 0)).toHaveLength(1);
    expect(results.filter((result) => result.code === 3)).toHaveLength(1);
    expect(statuses).not.toContain("DOUBLE_OWNER");
  });
});
