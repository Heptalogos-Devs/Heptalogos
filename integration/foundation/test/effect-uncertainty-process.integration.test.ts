// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { execa, type ResultPromise } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import {
  BOOTSTRAP_PASSWORD,
  boot,
  cleanupCanonicalPostgresFixtures,
  describeRealPostgres,
  makeFixture,
  queryAs,
  type Fixture,
} from "../support/canonical-postgres.js";
import type { WorkItemId } from "@heptalogos/foundation-contracts";

const describePostgres = describeRealPostgres === undefined ? describe.skip : describe;
const childEntry = fileURLToPath(
  new URL("../support/durable-work-child.ts", import.meta.url),
);
const childTimeoutMs = 180_000;

type ChildMode =
  | "effect-success"
  | "effect-failure"
  | "effect-crash-after-write"
  | "effect-crash-before-write"
  | "effect-outcome-before-terminal"
  | "effect-lease-loss"
  | "effect-recover";

type ChildEvent = {
  readonly type: string;
  readonly workItemId?: WorkItemId;
  readonly effectOperationId?: string;
  readonly effectState?: string;
  readonly state?: string;
  readonly message?: string;
};

type ChildWaiter = {
  readonly types: ReadonlySet<string>;
  readonly resolve: (event: ChildEvent) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

function qualifiedPostgresBin(): string {
  if (process.env.HEPTALOGOS_TEST_PG_BIN === undefined) {
    throw new Error(
      "HEPTALOGOS_TEST_PG_BIN is required for effect process qualification",
    );
  }
  return process.env.HEPTALOGOS_TEST_PG_BIN;
}

function childError(child: EffectChild, event?: ChildEvent): Error {
  const detail = event?.message ?? event?.type ?? "Effect child process failed";
  const stderr = child.stderrText.trim();
  return new Error(
    `${detail}${stderr === "" ? "" : `; stderr: ${stderr.slice(-2_000)}`}`,
  );
}

class EffectChild {
  private readonly child: ResultPromise;
  private readonly events: ChildEvent[] = [];
  private readonly waiters = new Set<ChildWaiter>();
  private outputRemainder = "";
  private _stderrText = "";
  private failure: Error | undefined;

  constructor(
    fixture: Fixture,
    mode: ChildMode,
    workCounterPath: string,
    effectSinkPath: string,
    workItemId?: WorkItemId,
  ) {
    const args = [
      "--experimental-strip-types",
      childEntry,
      fixture.anchorRoot,
      qualifiedPostgresBin(),
      String(fixture.port),
      mode,
      workCounterPath,
      "current",
      ...(workItemId === undefined ? [""] : [workItemId]),
      effectSinkPath,
    ];
    this.child = execa(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      reject: false,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
    this.child.stdout?.on("data", (chunk: Buffer | string) => {
      this.consumeStdout(String(chunk));
    });
    this.child.stderr?.on("data", (chunk: Buffer | string) => {
      this._stderrText += String(chunk);
    });
    void this.child.then((result) => {
      if (result.exitCode === 0) {
        this.failure = childError(this, { type: "child exited before expected event" });
      } else {
        this.failure = childError(this);
      }
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(this.failure);
      }
      this.waiters.clear();
    });
  }

  get stderrText(): string {
    return this._stderrText;
  }

  private consumeStdout(chunk: string): void {
    this.outputRemainder += chunk;
    const lines = this.outputRemainder.split(/\r?\n/u);
    this.outputRemainder = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("HEPTALOGOS_EVENT ")) continue;
      try {
        const event = JSON.parse(line.slice("HEPTALOGOS_EVENT ".length)) as ChildEvent;
        if (typeof event.type === "string") this.acceptEvent(event);
      } catch {
        // Non-event child diagnostics are intentionally ignored.
      }
    }
  }

  private acceptEvent(event: ChildEvent): void {
    this.events.push(event);
    for (const waiter of [...this.waiters]) {
      if (!waiter.types.has(event.type)) continue;
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(event);
    }
    if (event.type !== "ERROR") return;
    const error = childError(this, event);
    this.failure = error;
    for (const waiter of [...this.waiters]) {
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  async waitFor(...types: [string, ...string[]]): Promise<ChildEvent> {
    const expected = new Set(types);
    const index = this.events.findIndex((event) => expected.has(event.type));
    if (index >= 0) return this.events.splice(index, 1)[0]!;
    if (this.failure !== undefined) throw this.failure;
    return new Promise<ChildEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(childError(this));
      }, childTimeoutMs);
      const waiter: ChildWaiter = { types: expected, resolve, reject, timer };
      this.waiters.add(waiter);
    });
  }

  send(command: "RELEASE"): void {
    if (this.child.stdin === null) throw new Error("effect child stdin is unavailable");
    this.child.stdin.write(`${command}\n`);
  }

  async release(): Promise<void> {
    this.send("RELEASE");
    const event = await this.waitFor("RELEASED", "ERROR");
    if (event.type === "ERROR") throw childError(this, event);
    await this.kill();
  }

  async kill(): Promise<void> {
    this.child.kill();
    const settled = await Promise.race([
      this.child.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 2_000)),
    ]);
    if (!settled) this.child.kill("SIGKILL");
    await this.child;
  }
}

