// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { execa, type ResultPromise } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import { type WorkItemId } from "@heptalogos/foundation-contracts";
import { dispatchAttemptIdToWorkflowId } from "@heptalogos/work-queue";
import {
  BOOTSTRAP_PASSWORD,
  cleanupCanonicalPostgresFixtures,
  describeRealPostgres,
  makeFixture,
  queryAs,
  type Fixture,
} from "../support/canonical-postgres.js";

const describePostgres = describeRealPostgres === undefined ? describe.skip : describe;
const childEntry = fileURLToPath(
  new URL("../support/durable-work-child.ts", import.meta.url),
);
const childTimeoutMs = 180_000;

type FoundationEvent = {
  readonly type: string;
  readonly installationId?: string;
  readonly workItemId?: WorkItemId;
  readonly dispatchRevision?: number;
  readonly dispatchAttemptId?: string;
  readonly bootId?: string;
  readonly instanceId?: string;
  readonly continuityEpochId?: string;
  readonly hostOwnershipToken?: string;
  readonly state?: string;
  readonly activeWorkAttemptInvocations?: number;
  readonly message?: string;
};

type FoundationWaiter = {
  readonly types: ReadonlySet<string>;
  readonly resolve: (event: FoundationEvent) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

function qualifiedPostgresBin(): string {
  if (process.env.HEPTALOGOS_TEST_PG_BIN === undefined) {
    throw new Error("HEPTALOGOS_TEST_PG_BIN is required for Foundation spine tests");
  }
  return process.env.HEPTALOGOS_TEST_PG_BIN;
}

function childError(child: FoundationProcess, event?: FoundationEvent): Error {
  const detail = event?.message ?? event?.type ?? "Foundation child process failed";
  const stderr = child.stderrText.trim();
  return new Error(
    `${detail}${stderr === "" ? "" : `; stderr: ${stderr.slice(-2_000)}`}`,
  );
}

class FoundationProcess {
  private readonly child: ResultPromise;
  private readonly events: FoundationEvent[] = [];
  private readonly waiters = new Set<FoundationWaiter>();
  private outputRemainder = "";
  private _stderrText = "";
  private failure: Error | undefined;

  constructor(fixture: Fixture, mode: string, counterPath: string) {
    this.child = execa(
      process.execPath,
      [
        "--experimental-strip-types",
        childEntry,
        fixture.anchorRoot,
        qualifiedPostgresBin(),
        String(fixture.port),
        mode,
        counterPath,
        "current",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        reject: false,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      },
    );
    this.child.stdout?.on("data", (chunk: Buffer | string) => {
      this.consumeStdout(String(chunk));
    });
    this.child.stderr?.on("data", (chunk: Buffer | string) => {
      this._stderrText += String(chunk);
    });
    void this.child.then((result) => {
      if (result.exitCode === 0) {
        this.failure = childError(this, {
          type: "Foundation child exited before emitting the requested event",
        });
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
      const prefix = "HEPTALOGOS_EVENT ";
      if (!line.startsWith(prefix)) continue;
      try {
        const event = JSON.parse(line.slice(prefix.length)) as FoundationEvent;
        if (typeof event.type === "string") this.acceptEvent(event);
      } catch {
        // Child diagnostics that are not semantic events are ignored.
      }
    }
  }

  private acceptEvent(event: FoundationEvent): void {
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

  async waitFor(...types: [string, ...string[]]): Promise<FoundationEvent> {
    const expected = new Set(types);
    const index = this.events.findIndex((event) => expected.has(event.type));
    if (index >= 0) return this.events.splice(index, 1)[0]!;
    if (this.failure !== undefined) throw this.failure;
    return new Promise<FoundationEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(childError(this));
      }, childTimeoutMs);
      const waiter: FoundationWaiter = {
        types: expected,
        resolve,
        reject,
        timer,
      };
      this.waiters.add(waiter);
    });
  }

  send(command: "RELEASE"): void {
    if (this.child.stdin === null)
      throw new Error("Foundation child stdin is unavailable");
    this.child.stdin.write(`${command}\n`);
  }

  async release(): Promise<void> {
    this.send("RELEASE");
    const stopped = await this.waitFor("HOST_RELEASED", "ERROR");
    if (stopped.type === "ERROR") throw childError(this, stopped);
    expect(stopped.state).toBe("CLOSED");
    expect(stopped.activeWorkAttemptInvocations).toBe(0);
    const released = await this.waitFor("RELEASED", "ERROR");
    if (released.type === "ERROR") throw childError(this, released);
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

async function counterLines(path: string): Promise<string[]> {
  try {
    return (await readFile(path, "utf8")).split(/\r?\n/u).filter((line) => line !== "");
  } catch {
    return [];
  }
}

async function hostFenceRow(fixture: Fixture): Promise<Record<string, unknown>> {
  const result = await queryAs(
    fixture,
    "heptalogos_bootstrap",
    BOOTSTRAP_PASSWORD,
    `SELECT instance_id, ownership_revision, host_ownership_token, boot_id
       FROM "heptalogos"."host_ownership_fence"
      WHERE singleton = true`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Host ownership fence row is missing");
  return row;
}

async function workItemRow(
  fixture: Fixture,
  workItemId: WorkItemId,
): Promise<Record<string, unknown>> {
  const result = await queryAs(
    fixture,
    "heptalogos_bootstrap",
    BOOTSTRAP_PASSWORD,
    `SELECT work_item_id, state, dispatch_revision, active_attempt_id, outcome
       FROM "heptalogos"."work_item"
      WHERE work_item_id = $1`,
    [workItemId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("canonical WorkItem row is missing");
  return row;
}

async function workflowRow(
  fixture: Fixture,
  workflowId: string,
): Promise<Record<string, unknown>> {
  const result = await queryAs(
    fixture,
    "heptalogos_bootstrap",
    BOOTSTRAP_PASSWORD,
    `SELECT workflow_uuid, status, executor_id, queue_name
       FROM "dbos"."workflow_status"
      WHERE workflow_uuid = $1`,
    [workflowId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("DBOS workflow projection is missing");
  return row;
}

async function foundationProjectionColumns(
  fixture: Fixture,
): Promise<readonly Record<string, unknown>[]> {
  return (
    await queryAs(
      fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'heptalogos'
          AND table_name = 'work_item'
          AND column_name = 'workflow_uuid'`,
    )
  ).rows;
}

async function assertReady(fixture: Fixture, event: FoundationEvent): Promise<void> {
  expect(event.installationId).toBe(fixture.installationId);
  expect(event.instanceId).toBe(fixture.instanceId);
  expect(event.bootId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(event.continuityEpochId).toMatch(/^[0-9a-f-]{36}$/u);
  expect(event.hostOwnershipToken).toMatch(/^[0-9a-f-]{36}$/u);
  expect(event.state).toBe("ACTIVE");
  const fence = await hostFenceRow(fixture);
  expect(fence.instance_id).toBe(event.instanceId);
  expect(fence.boot_id).toBe(event.bootId);
  expect(fence.host_ownership_token).toBe(event.hostOwnershipToken);
}

const activeChildren = new Set<FoundationProcess>();

afterEach(async () => {
  for (const child of activeChildren) await child.kill().catch(() => undefined);
  activeChildren.clear();
  await cleanupCanonicalPostgresFixtures();
}, 180_000);

function startFoundationProcess(
  fixture: Fixture,
  mode: "foundation-boot-work-stop" | "foundation-restart-work-stop",
  counterPath: string,
): FoundationProcess {
  const child = new FoundationProcess(fixture, mode, counterPath);
  activeChildren.add(child);
  return child;
}

describePostgres.sequential("Foundation executable spine", () => {
  it("proves a real process can boot, execute canonical work, and stop", async () => {
    const fixture = await makeFixture();
    const counterPath = join(fixture.roots.TEMP, "foundation-spine-counter.log");
    const child = startFoundationProcess(
      fixture,
      "foundation-boot-work-stop",
      counterPath,
    );
    const ready = await child.waitFor("READY");
    await assertReady(fixture, ready);
    const completed = await child.waitFor("WORK_SUCCEEDED");
    expect(completed.workItemId).toBeDefined();
    expect(completed.state).toBe("SUCCEEDED");
    expect(completed.dispatchRevision).toBe(1);
    expect(completed.dispatchAttemptId).toBeDefined();

    const item = await workItemRow(fixture, completed.workItemId!);
    expect(item).toMatchObject({
      work_item_id: completed.workItemId,
      state: "SUCCEEDED",
      dispatch_revision: "1",
      active_attempt_id: null,
    });
    const workflowId = dispatchAttemptIdToWorkflowId(
      completed.dispatchAttemptId! as never,
    );
    expect(await workflowRow(fixture, workflowId)).toMatchObject({
      workflow_uuid: workflowId,
      status: "SUCCESS",
      executor_id: ready.instanceId,
      queue_name: "heptalogos.queue.durable-work.default",
    });
    expect(await foundationProjectionColumns(fixture)).toEqual([]);
    expect(await counterLines(counterPath)).toHaveLength(1);

    await child.release();
    expect(await counterLines(counterPath)).toHaveLength(1);
    activeChildren.delete(child);
  }, 240_000);

  it("proves the same instance restarts with new Host identity and new work", async () => {
    const fixture = await makeFixture();
    const counterPath = join(
      fixture.roots.TEMP,
      "foundation-spine-restart-counter.log",
    );
    const first = startFoundationProcess(
      fixture,
      "foundation-boot-work-stop",
      counterPath,
    );
    const firstReady = await first.waitFor("READY");
    await assertReady(fixture, firstReady);
    const firstCompleted = await first.waitFor("WORK_SUCCEEDED");
    await first.release();
    activeChildren.delete(first);
    expect(await counterLines(counterPath)).toHaveLength(1);

    const second = startFoundationProcess(
      fixture,
      "foundation-restart-work-stop",
      counterPath,
    );
    const secondReady = await second.waitFor("READY");
    await assertReady(fixture, secondReady);
    expect(secondReady.instanceId).toBe(firstReady.instanceId);
    expect(secondReady.bootId).not.toBe(firstReady.bootId);
    expect(secondReady.continuityEpochId).toBe(firstReady.continuityEpochId);
    expect(secondReady.hostOwnershipToken).not.toBe(firstReady.hostOwnershipToken);

    const secondCompleted = await second.waitFor("WORK_SUCCEEDED");
    expect(secondCompleted.workItemId).not.toBe(firstCompleted.workItemId);
    expect(await workItemRow(fixture, firstCompleted.workItemId!)).toMatchObject({
      state: "SUCCEEDED",
    });
    expect(await workItemRow(fixture, secondCompleted.workItemId!)).toMatchObject({
      state: "SUCCEEDED",
    });
    expect(await counterLines(counterPath)).toHaveLength(2);

    await second.release();
    expect(await counterLines(counterPath)).toHaveLength(2);
    activeChildren.delete(second);
  }, 240_000);
});
