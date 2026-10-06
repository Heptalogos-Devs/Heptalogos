// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execa, type ResultPromise } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import {
  asDurableCodeVersion,
  digestCanonicalJson,
  type DurableCodeVersion,
  type WorkItemId,
} from "@heptalogos/foundation-contracts";
import { dispatchAttemptIdToWorkflowId } from "@heptalogos/work-queue";
import {
  BOOTSTRAP_PASSWORD,
  boot,
  cleanupCanonicalPostgresFixtures,
  describeRealPostgres,
  makeFixture,
  queryAs,
  stopFixturePrivatePostgres,
  type Fixture,
} from "../support/canonical-postgres.js";

const describePostgres = describeRealPostgres === undefined ? describe.skip : describe;
const childEntry = fileURLToPath(
  new URL("../support/durable-work-child.ts", import.meta.url),
);
const childTimeoutMs = 180_000;

type ChildMode =
  | "commit-before-dispatch"
  | "engine-before-execution"
  | "running-before-terminal"
  | "terminal-before-checkpoint"
  | "signal-loss"
  | "observe-version"
  | "lease-loss"
  | "crash-budget"
  | "crash-budget-recover"
  | "recover";

type ChildEvent = {
  readonly type: string;
  readonly workItemId?: WorkItemId;
  readonly dispatchRevision?: number;
  readonly dispatchAttemptId?: string;
  readonly bootId?: string;
  readonly instanceId?: string;
  readonly state?: string;
  readonly message?: string;
  readonly problemCode?: string;
};