const activeChildren = new Set<EffectChild>();
const activeFixtures: Fixture[] = [];

afterEach(async () => {
  for (const child of activeChildren) await child.kill().catch(() => undefined);
  activeChildren.clear();
  await cleanupCanonicalPostgresFixtures();
}, 300_000);

async function keepFixturePostgresRunning(fixture: Fixture): Promise<void> {
  const bootResult = await boot(fixture);
  await bootResult.host.shutdownKeepingPrivatePostgres({
    async retire() {
      // The process fixture owns no Runtime composition.
    },
  });
}

function startChild(
  fixture: Fixture,
  mode: ChildMode,
  workCounterPath: string,
  effectSinkPath: string,
  workItemId?: WorkItemId,
): EffectChild {
  const child = new EffectChild(
    fixture,
    mode,
    workCounterPath,
    effectSinkPath,
    workItemId,
  );
  activeChildren.add(child);
  return child;
}

async function sinkLines(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/u).filter((line) => line !== "");
  } catch {
    return [];
  }
}

async function workItemRow(fixture: Fixture, workItemId: WorkItemId) {
  return (
    await queryAs(
      fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT state, outcome
         FROM "heptalogos"."work_item"
        WHERE work_item_id = $1`,
      [workItemId],
    )
  ).rows[0];
}

async function effectRow(fixture: Fixture, effectOperationId: string) {
  return (
    await queryAs(
      fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT state, outcome
         FROM "heptalogos"."effect_operation"
        WHERE effect_operation_id = $1`,
      [effectOperationId],
    )
  ).rows[0];
}

async function effectActivityKinds(fixture: Fixture, effectOperationId: string) {
  return (
    await queryAs(
      fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT kind
         FROM "heptalogos"."activity_record"
        WHERE operation_id = $1
        ORDER BY started_at, activity_id`,
      [effectOperationId],
    )
  ).rows.map((row) => row.kind as string);
}

async function effectEvidence(fixture: Fixture, effectOperationId: string) {
  return (
    await queryAs(
      fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT evidence_kind, fact_ref
         FROM "heptalogos"."evidence_record"
        WHERE subject_ref = $1
        ORDER BY recorded_at, evidence_id`,
      [effectOperationId],
    )
  ).rows as Array<{ readonly evidence_kind: string; readonly fact_ref: string | null }>;
}

async function findHostLeaseBackend(fixture: Fixture): Promise<number> {
  const result = await queryAs(
    fixture,
    "heptalogos_bootstrap",
    BOOTSTRAP_PASSWORD,
    `SELECT activity.pid
       FROM pg_locks AS locks
       JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
      WHERE locks.locktype = 'advisory'
        AND activity.usename = 'heptalogos_host_lease'
        AND activity.datname = 'heptalogos'`,
  );
  const pid = result.rows[0]?.pid;
  if (pid === undefined) throw new Error("Host lease backend was not found");
  return Number(pid);
}

async function crashAfter(child: EffectChild, event: ChildEvent): Promise<void> {
  expect(event.workItemId).toBeDefined();
  await child.kill();
  activeChildren.delete(child);
}

