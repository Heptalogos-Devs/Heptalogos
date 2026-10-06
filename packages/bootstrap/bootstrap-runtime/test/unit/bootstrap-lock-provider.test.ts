// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

type ProviderName = "@bybrave/proper-lockfile2";
type ChildMessage = {
  readonly type: string;
  readonly code?: string;
  readonly mtimeMs?: number;
  readonly releaseError?: string;
};

function isEpipe(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "EPIPE"
  );
}

const FIXTURE = fileURLToPath(
  new URL("../support/fixtures/stale-reclaim-race.mjs", import.meta.url),
);
const STALE_MS = 2_000;
const ACTIVE_OWNER_TEST_TIMEOUT_MS = 30_000;
const children: ChildController[] = [];
const temporaryRoots: string[] = [];

class ChildController {
  readonly process: ChildProcess;
  #messages: ChildMessage[] = [];
  #waiters: Array<{
    readonly types: ReadonlySet<string>;
    readonly resolve: (message: ChildMessage) => void;
    readonly reject: (error: Error) => void;
    readonly timer: NodeJS.Timeout;
  }> = [];

  constructor(
    provider: ProviderName,
    role: string,
    target: string,
    lockfilePath: string,
  ) {
    this.process = spawn(
      process.execPath,
      [FIXTURE, provider, role, target, lockfilePath, String(STALE_MS)],
      { stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    this.process.on("message", (message: ChildMessage) => {
      const waiterIndex = this.#waiters.findIndex((waiter) =>
        waiter.types.has(message.type),
      );
      if (waiterIndex < 0) {
        this.#messages.push(message);
        return;
      }
      const [waiter] = this.#waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    });
  }

  waitFor(...types: string[]): Promise<ChildMessage> {
    const messageIndex = this.#messages.findIndex((message) =>
      types.includes(message.type),
    );
    if (messageIndex >= 0) {
      return Promise.resolve(this.#messages.splice(messageIndex, 1)[0]);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.#waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.#waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${types.join(" or ")}`));
      }, 10_000);
      this.#waiters.push({
        types: new Set(types),
        resolve,
        reject,
        timer,
      });
    });
  }

  async send(message: object): Promise<void> {
    if (!this.process.connected) return;
    await new Promise<void>((resolve, reject) => {
      try {
        this.process.send?.(message, (error) => {
          if (error !== null && error !== undefined && !isEpipe(error)) {
            reject(error);
            return;
          }
          resolve();
        });
      } catch (error) {
        if (isEpipe(error)) {
          resolve();
          return;
        }
        reject(error);
      }
    });
  }

  async #waitForExit(timeoutMs: number): Promise<void> {
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    await Promise.race([
      once(this.process, "exit").then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  }

  async stop(): Promise<void> {
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    await this.send({ type: "release" });
    await this.#waitForExit(250);
    if (this.process.exitCode === null && this.process.signalCode === null) {
      this.process.kill("SIGKILL");
      await this.#waitForExit(2_000);
    }
  }
}

async function makeTarget(prefix = "heptalogos-lock-provider-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  temporaryRoots.push(root);
  const target = join(root, "resource");
  const lockfilePath = join(target, ".heptalogos-bootstrap.lock");
  await mkdir(target);
  return { root, target, lockfilePath };
}

async function makeStaleLock(lockfilePath: string): Promise<void> {
  await mkdir(lockfilePath);
  const staleAt = new Date(Date.now() - STALE_MS * 4);
  await utimes(lockfilePath, staleAt, staleAt);
}

function start(
  provider: ProviderName,
  role: string,
  target: string,
  lockfilePath: string,
): ChildController {
  const child = new ChildController(provider, role, target, lockfilePath);
  children.push(child);
  return child;
}

