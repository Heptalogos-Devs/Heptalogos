// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { lstat, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { BootstrapOwnerWitnessStore } from "@heptalogos/bootstrap-state";
import {
  createInstallationId,
  createInstanceId,
  createBootId,
  LIFECYCLE_ROOT_IDS,
  type LifecycleRootId,
} from "@heptalogos/foundation-contracts";
import type { BootstrapLocatorV1 } from "../../src/bootstrap/locator.js";
import { acquireBootstrapOwnership } from "../../src/bootstrap/ownership.js";
import {
  inspectBootstrapRecovery,
  reclaimAbandonedBootstrapOwnership,
} from "../../src/recovery/bootstrap.js";
import { proveLocalInstallationOwner } from "../../src/bootstrap/local-installation-owner.js";
import { resolveBootstrapPathProfile } from "../../src/bootstrap/roots.js";

const OWNER_FIXTURE = fileURLToPath(
  new URL("../support/fixtures/recovery-owner-process.mjs", import.meta.url),
);
const LOCK_DIRECTORY = ".heptalogos-bootstrap.lock";
const directories: string[] = [];

type ChildMessage = {
  readonly type: string;
  readonly problemCode?: string;
  readonly message?: string;
};

class ChildController {
  readonly process: ChildProcess;
  #messages: ChildMessage[] = [];
  #waiters: Array<{
    readonly types: ReadonlySet<string>;
    readonly resolve: (message: ChildMessage) => void;
    readonly reject: (error: Error) => void;
    readonly timer: NodeJS.Timeout;
  }> = [];

  constructor(fixture: string, anchorRoot: string, role: string) {
    this.process = spawn(process.execPath, [fixture, anchorRoot, role], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.process.on("message", (message: ChildMessage) => {
      const index = this.#waiters.findIndex((waiter) => waiter.types.has(message.type));
      if (index < 0) {
        this.#messages.push(message);
        return;
      }
      const [waiter] = this.#waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    });
  }

  waitFor(...types: string[]): Promise<ChildMessage> {
    const index = this.#messages.findIndex((message) => types.includes(message.type));
    if (index >= 0) return Promise.resolve(this.#messages.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiterIndex = this.#waiters.findIndex((waiter) => waiter.timer === timer);
        if (waiterIndex >= 0) this.#waiters.splice(waiterIndex, 1);
        reject(new Error(`Timed out waiting for ${types.join(" or ")}`));
      }, 20_000);
      this.#waiters.push({ types: new Set(types), resolve, reject, timer });
    });
  }

  send(message: object): void {
    if (!this.process.connected) return;
    try {
      this.process.send?.(message);
    } catch {
      // A failed recovery contender may have exited before cleanup.
    }
  }

  async stop(): Promise<void> {
    if (this.process.exitCode === null && this.process.signalCode === null) {
      this.process.kill();
      await Promise.race([
        once(this.process, "exit").then(() => undefined),
        new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
    if (this.process.exitCode === null && this.process.signalCode === null) {
      this.process.kill();
    }
  }
}

async function makeFixture() {
  const anchorRoot = await mkdtemp(
    join(tmpdir(), "heptalogos-bootstrap-recovery-process-anchor-"),
  );
  directories.push(anchorRoot);
  const roots = {} as Record<LifecycleRootId, string>;
  for (const id of LIFECYCLE_ROOT_IDS) {
    roots[id] =
      id === "PROGRAM"
        ? anchorRoot
        : await mkdtemp(
            join(
              tmpdir(),
              `heptalogos-bootstrap-recovery-process-${id.toLowerCase()}-`,
            ),
          );
    if (id !== "PROGRAM") directories.push(roots[id]);
  }
  const locator: BootstrapLocatorV1 = {
    schemaVersion: 1,
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    roots,
  };
  await writeFile(
    join(anchorRoot, "heptalogos.bootstrap.json"),
    JSON.stringify(locator),
  );
  return { anchorRoot, locator, instanceRoot: roots.INSTANCE };
}

async function staleLock(instanceRoot: string): Promise<void> {
  const lockPath = join(instanceRoot, LOCK_DIRECTORY);
  await mkdir(lockPath).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  const staleAt = new Date(Date.now() - 31_000);
  await utimes(lockPath, staleAt, staleAt);
}

async function releaseChild(child: ChildController): Promise<void> {
  if (child.process.exitCode !== null || child.process.signalCode !== null) {
    return;
  }
  child.send({ type: "release" });
  await Promise.race([
    child.waitFor("released", "error").catch(() => undefined),
    once(child.process, "exit").then(() => undefined),
  ]);
  await child.stop();
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Bootstrap Recovery real process kill/restart qualification", () => {
  it("reclaims a killed bootstrap owner only after stale adjudication", async () => {
    const fixture = await makeFixture();
    const owner = new ChildController(OWNER_FIXTURE, fixture.anchorRoot, "hold");
    const started = await owner.waitFor("acquired", "error");
    if (started.type !== "acquired") {
      throw new Error(started.message ?? started.problemCode ?? "owner child failed");
    }
    await owner.stop();
    await staleLock(fixture.instanceRoot);

    const principal = await proveLocalInstallationOwner(fixture.anchorRoot);
    const lease = await reclaimAbandonedBootstrapOwnership(
      fixture.anchorRoot,
      principal,
      { heartbeatMs: 1_000, bootId: createBootId() },
    );
    expect(lease.state).toBe("HELD");
    await lease.release();
  }, 30_000);

  it("allows exactly one winner when two recovery processes race", async () => {
    const fixture = await makeFixture();
    const owner = new ChildController(OWNER_FIXTURE, fixture.anchorRoot, "hold");
    await owner.waitFor("acquired");
    await owner.stop();
    await staleLock(fixture.instanceRoot);

    const contenders = [
      new ChildController(OWNER_FIXTURE, fixture.anchorRoot, "recover"),
      new ChildController(OWNER_FIXTURE, fixture.anchorRoot, "recover"),
    ];
    const results = await Promise.all(
      contenders.map((child) => child.waitFor("acquired", "error")),
    );
    expect(results.filter((result) => result.type === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result.type === "error")).toHaveLength(1);
    await Promise.all(contenders.map(releaseChild));
  }, 30_000);

  it("rejects a stale-looking lock while the original owner is still live", async () => {
    const fixture = await makeFixture();
    const owner = new ChildController(OWNER_FIXTURE, fixture.anchorRoot, "hold");
    await owner.waitFor("acquired");
    await staleLock(fixture.instanceRoot);

    const principal = await proveLocalInstallationOwner(fixture.anchorRoot);
    await expect(
      reclaimAbandonedBootstrapOwnership(fixture.anchorRoot, principal, {
        heartbeatMs: 1_000,
        bootId: createBootId(),
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.recovery.not_eligible" },
    });
    expect(owner.process.exitCode).toBeNull();
    await releaseChild(owner);
  }, 30_000);

  it("cleans the provider lock on clean owner exit while retaining dead witness evidence", async () => {
    const fixture = await makeFixture();
    const owner = new ChildController(
      OWNER_FIXTURE,
      fixture.anchorRoot,
      "exit-without-release",
    );
    const started = await owner.waitFor("acquired", "error");
    if (started.type !== "acquired") {
      throw new Error(started.message ?? started.problemCode ?? "owner child failed");
    }
    await once(owner.process, "exit");

    expect(owner.process.exitCode).toBe(0);
    await expect(
      lstat(join(fixture.instanceRoot, LOCK_DIRECTORY)),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      new BootstrapOwnerWitnessStore(fixture.instanceRoot).readOwner(),
    ).resolves.toBeDefined();

    const inspection = await inspectBootstrapRecovery(fixture.anchorRoot);
    expect(inspection.disposition).toBe("NO_RECOVERY_REQUIRED");
    expect(inspection.ownerProcessStatus).toBe("PROCESS_DEAD");

    const profile = await resolveBootstrapPathProfile(fixture.locator, ["INSTANCE"]);
    const lease = await acquireBootstrapOwnership(profile.resolve("INSTANCE"), {
      heartbeatMs: 1_000,
      bootId: createBootId(),
    });
    expect(lease.state).toBe("HELD");
    await lease.release();
  }, 30_000);
});
