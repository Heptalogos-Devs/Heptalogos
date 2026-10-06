// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest";
import {
  createEffectKindId,
  createEffectOperationId,
  type EffectOperationId,
} from "@heptalogos/foundation-contracts";
import {
  createEffectOperationService,
  type EffectDispatchPort,
} from "@heptalogos/effect-operation";
import { createEvidenceService } from "@heptalogos/evidence";
import {
  createExecutionContextRuntime,
  createExecutionLineageService,
  createPersistenceExecutionContextProvider,
} from "@heptalogos/execution-lineage";
import {
  createPersistenceService,
  type PersistenceService,
} from "@heptalogos/persistence";
import { createSystemTimeService } from "@heptalogos/time-service";
import {
  BOOTSTRAP_PASSWORD,
  boot,
  cleanupCanonicalPostgresFixtures,
  describeRealPostgres,
  makeFixture,
  queryAs,
  stopManagedHostWithoutRuntime,
  type BootResult,
} from "../support/canonical-postgres.js";

const describePostgres = describeRealPostgres === undefined ? describe.skip : describe;
const effectKind = createEffectKindId("synthetic.external-write");

interface RunningEffect {
  readonly bootResult: BootResult;
  readonly persistence: PersistenceService;
  readonly service: ReturnType<typeof createEffectOperationService>;
  readonly execution: ReturnType<typeof createExecutionContextRuntime>;
}

const running: RunningEffect[] = [];

afterEach(async () => {
  for (const item of running.splice(0)) {
    await item.persistence.close().catch(() => undefined);
    await stopManagedHostWithoutRuntime(item.bootResult.host).catch(() => undefined);
  }
  await cleanupCanonicalPostgresFixtures();
}, 240_000);

async function makeRunningEffect(): Promise<RunningEffect> {
  const fixture = await makeFixture();
  const bootResult = await boot(fixture);
  const time = createSystemTimeService();
  const execution = createExecutionContextRuntime(
    {
      installationId: bootResult.host.installationId,
      instanceId: bootResult.host.instanceId,
      bootId: bootResult.host.bootId,
      continuityEpochId: bootResult.host.continuityEpochId,
      hostOwnershipToken: bootResult.host.token,
    },
    time,
  );
  const persistence = createPersistenceService(
    bootResult.host.persistence,
    {
      maxConnections: 4,
      idleTimeoutMs: 5_000,
      connectionTimeoutMs: 10_000,
      statementTimeoutMs: 10_000,
      lockTimeoutMs: 10_000,
      idleInTransactionSessionTimeoutMs: 30_000,
      onBackgroundError() {},
    },
    createPersistenceExecutionContextProvider(execution),
  );
  const item: RunningEffect = {
    bootResult,
    persistence,
    execution,
    service: createEffectOperationService({
      persistence,
      execution,
      lineage: createExecutionLineageService(),
      evidence: createEvidenceService(time),
      time,
    }),
  };
  running.push(item);
  return item;
}

function request(effectOperationId: EffectOperationId = createEffectOperationId()) {
  return {
    effectOperationId,
    effectKind,
    requestVersion: 1,
    request: { message: "synthetic-effect", ordinal: 1 },
  } as const;
}

async function inActivity<T>(
  item: RunningEffect,
  operation: () => Promise<T>,
): Promise<T> {
  return item.execution.runActivity(
    {
      kind: "effect-qualification.root",
      importance: "significant",
      retentionClass: "retained",
      sensitivity: "operational",
    },
    operation,
  );
}

async function prepare(item: RunningEffect, id = createEffectOperationId()) {
  return inActivity(item, () => item.service.prepare(request(id)));
}

function successPort(
  dispatch: EffectDispatchPort["dispatch"],
  reconcile?: EffectDispatchPort["reconcile"],
): EffectDispatchPort {
  return {
    effectKind,
    dispatch,
    ...(reconcile === undefined ? {} : { reconcile }),
  };
}

async function effectRow(item: RunningEffect, id: EffectOperationId) {
  return (
    await queryAs(
      item.bootResult.fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT state, outcome
         FROM "heptalogos"."effect_operation"
        WHERE effect_operation_id = $1`,
      [id],
    )
  ).rows[0];
}

async function effectActivityKinds(item: RunningEffect, id: EffectOperationId) {
  return (
    await queryAs(
      item.bootResult.fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT kind
         FROM "heptalogos"."activity_record"
        WHERE operation_id = $1
        ORDER BY started_at, activity_id`,
      [id],
    )
  ).rows.map((row) => row.kind as string);
}