async function runDelayedReclaimerRace(provider: ProviderName) {
  const { target, lockfilePath } = await makeTarget();
  await makeStaleLock(lockfilePath);

  const delayed = start(provider, "pause-stale", target, lockfilePath);
  await delayed.waitFor("stale-stat-observed");

  const winner = start(provider, "hold", target, lockfilePath);
  await winner.waitFor("acquired");
  expect(await winner.waitFor("reclaimed")).toMatchObject({ type: "reclaimed" });
  expect((await stat(lockfilePath)).mtimeMs).toBeGreaterThan(Date.now() - STALE_MS);

  await delayed.send({ type: "resume-stale-stat" });
  const delayedResult = await delayed.waitFor("acquired", "error");

  return { delayed, winner, delayedResult, lockfilePath };
}

afterEach(async () => {
  await Promise.all(children.splice(0).map((child) => child.stop()));
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("bootstrap stale-reclaim provider qualification", () => {
  it("rejects a delayed reclaimer without deleting the winner lock", async () => {
    const result = await runDelayedReclaimerRace("@bybrave/proper-lockfile2");

    expect(result.delayedResult).toMatchObject({ type: "error", code: "ELOCKED" });
    expect((await stat(result.lockfilePath)).isDirectory()).toBe(true);
  });

  it("allows exactly one winner among concurrent stale reclaimers", async () => {
    const { target, lockfilePath } = await makeTarget();
    await makeStaleLock(lockfilePath);
    const contenders = Array.from({ length: 8 }, () =>
      start("@bybrave/proper-lockfile2", "hold", target, lockfilePath),
    );
    const results = await Promise.all(
      contenders.map((contender) => contender.waitFor("acquired", "error")),
    );

    expect(results.filter((result) => result.type === "acquired")).toHaveLength(1);
    expect(results.filter((result) => result.code === "ELOCKED")).toHaveLength(7);
    expect((await stat(lockfilePath)).isDirectory()).toBe(true);
  });

  it(
    "does not reclaim a heartbeat-refreshed active owner",
    async () => {
      const { target, lockfilePath } = await makeTarget();
      const holder = start("@bybrave/proper-lockfile2", "hold", target, lockfilePath);
      await holder.waitFor("acquired");
      await new Promise((resolve) => setTimeout(resolve, STALE_MS + 1_500));

      const contender = start(
        "@bybrave/proper-lockfile2",
        "hold",
        target,
        lockfilePath,
      );
      await expect(contender.waitFor("error")).resolves.toMatchObject({
        code: "ELOCKED",
      });
      expect((await stat(lockfilePath)).isDirectory()).toBe(true);
    },
    ACTIVE_OWNER_TEST_TIMEOUT_MS,
  );

  it("reclaims a lock left by a killed owner and reports the reclaim", async () => {
    const { target, lockfilePath } = await makeTarget();
    const holder = start("@bybrave/proper-lockfile2", "hold", target, lockfilePath);
    await holder.waitFor("acquired");
    holder.process.kill("SIGKILL");
    await once(holder.process, "exit");
    await new Promise((resolve) => setTimeout(resolve, STALE_MS + 1_500));

    const recovered = start("@bybrave/proper-lockfile2", "hold", target, lockfilePath);
    await expect(recovered.waitFor("reclaimed")).resolves.toMatchObject({
      type: "reclaimed",
    });
    await expect(recovered.waitFor("acquired")).resolves.toMatchObject({
      type: "acquired",
    });
  });

  it("keeps a compromised acquired lease fenced", async () => {
    const { target, lockfilePath } = await makeTarget();
    const holder = start("@bybrave/proper-lockfile2", "hold", target, lockfilePath);
    await holder.waitFor("acquired");
    await rm(lockfilePath, { recursive: true, force: true });
    await expect(holder.waitFor("compromised")).resolves.toMatchObject({
      type: "compromised",
    });
  });

  it("supports Unicode and space-containing instance paths", async () => {
    const { target, lockfilePath } = await makeTarget("heptalogos lock 中文 space-");
    const holder = start("@bybrave/proper-lockfile2", "hold", target, lockfilePath);
    await expect(holder.waitFor("acquired")).resolves.toMatchObject({
      type: "acquired",
    });
    expect((await stat(lockfilePath)).isDirectory()).toBe(true);
  });
});