describePostgres.sequential(
  "EffectOperation process crash/restart qualification",
  () => {
    it("records one known successful external write", async () => {
      const fixture = await makeFixture();
      activeFixtures.push(fixture);
      const workCounterPath = `${fixture.roots.TEMP}\\effect-success-work.log`;
      const sinkPath = `${fixture.roots.TEMP}\\effect-success-sink.log`;
      const child = startChild(fixture, "effect-success", workCounterPath, sinkPath);
      await child.waitFor("READY");
      const outcome = await child.waitFor("EFFECT_OUTCOME");
      const completed = await child.waitFor("EFFECT_WORK_SUCCEEDED");
      expect(outcome.effectState).toBe("SUCCEEDED");
      expect(await sinkLines(sinkPath)).toHaveLength(1);
      expect(await effectRow(fixture, outcome.effectOperationId!)).toMatchObject({
        state: "SUCCEEDED",
      });
      expect(await workItemRow(fixture, completed.workItemId!)).toMatchObject({
        state: "SUCCEEDED",
      });
      await child.release();
      activeChildren.delete(child);
    }, 300_000);

    it("settles a definitive no-effect failure without an external write", async () => {
      const fixture = await makeFixture();
      activeFixtures.push(fixture);
      const workCounterPath = `${fixture.roots.TEMP}\\effect-failure-work.log`;
      const sinkPath = `${fixture.roots.TEMP}\\effect-failure-sink.log`;
      const child = startChild(fixture, "effect-failure", workCounterPath, sinkPath);
      await child.waitFor("READY");
      const outcome = await child.waitFor("EFFECT_OUTCOME");
      const completed = await child.waitFor("EFFECT_WORK_SUCCEEDED");
      expect(outcome.effectState).toBe("FAILED");
      expect(await sinkLines(sinkPath)).toHaveLength(0);
      expect(await effectRow(fixture, outcome.effectOperationId!)).toMatchObject({
        state: "FAILED",
      });
      expect(await workItemRow(fixture, completed.workItemId!)).toMatchObject({
        state: "SUCCEEDED",
      });
      await child.release();
      activeChildren.delete(child);
    }, 300_000);

    it("turns a crash after the external write into UNCERTAIN without redispatch", async () => {
      const fixture = await makeFixture();
      activeFixtures.push(fixture);
      await keepFixturePostgresRunning(fixture);
      const workCounterPath = `${fixture.roots.TEMP}\\effect-after-write-work.log`;
      const sinkPath = `${fixture.roots.TEMP}\\effect-after-write-sink.log`;
      const first = startChild(
        fixture,
        "effect-crash-after-write",
        workCounterPath,
        sinkPath,
      );
      await first.waitFor("READY");
      const written = await first.waitFor("EFFECT_EXTERNAL_WRITTEN");
      const workItemId = written.workItemId!;
      const effectOperationId = written.effectOperationId!;
      await crashAfter(first, written);
      expect(await sinkLines(sinkPath)).toHaveLength(1);

      const restarted = startChild(
        fixture,
        "effect-recover",
        workCounterPath,
        sinkPath,
        workItemId,
      );
      await restarted.waitFor("READY");
      const recovered = await restarted.waitFor("EFFECT_OUTCOME");
      expect(recovered.effectOperationId).toBe(effectOperationId);
      expect(recovered.effectState).toBe("UNCERTAIN");
      await restarted.waitFor("EFFECT_RECOVERED");
      expect(await sinkLines(sinkPath)).toHaveLength(1);
      expect(await effectActivityKinds(fixture, effectOperationId)).toContain(
        "effect.recover-uncertain",
      );
      expect(await effectEvidence(fixture, effectOperationId)).toEqual(
        expect.arrayContaining([
          { evidence_kind: "effect.outcome", fact_ref: "recovered" },
        ]),
      );
      expect(await effectRow(fixture, effectOperationId)).toMatchObject({
        state: "UNCERTAIN",
      });
      expect(await workItemRow(fixture, workItemId)).toMatchObject({
        state: "SUCCEEDED",
      });
      await restarted.release();
      activeChildren.delete(restarted);
    }, 360_000);

    it("conservatively turns a crash before the external write into UNCERTAIN", async () => {
      const fixture = await makeFixture();
      activeFixtures.push(fixture);
      await keepFixturePostgresRunning(fixture);
      const workCounterPath = `${fixture.roots.TEMP}\\effect-before-write-work.log`;
      const sinkPath = `${fixture.roots.TEMP}\\effect-before-write-sink.log`;
      const first = startChild(
        fixture,
        "effect-crash-before-write",
        workCounterPath,
        sinkPath,
      );
      await first.waitFor("READY");
      const dispatching = await first.waitFor("EFFECT_DISPATCHING");
      const workItemId = dispatching.workItemId!;
      const effectOperationId = dispatching.effectOperationId!;
      await crashAfter(first, dispatching);
      expect(await sinkLines(sinkPath)).toHaveLength(0);

      const restarted = startChild(
        fixture,
        "effect-recover",
        workCounterPath,
        sinkPath,
        workItemId,
      );
      await restarted.waitFor("READY");
      const recovered = await restarted.waitFor("EFFECT_OUTCOME");
      expect(recovered.effectOperationId).toBe(effectOperationId);
      expect(recovered.effectState).toBe("UNCERTAIN");
      await restarted.waitFor("EFFECT_RECOVERED");
      expect(await sinkLines(sinkPath)).toHaveLength(0);
      expect(await effectRow(fixture, effectOperationId)).toMatchObject({
        state: "UNCERTAIN",
      });
      expect(await workItemRow(fixture, workItemId)).toMatchObject({
        state: "SUCCEEDED",
      });
      await restarted.release();
      activeChildren.delete(restarted);
    }, 360_000);

    it("replays a committed effect outcome without a second external write", async () => {
      const fixture = await makeFixture();
      activeFixtures.push(fixture);
      await keepFixturePostgresRunning(fixture);
      const workCounterPath = `${fixture.roots.TEMP}\\effect-outcome-work.log`;
      const sinkPath = `${fixture.roots.TEMP}\\effect-outcome-sink.log`;
      const first = startChild(
        fixture,
        "effect-outcome-before-terminal",
        workCounterPath,
        sinkPath,
      );
      await first.waitFor("READY");
      const outcome = await first.waitFor("EFFECT_OUTCOME");
      const workItemId = outcome.workItemId!;
      const effectOperationId = outcome.effectOperationId!;
      expect(outcome.effectState).toBe("SUCCEEDED");
      await crashAfter(first, outcome);
      expect(await sinkLines(sinkPath)).toHaveLength(1);

      const restarted = startChild(
        fixture,
        "effect-recover",
        workCounterPath,
        sinkPath,
        workItemId,
      );
      await restarted.waitFor("READY");
      const replay = await restarted.waitFor("EFFECT_OUTCOME");
      expect(replay.effectOperationId).toBe(effectOperationId);
      expect(replay.effectState).toBe("SUCCEEDED");
      await restarted.waitFor("EFFECT_RECOVERED");
      expect(await sinkLines(sinkPath)).toHaveLength(1);
      expect(await effectRow(fixture, effectOperationId)).toMatchObject({
        state: "SUCCEEDED",
      });
      expect(await workItemRow(fixture, workItemId)).toMatchObject({
        state: "SUCCEEDED",
      });
      await restarted.release();
      activeChildren.delete(restarted);
    }, 360_000);

    it("fences a Host that loses ownership after the external write", async () => {
      const fixture = await makeFixture();
      activeFixtures.push(fixture);
      await keepFixturePostgresRunning(fixture);
      const workCounterPath = `${fixture.roots.TEMP}\\effect-lease-loss-work.log`;
      const sinkPath = `${fixture.roots.TEMP}\\effect-lease-loss-sink.log`;
      const first = startChild(fixture, "effect-lease-loss", workCounterPath, sinkPath);
      await first.waitFor("READY");
      const written = await first.waitFor("EFFECT_EXTERNAL_WRITTEN");
      const workItemId = written.workItemId!;
      const effectOperationId = written.effectOperationId!;
      const leasePid = await findHostLeaseBackend(fixture);
      await queryAs(
        fixture,
        "heptalogos_bootstrap",
        BOOTSTRAP_PASSWORD,
        "SELECT pg_terminate_backend($1::integer)",
        [leasePid],
      );
      await first.waitFor("LEASE_FENCED");
      await crashAfter(first, written);
      expect(await sinkLines(sinkPath)).toHaveLength(1);

      const restarted = startChild(
        fixture,
        "effect-recover",
        workCounterPath,
        sinkPath,
        workItemId,
      );
      await restarted.waitFor("READY");
      const recovered = await restarted.waitFor("EFFECT_OUTCOME");
      expect(recovered.effectOperationId).toBe(effectOperationId);
      expect(recovered.effectState).toBe("UNCERTAIN");
      await restarted.waitFor("EFFECT_RECOVERED");
      expect(await sinkLines(sinkPath)).toHaveLength(1);
      expect(await effectRow(fixture, effectOperationId)).toMatchObject({
        state: "UNCERTAIN",
      });
      expect(await workItemRow(fixture, workItemId)).toMatchObject({
        state: "SUCCEEDED",
      });
      await restarted.release();
      activeChildren.delete(restarted);
    }, 360_000);
  },
);