async function effectEvidence(item: RunningEffect, id: EffectOperationId) {
  return (
    await queryAs(
      item.bootResult.fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT evidence_kind, fact_ref
         FROM "heptalogos"."evidence_record"
        WHERE subject_ref = $1
        ORDER BY recorded_at, evidence_id`,
      [id],
    )
  ).rows as Array<{ readonly evidence_kind: string; readonly fact_ref: string | null }>;
}

describePostgres.sequential("EffectOperation PostgreSQL qualification", () => {
  it("prepares immutably, is idempotent, and retains effect evidence", async () => {
    const item = await makeRunningEffect();
    const id = createEffectOperationId();
    const created = await prepare(item, id);
    const existing = await prepare(item, id);

    expect(created.status).toBe("CREATED");
    expect(existing.status).toBe("EXISTING");
    await expect(
      inActivity(item, () =>
        item.service.prepare({
          ...request(id),
          request: { message: "different", ordinal: 1 },
        }),
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "effect.identity_conflict" },
    });
    await expect(effectRow(item, id)).resolves.toMatchObject({ state: "PREPARED" });

    await expect(effectActivityKinds(item, id)).resolves.toContain("effect.prepare");

    const evidence = await queryAs(
      item.bootResult.fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT evidence_kind
         FROM "heptalogos"."evidence_record"
        WHERE subject_ref = $1
        ORDER BY recorded_at, evidence_id`,
      [id],
    );
    expect(new Set(evidence.rows.map((row) => row.evidence_kind))).toEqual(
      new Set(["effect.prepared"]),
    );
  }, 240_000);

  it("commits definitive success and definitive failure as canonical outcomes", async () => {
    const item = await makeRunningEffect();
    const successId = createEffectOperationId();
    await prepare(item, successId);
    let successCalls = 0;
    const success = await inActivity(item, () =>
      item.service.dispatch(
        successId,
        successPort(async () => {
          successCalls += 1;
          return { status: "SUCCEEDED", receipt: { accepted: true } };
        }),
      ),
    );
    expect(success.state).toBe("SUCCEEDED");
    expect(successCalls).toBe(1);
    expect(await effectActivityKinds(item, successId)).toContain("effect.dispatch");
    expect(await effectEvidence(item, successId)).toEqual(
      expect.arrayContaining([
        { evidence_kind: "effect.dispatch-started", fact_ref: null },
        { evidence_kind: "effect.outcome", fact_ref: "SUCCEEDED" },
      ]),
    );

    const failureId = createEffectOperationId();
    await prepare(item, failureId);
    const failed = await inActivity(item, () =>
      item.service.dispatch(
        failureId,
        successPort(async () => ({
          status: "FAILED",
          problem: {
            schemaVersion: 1,
            problemCode: "synthetic.no-effect",
            category: "unavailable",
            retryClass: "manual",
            title: "The synthetic sink did not apply the effect",
          },
        })),
      ),
    );
    expect(failed.state).toBe("FAILED");
    await expect(effectRow(item, failureId)).resolves.toMatchObject({
      state: "FAILED",
    });
  }, 240_000);

  it("has one concurrent dispatch admission winner while the observer leaves it live", async () => {
    const item = await makeRunningEffect();
    const id = createEffectOperationId();
    await prepare(item, id);
    let calls = 0;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const port = successPort(async () => {
      calls += 1;
      entered();
      await releasePromise;
      return { status: "SUCCEEDED" };
    });
    const first = inActivity(item, () => item.service.dispatch(id, port));
    await enteredPromise;
    const second = inActivity(item, () => item.service.dispatch(id, port));
    const observed = await second;
    expect(observed.state).toBe("DISPATCHING");
    await expect(effectRow(item, id)).resolves.toMatchObject({ state: "DISPATCHING" });
    release();
    const winner = await first;

    expect(calls).toBe(1);
    expect(winner.state).toBe("SUCCEEDED");
    await expect(item.service.get(id)).resolves.toMatchObject({ state: "SUCCEEDED" });
  }, 240_000);

  it("normalizes ambiguous dispatch, never redispatches, and reconciles read-only", async () => {
    const item = await makeRunningEffect();
    const id = createEffectOperationId();
    await prepare(item, id);
    let dispatchCalls = 0;
    let reconcileCalls = 0;
    const uncertain = await inActivity(item, () =>
      item.service.dispatch(
        id,
        successPort(async () => {
          dispatchCalls += 1;
          throw new Error("the external boundary ended ambiguously");
        }),
      ),
    );
    expect(uncertain.state).toBe("UNCERTAIN");

    const unknown = await inActivity(item, () =>
      item.service.reconcile(
        id,
        successPort(
          async () => {
            dispatchCalls += 1;
            throw new Error("dispatch must not run during reconciliation");
          },
          async () => {
            reconcileCalls += 1;
            return { status: "UNKNOWN" };
          },
        ),
      ),
    );
    expect(unknown.state).toBe("UNCERTAIN");

    const resolved = await inActivity(item, () =>
      item.service.reconcile(
        id,
        successPort(
          async () => {
            dispatchCalls += 1;
            throw new Error("dispatch must never be used for refinement");
          },
          async () => {
            reconcileCalls += 1;
            return { status: "SUCCEEDED", receipt: { reconciled: true } };
          },
        ),
      ),
    );
    expect(resolved.state).toBe("SUCCEEDED");
    expect(dispatchCalls).toBe(1);
    expect(reconcileCalls).toBe(2);
    await expect(effectRow(item, id)).resolves.toMatchObject({ state: "SUCCEEDED" });
    expect(await effectActivityKinds(item, id)).toContain("effect.reconcile");
    expect(await effectEvidence(item, id)).toEqual(
      expect.arrayContaining([
        { evidence_kind: "effect.reconciled", fact_ref: "SUCCEEDED" },
      ]),
    );

    const failedId = createEffectOperationId();
    await prepare(item, failedId);
    let failedDispatchCalls = 0;
    const failedPort = successPort(
      async () => {
        failedDispatchCalls += 1;
        throw new Error("the external boundary is ambiguous for the failed case");
      },
      async () => ({
        status: "FAILED" as const,
        problem: {
          schemaVersion: 1 as const,
          problemCode: "synthetic.reconcile-no-effect",
          category: "unavailable" as const,
          retryClass: "manual" as const,
          title: "The synthetic effect was not applied",
        },
      }),
    );
    await inActivity(item, () => item.service.dispatch(failedId, failedPort));
    expect(failedDispatchCalls).toBe(1);
    const failed = await inActivity(item, () =>
      item.service.reconcile(failedId, failedPort),
    );
    expect(failed.state).toBe("FAILED");
    expect(failed.outcome).toMatchObject({
      status: "FAILED",
      problem: { problemCode: "synthetic.reconcile-no-effect" },
    });
    expect(failedDispatchCalls).toBe(1);
    await expect(effectRow(item, failedId)).resolves.toMatchObject({ state: "FAILED" });
  }, 240_000);

  it("keeps a stale Host from committing the admitted outcome", async () => {
    const item = await makeRunningEffect();
    const id = createEffectOperationId();
    await prepare(item, id);
    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dispatch = inActivity(item, () =>
      item.service.dispatch(
        id,
        successPort(async () => {
          entered();
          await releasePromise;
          return { status: "SUCCEEDED" };
        }),
      ),
    );
    await enteredPromise;
    const lease = await queryAs(
      item.bootResult.fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT activity.pid
         FROM pg_locks AS locks
         JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
        WHERE locks.locktype = 'advisory'
          AND activity.usename = 'heptalogos_host_lease'
          AND activity.datname = 'heptalogos'`,
    );
    const leasePid = lease.rows[0]?.pid;
    if (leasePid === undefined) throw new Error("Host lease backend was not found");
    await queryAs(
      item.bootResult.fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      "SELECT pg_terminate_backend($1::integer)",
      [Number(leasePid)],
    );
    if (!item.bootResult.host.signal.aborted) {
      await new Promise<void>((resolve) =>
        item.bootResult.host.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    }
    release();
    await expect(dispatch).rejects.toBeDefined();
    await expect(effectRow(item, id)).resolves.toMatchObject({ state: "DISPATCHING" });
  }, 240_000);

  it("keeps a fenced Host from refining an uncertain operation", async () => {
    const item = await makeRunningEffect();
    const id = createEffectOperationId();
    await prepare(item, id);
    await inActivity(item, () =>
      item.service.dispatch(
        id,
        successPort(async () => {
          throw new Error("ambiguous external result");
        }),
      ),
    );
    let reconcileCalls = 0;
    const lease = await queryAs(
      item.bootResult.fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      `SELECT activity.pid
         FROM pg_locks AS locks
         JOIN pg_stat_activity AS activity ON activity.pid = locks.pid
        WHERE locks.locktype = 'advisory'
          AND activity.usename = 'heptalogos_host_lease'
          AND activity.datname = 'heptalogos'`,
    );
    const leasePid = lease.rows[0]?.pid;
    if (leasePid === undefined) throw new Error("Host lease backend was not found");
    await queryAs(
      item.bootResult.fixture,
      "heptalogos_bootstrap",
      BOOTSTRAP_PASSWORD,
      "SELECT pg_terminate_backend($1::integer)",
      [Number(leasePid)],
    );
    if (!item.bootResult.host.signal.aborted) {
      await new Promise<void>((resolve) =>
        item.bootResult.host.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
    }
    await expect(
      inActivity(item, () =>
        item.service.reconcile(
          id,
          successPort(
            async () => ({ status: "SUCCEEDED" }),
            async () => {
              reconcileCalls += 1;
              return { status: "SUCCEEDED" };
            },
          ),
        ),
      ),
    ).rejects.toBeDefined();
    expect(reconcileCalls).toBe(0);
    await expect(effectRow(item, id)).resolves.toMatchObject({ state: "UNCERTAIN" });
  }, 240_000);
});