type ChildWaiter = {
  readonly types: ReadonlySet<string>;
  readonly resolve: (event: ChildEvent) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

function safeChildError(child: DurableWorkChild, event?: ChildEvent): Error {
  const detail = event?.message ?? event?.problemCode ?? "child process failed";
  const stderr = child.stderrText.replace(
    /CANONICAL_PG_TEST_[A-Z0-9_]+/gu,
    "[redacted]",
  );
  return new Error(
    `${detail}${stderr.trim() === "" ? "" : `; stderr: ${stderr.slice(-2_000)}`}`,
  );
}

class DurableWorkChild {
  private readonly child: ResultPromise;
  private readonly events: ChildEvent[] = [];
  private readonly waiters = new Set<ChildWaiter>();
  private outputRemainder = "";
  private _stderrText = "";

  constructor(
    fixture: Fixture,
    mode: ChildMode,
    counterPath: string,
    versionLabel = "current",
    workItemId?: WorkItemId,
  ) {
    const args = [
      "--experimental-strip-types",
      childEntry,
      fixture.anchorRoot,
      qualifiedPostgresBin(),
      String(fixture.port),
      mode,
      counterPath,
      versionLabel,
      ...(workItemId === undefined ? [] : [workItemId]),
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
      if (result.exitCode !== 0) {
        const error = safeChildError(this);
        for (const waiter of this.waiters) {
          clearTimeout(waiter.timer);
          waiter.reject(error);
        }
        this.waiters.clear();
      }
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
      const prefix = "HEPTALOGOS_EVENT ";
      if (!line.startsWith(prefix)) continue;
      try {
        const value = JSON.parse(line.slice(prefix.length)) as ChildEvent;
        if (typeof value.type === "string") this.acceptEvent(value);
      } catch {
        // Vendor logs and malformed diagnostic lines are not semantic events.
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
    if (event.type === "ERROR") {
      const error = safeChildError(this, event);
      for (const waiter of [...this.waiters]) {
        this.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
  }

  async waitFor(...types: [string, ...string[]]): Promise<ChildEvent> {
    const expected = new Set(types);
    const index = this.events.findIndex((event) => expected.has(event.type));
    if (index >= 0) return this.events.splice(index, 1)[0]!;
    return new Promise<ChildEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(safeChildError(this));
      }, childTimeoutMs);
      const waiter: ChildWaiter = {
        types: expected,
        resolve: (event) => resolve(event),
        reject,
        timer,
      };
      this.waiters.add(waiter);
    });
  }

  async waitForWithin(
    timeoutMs: number,
    ...types: [string, ...string[]]
  ): Promise<ChildEvent | undefined> {
    const expected = new Set(types);
    const index = this.events.findIndex((event) => expected.has(event.type));
    if (index >= 0) return this.events.splice(index, 1)[0]!;
    return new Promise<ChildEvent | undefined>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        resolve(undefined);
      }, timeoutMs);
      const waiter: ChildWaiter = {
        types: expected,
        resolve: (event) => resolve(event),
        reject,
        timer,
      };
      this.waiters.add(waiter);
    });
  }

  send(command: "COMMIT" | "RELEASE"): void {
    if (this.child.stdin === null) throw new Error("child stdin is not available");
    this.child.stdin.write(`${command}\n`);
  }

  async release(): Promise<void> {
    this.send("RELEASE");
    const event = await this.waitFor("RELEASED", "ERROR");
    if (event.type !== "RELEASED") throw safeChildError(this, event);
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

function qualifiedPostgresBin(): string {
  if (process.env.HEPTALOGOS_TEST_PG_BIN === undefined) {
    throw new Error("HEPTALOGOS_TEST_PG_BIN is required for durable recovery tests");
  }
  return process.env.HEPTALOGOS_TEST_PG_BIN;
}

function durableVersion(label: string): DurableCodeVersion {
  return asDurableCodeVersion(
    digestCanonicalJson("test.durable-work-code/v1", { version: label }),
  );
}

function workflowId(event: ChildEvent): string {
  if (event.dispatchAttemptId === undefined) {
    throw new Error(`${event.type} did not include a dispatch attempt identity`);
  }
  return dispatchAttemptIdToWorkflowId(event.dispatchAttemptId as never);
}

async function workItemRow(
  fixture: Fixture,
  workItemId: WorkItemId,
): Promise<Record<string, unknown> | undefined> {
  return (
    await queryAs(
      fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT state, dispatch_revision, active_attempt_id, outcome
         FROM "heptalogos"."work_item"
        WHERE work_item_id = $1`,
      [workItemId],
    )
  ).rows[0];
}

async function workflowRow(
  fixture: Fixture,
  workflow: string,
): Promise<Record<string, unknown> | undefined> {
  return (
    await queryAs(
      fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT workflow_uuid, status, application_version, executor_id,
              queue_name, priority, queue_partition_key
         FROM "dbos"."workflow_status"
        WHERE workflow_uuid = $1`,
      [workflow],
    )
  ).rows[0];
}

async function counterLines(path: string): Promise<string[]> {
  try {
    const contents = await readFile(path, "utf8");
    return contents.split(/\r?\n/u).filter((line) => line !== "");
  } catch {
    return [];
  }
}

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 30_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("durable recovery condition was not reached before timeout");
}

const activeChildren = new Set<DurableWorkChild>();
const activeFixtures: Fixture[] = [];

afterEach(async () => {
  for (const child of activeChildren) await child.kill().catch(() => undefined);
  activeChildren.clear();
  for (const fixture of activeFixtures.splice(0)) {
    await stopFixturePrivatePostgres(fixture).catch(() => undefined);
  }
  await cleanupCanonicalPostgresFixtures();
}, 180_000);

function startChild(
  fixture: Fixture,
  mode: ChildMode,
  counterPath: string,
  versionLabel = "current",
  workItemId?: WorkItemId,
): DurableWorkChild {
  const child = new DurableWorkChild(
    fixture,
    mode,
    counterPath,
    versionLabel,
    workItemId,
  );
  activeChildren.add(child);
  return child;
}

async function keepFixturePostgresRunning(fixture: Fixture): Promise<void> {
  const bootResult = await boot(fixture);
  await bootResult.host.shutdownKeepingPrivatePostgres({
    async retire() {
      // This helper has already stopped the owned Host composition.
    },
  });
}

async function killAfterCrash(child: DurableWorkChild): Promise<void> {
  await child.kill();
  activeChildren.delete(child);
}

describePostgres.sequential("Durable WorkItem process recovery", () => {
  it("recovers a canonical commit that never reached the engine", async () => {
    const fixture = await makeFixture();
    activeFixtures.push(fixture);
    await keepFixturePostgresRunning(fixture);
    const counterPath = join(fixture.roots.TEMP, "recovery-no-dispatch-counter.log");
    const first = startChild(fixture, "commit-before-dispatch", counterPath);
    const firstReady = await first.waitFor("READY");
    const committed = await first.waitFor("WORK_COMMITTED");
    expect(await workItemRow(fixture, committed.workItemId!)).toMatchObject({
      state: "PENDING",
      dispatch_revision: "1",
      active_attempt_id: null,
    });
    await killAfterCrash(first);

    const restarted = startChild(
      fixture,
      "recover",
      counterPath,
      "current",
      committed.workItemId,
    );
    const secondReady = await restarted.waitFor("READY");
    expect(secondReady.instanceId).toBe(firstReady.instanceId);
    expect(secondReady.bootId).not.toBe(firstReady.bootId);
    const recovered = await restarted.waitFor("RECOVERED");
    expect(recovered.state).toBe("SUCCEEDED");
    expect(await workItemRow(fixture, committed.workItemId!)).toMatchObject({
      state: "SUCCEEDED",
      dispatch_revision: "1",
    });
    await restarted.release();
    activeChildren.delete(restarted);
  }, 240_000);

  it("recovers an engine projection before the first RUNNING claim", async () => {
    const fixture = await makeFixture();
    activeFixtures.push(fixture);
    await keepFixturePostgresRunning(fixture);
    const counterPath = join(fixture.roots.TEMP, "recovery-before-running-counter.log");
    const first = startChild(fixture, "engine-before-execution", counterPath);
    const firstReady = await first.waitFor("READY");
    const projected = await first.waitFor("ENGINE_PROJECTED");
    const workflow = workflowId(projected);
    expect(await workItemRow(fixture, projected.workItemId!)).toMatchObject({
      state: "PENDING",
      active_attempt_id: null,
    });
    expect(await workflowRow(fixture, workflow)).toMatchObject({
      status: expect.stringMatching(/^(PENDING|ENQUEUED|DELAYED)$/u),
      application_version: durableVersion("current"),
    });
    await killAfterCrash(first);

    const restarted = startChild(
      fixture,
      "recover",
      counterPath,
      "current",
      projected.workItemId,
    );
    const secondReady = await restarted.waitFor("READY");
    expect(secondReady.instanceId).toBe(firstReady.instanceId);
    expect(secondReady.bootId).not.toBe(firstReady.bootId);
    await restarted.waitFor("RECOVERED");
    expect(await workflowRow(fixture, workflow)).toMatchObject({
      status: "SUCCESS",
      executor_id: firstReady.instanceId,
    });
    expect(await counterLines(counterPath)).toHaveLength(1);
    await restarted.release();
    activeChildren.delete(restarted);
  }, 240_000);

  it("re-enters the same RUNNING attempt after a process crash", async () => {
    const fixture = await makeFixture();
    activeFixtures.push(fixture);
    await keepFixturePostgresRunning(fixture);
    const counterPath = join(
      fixture.roots.TEMP,
      "recovery-running-attempt-counter.log",
    );
    const first = startChild(fixture, "running-before-terminal", counterPath);
    await first.waitFor("READY");
    const running = await first.waitFor("RUNNING_COMMITTED");
    const expectedAttempt = running.dispatchAttemptId;
    expect(await workItemRow(fixture, running.workItemId!)).toMatchObject({
      state: "RUNNING",
      dispatch_revision: "1",
      active_attempt_id: expectedAttempt,
    });
    await killAfterCrash(first);

    const restarted = startChild(
      fixture,
      "recover",
      counterPath,
      "current",
      running.workItemId,
    );
    await restarted.waitFor("READY");
    const recovered = await restarted.waitFor("RECOVERED");
    expect(recovered.dispatchAttemptId).toBe(expectedAttempt);
    expect(await workItemRow(fixture, running.workItemId!)).toMatchObject({
      state: "SUCCEEDED",
      dispatch_revision: "1",
    });
    expect(await counterLines(counterPath)).toHaveLength(2);
    expect(expectedAttempt).toBe(running.dispatchAttemptId);
    await restarted.release();
    activeChildren.delete(restarted);
  }, 240_000);

  it("replays a terminal canonical result without rerunning the handler", async () => {
    const fixture = await makeFixture();
    activeFixtures.push(fixture);
    await keepFixturePostgresRunning(fixture);
    const counterPath = join(
      fixture.roots.TEMP,
      "recovery-terminal-replay-counter.log",
    );
    const first = startChild(fixture, "terminal-before-checkpoint", counterPath);
    await first.waitFor("READY");
    const terminal = await first.waitFor("TERMINAL_COMMITTED");
    expect(await workItemRow(fixture, terminal.workItemId!)).toMatchObject({
      state: "SUCCEEDED",
      dispatch_revision: "1",
    });
    expect(await counterLines(counterPath)).toHaveLength(1);
    const workflow = workflowId(terminal);
    await killAfterCrash(first);

    const restarted = startChild(
      fixture,
      "recover",
      counterPath,
      "current",
      terminal.workItemId,
    );
    await restarted.waitFor("READY");
    await restarted.waitFor("RECOVERED");
    expect(await workItemRow(fixture, terminal.workItemId!)).toMatchObject({
      state: "SUCCEEDED",
      dispatch_revision: "1",
    });
    expect(await counterLines(counterPath)).toHaveLength(1);
    await waitUntil(
      async () => (await workflowRow(fixture, workflow))?.status === "SUCCESS",
    );
    await restarted.release();
    activeChildren.delete(restarted);
  }, 240_000);

  it("keeps a different durable-code version from recovering the old workflow", async () => {
    const fixture = await makeFixture();
    activeFixtures.push(fixture);
    await keepFixturePostgresRunning(fixture);
    const counterPath = join(fixture.roots.TEMP, "recovery-code-version-counter.log");
    const first = startChild(fixture, "engine-before-execution", counterPath, "A");
    await first.waitFor("READY");
    const projected = await first.waitFor("ENGINE_PROJECTED");
    const workflow = workflowId(projected);
    await killAfterCrash(first);

    const wrongVersion = startChild(
      fixture,
      "observe-version",
      counterPath,
      "B",
      projected.workItemId,
    );
    await wrongVersion.waitFor("READY");
    const observed = await wrongVersion.waitFor("VERSION_OBSERVED");
    expect(observed.state).not.toBe("SUCCEEDED");
    expect(await counterLines(counterPath)).toHaveLength(0);
    expect(await workflowRow(fixture, workflow)).toMatchObject({
      application_version: durableVersion("A"),
    });
    await wrongVersion.release();
    activeChildren.delete(wrongVersion);

    const matchingVersion = startChild(
      fixture,
      "recover",
      counterPath,
      "A",
      projected.workItemId,
    );
    await matchingVersion.waitFor("READY");
    await matchingVersion.waitFor("RECOVERED");
    expect(await counterLines(counterPath)).toHaveLength(1);
    expect(await workflowRow(fixture, workflow)).toMatchObject({ status: "SUCCESS" });
    await matchingVersion.release();
    activeChildren.delete(matchingVersion);
  }, 300_000);

  it("completes after Signal loss because the canonical scan remains authoritative", async () => {
    const fixture = await makeFixture();
    activeFixtures.push(fixture);
    await keepFixturePostgresRunning(fixture);
    const counterPath = join(fixture.roots.TEMP, "recovery-signal-loss-counter.log");
    const first = startChild(fixture, "signal-loss", counterPath);
    await first.waitFor("READY");
    await first.waitFor("SIGNAL_READY");
    await queryAs(
      fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
        WHERE application_name = 'heptalogos-signal-listener'
          AND pid <> pg_backend_pid()`,
    );
    first.send("COMMIT");
    const committed = await first.waitFor("WORK_COMMITTED");
    expect(await workItemRow(fixture, committed.workItemId!)).toMatchObject({
      state: "PENDING",
    });
    await killAfterCrash(first);

    const restarted = startChild(
      fixture,
      "recover",
      counterPath,
      "current",
      committed.workItemId,
    );
    await restarted.waitFor("READY");
    await restarted.waitFor("RECOVERED");
    expect(await counterLines(counterPath)).toHaveLength(1);
    await restarted.release();
    activeChildren.delete(restarted);
  }, 240_000);

  it("does not fabricate success when the authentic Host lease is lost", async () => {
    const fixture = await makeFixture();
    activeFixtures.push(fixture);
    await keepFixturePostgresRunning(fixture);
    const counterPath = join(fixture.roots.TEMP, "recovery-lease-loss-counter.log");
    const first = startChild(fixture, "lease-loss", counterPath);
    await first.waitFor("READY");
    const running = await first.waitFor("RUNNING_COMMITTED");
    const leasePid = await findHostLeaseBackend(fixture);
    await queryAs(
      fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      "SELECT pg_terminate_backend($1::integer) AS terminated",
      [leasePid],
    );
    await first.waitFor("LEASE_FENCED");
    expect(await workItemRow(fixture, running.workItemId!)).not.toMatchObject({
      state: "SUCCEEDED",
    });
    await killAfterCrash(first);

    const restarted = startChild(
      fixture,
      "recover",
      counterPath,
      "current",
      running.workItemId,
    );
    await restarted.waitFor("READY");
    await restarted.waitFor("RECOVERED");
    expect(await workItemRow(fixture, running.workItemId!)).toMatchObject({
      state: "SUCCEEDED",
    });
    await restarted.release();
    activeChildren.delete(restarted);
  }, 300_000);

  it("records engine recovery exhaustion without terminalizing the WorkItem", async () => {
    const fixture = await makeFixture();
    activeFixtures.push(fixture);
    await keepFixturePostgresRunning(fixture);
    const counterPath = join(
      fixture.roots.TEMP,
      "recovery-engine-exhaustion-counter.log",
    );
    let child = startChild(fixture, "crash-budget", counterPath);
    await child.waitFor("READY");
    const crash = await child.waitFor("CRASH_POINT");
    const workItemId = crash.workItemId!;
    const workflow = workflowId(crash);
    await killAfterCrash(child);

    let exhausted = false;
    for (let attempt = 0; attempt < 10 && !exhausted; attempt += 1) {
      child = startChild(
        fixture,
        "crash-budget-recover",
        counterPath,
        "current",
        workItemId,
      );
      await child.waitFor("READY");
      const statusAtBoot = await workflowRow(fixture, workflow);
      exhausted = statusAtBoot?.status === "MAX_RECOVERY_ATTEMPTS_EXCEEDED";
      if (exhausted) {
        break;
      }
      const nextCrash = await child.waitForWithin(30_000, "CRASH_POINT", "ERROR");
      if (nextCrash?.type === "ERROR") throw safeChildError(child, nextCrash);
      if (nextCrash === undefined) {
        const status = await workflowRow(fixture, workflow);
        if (status?.status !== "MAX_RECOVERY_ATTEMPTS_EXCEEDED") {
          throw new Error(
            "DBOS recovery attempt ended without a crash point or exhaustion",
          );
        }
        exhausted = true;
        break;
      }
      await killAfterCrash(child);
    }

    if (!exhausted) {
      const status = await workflowRow(fixture, workflow);
      exhausted = status?.status === "MAX_RECOVERY_ATTEMPTS_EXCEEDED";
    }
    expect(exhausted).toBe(true);
    expect(await workflowRow(fixture, workflow)).toMatchObject({
      status: "MAX_RECOVERY_ATTEMPTS_EXCEEDED",
    });
    expect(await workItemRow(fixture, workItemId)).not.toMatchObject({
      state: "SUCCEEDED",
    });
    expect(await counterLines(counterPath)).toHaveLength(0);
    await child.release();
    activeChildren.delete(child);
  }, 360_000);
});

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
