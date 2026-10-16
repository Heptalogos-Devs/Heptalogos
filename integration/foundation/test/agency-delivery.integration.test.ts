// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { HOST_OWNERSHIP_CANONICAL_DATABASE } from "@heptalogos/host-ownership";
import { createLifeService, createAgencyService } from "@heptalogos/subject";
import {
  executeRepositorySql,
  useRepositoryMutationTransaction,
} from "@heptalogos/persistence/repository";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
  BOOTSTRAP_PASSWORD,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);

async function fixture(replyToMode: "first" | "all" = "all") {
  const c = await composeProductPersistence();
  const subjectId = randomUUID();
  const actor = `entity:heptalogos:${randomUUID()}`;
  const scope = {
    conversations: [
      {
        conversationRef: "qq:allowed",
        operations: ["observe" as const, "send" as const],
      },
    ],
    tools: [],
    sourceRefs: ["occurrence:shared"],
    maxRunMs: 60000,
  };
  const now = () => new Date().toISOString();
  const life = createLifeService({
    persistence: c.persistence,
    now,
    worldNow: async () => ({ timeDomainRef: "time:real", at: now() }),
    scopeAuthority: async () => scope,
  });
  let activity = await c.run(() =>
    life.propose({
      operationId: randomUUID(),
      subjectId,
      purpose: "Send the exact adopted answer",
      mode: "work",
      window: { notBefore: null, notAfter: null },
      proposedBy: actor,
      sourceRefs: [],
      workContextId: null,
      world: { timeDomainRef: "time:real", at: now() },
      nextOpportunity: null,
      interruptOn: ["manual"],
    }),
  );
  activity = await c.run(() =>
    life.adopt({
      subjectId,
      activityId: activity.activityId,
      expectedRevision: activity.revision,
      adoptedBy: actor,
      scope,
    }),
  );
  activity = await c.run(() =>
    life.transition({
      subjectId,
      activityId: activity.activityId,
      expectedRevision: activity.revision,
      action: "start",
      reason: "Explicitly adopted send task",
    }),
  );
  const control = {
    worker: false,
    sourceRefs: ["occurrence:shared"],
    authorizedDerivedSourceRefs: [] as string[],
    messageSources: [] as { sourceRef: string; conversationRef: string }[],
    beforeAuthorityReturn: undefined as undefined | (() => Promise<void>),
  };
  const agency = createAgencyService({
    persistence: c.persistence,
    now,
    checkSources: async () => {},
    authority: async (_runId, _recipient, tx) => {
      const current = (await life.get(subjectId, activity.activityId, tx))!;
      await control.beforeAuthorityReturn?.();
      return {
        activity: current,
        role: control.worker ? "subject.execution" : "subject.render",
        actorEntityRef: actor,
        conversationRef: "qq:allowed",
        sourceRefs: control.sourceRefs,
        messageSources: control.messageSources,
        authorizedDerivedSourceRefs: control.authorizedDerivedSourceRefs,
      };
    },
  });
  const runId = randomUUID();
  await c.run(() =>
    c.persistence.mutate((ctx) =>
      useRepositoryMutationTransaction(ctx, (tx) =>
        executeRepositorySql(
          tx,
          "INSERT INTO heptalogos.life_native_run(run_id,subject_id,activity_id,session_key,role,state,document,recorded_at,updated_at) VALUES($1,$2,$3,'native-session','main','running','{}',now(),now())",
          [runId, subjectId, activity.activityId],
        ),
      ),
    ),
  );
  const request = {
    channel: "qq",
    accountId: "bot",
    to: "group:allowed",
    replyToId: "quoted-message",
    replyToMode,
    threadId: "adopted-thread",
    nativeIntentId: randomUUID(),
    runId,
    preparedBatch: {
      schemaVersion: 1,
      runId,
      entries: [2, 7, 11].map((sourceIndex) => ({
        sourceIndex,
        status: "accepted",
        payload: { text: "不要发送秘密" },
      })),
    },
  };
  const adoption = await c.run(() => agency.adoptDelivery(request));
  const part = (sourceIndex: number) => ({
    reference: adoption.reference,
    channel: request.channel,
    accountId: request.accountId,
    to: request.to,
    replyToId:
      replyToMode === "first" && sourceIndex !== 2 ? undefined : request.replyToId,
    threadId: request.threadId,
    deliveryQueueId: "queue:stable",
    payload: { sourceIndex, kind: "text" as const, text: "不要发送秘密" },
  });
  const cancel = async () => {
    const current = (await life.get(subjectId, activity.activityId))!;
    return c.run(() =>
      life.transition({
        subjectId,
        activityId: activity.activityId,
        expectedRevision: current.revision,
        action: "cancel",
        reason: "User cancelled",
      }),
    );
  };
  const client = async () => {
    const connection = new Client({
      host: "127.0.0.1",
      port: c.fixture.port,
      database: HOST_OWNERSHIP_CANONICAL_DATABASE,
      user: "heptalogos_bootstrap",
      password: BOOTSTRAP_PASSWORD,
    });
    await connection.connect();
    return connection;
  };
  return {
    c,
    life,
    agency,
    control,
    subjectId,
    activity,
    request,
    part,
    cancel,
    client,
  };
}

real("Agency adopts actual native payloads on real fenced PostgreSQL", () => {
  it("retains exact recipients and payload identities, resolves reliable uncertain receipts, and returns accepted results after recover/cancel", async () => {
    const f = await fixture();
    const { c, agency, part } = f;
    try {
      const adoptions = await c.run(() =>
        Promise.all(Array.from({ length: 8 }, () => agency.adoptDelivery(f.request))),
      );
      expect(new Set(adoptions.map((value) => value.reference)).size).toBe(1);
      await expect(
        agency.authorizeDelivery({
          ...part(2),
          payload: { ...part(2).payload, text: "发送秘密" },
        }),
      ).rejects.toMatchObject({ problem: { problemCode: "agency.payload_changed" } });
      await expect(agency.authorizeDelivery(part(0))).rejects.toMatchObject({
        problem: { problemCode: "agency.payload_changed" },
      });
      for (const changed of [
        { replyToId: "another-message" },
        { threadId: "another-thread" },
        { accountId: "another-account" },
      ])
        await expect(
          agency.authorizeDelivery({ ...part(2), ...changed }),
        ).rejects.toMatchObject({
          problem: { problemCode: "agency.recipient_changed" },
        });
      const attempts = await c.run(() =>
        Promise.allSettled([
          agency.beginDelivery(part(2)),
          agency.beginDelivery(part(2)),
        ]),
      );
      expect(attempts.filter((value) => value.status === "fulfilled")).toHaveLength(1);
      const first = attempts.find((value) => value.status === "fulfilled")!;
      if (first.status !== "fulfilled" || first.value.action !== "send")
        throw new Error("Expected one persisted network point");
      const firstAttemptId = first.value.attemptId;
      const accepted = {
        state: "accepted" as const,
        platformMessageId: "90071992547409939999",
        acceptedAt: "2026-10-16T00:00:00.000Z",
      };
      await c.run(() =>
        agency.recordDelivery({
          reference: part(2).reference,
          sourceIndex: 2,
          partIndex: 0,
          attemptId: firstAttemptId,
          outcome: accepted,
        }),
      );
      const second = await c.run(() => agency.beginDelivery(part(7)));
      if (second.action !== "send")
        throw new Error("A distinct source index must be independent");
      await c.run(() =>
        agency.recordDelivery({
          reference: part(7).reference,
          sourceIndex: 7,
          partIndex: 0,
          attemptId: second.attemptId,
          outcome: { state: "uncertain", code: "socket_closed_after_send" },
        }),
      );
      await expect(c.run(() => agency.beginDelivery(part(7)))).rejects.toMatchObject({
        problem: { problemCode: "agency.send_unresolved" },
      });
      await c.run(() =>
        agency.recordDelivery({
          reference: part(7).reference,
          sourceIndex: 7,
          partIndex: 0,
          attemptId: second.attemptId,
          outcome: {
            state: "accepted",
            platformMessageId: "late-reliable-message-id",
            acceptedAt: "2026-10-16T00:00:00.000Z",
          },
        }),
      );
      await expect(
        c.run(() =>
          agency.recordDelivery({
            reference: part(2).reference,
            sourceIndex: 2,
            partIndex: 0,
            attemptId: firstAttemptId,
            outcome: { state: "failed", code: "late_diagnostic" },
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "agency.result_conflict" } });
      f.control.worker = true;
      await expect(agency.authorizeDelivery(part(11))).rejects.toMatchObject({
        problem: { problemCode: "agency.scope_denied" },
      });
      f.control.worker = false;
      await c.run(() => f.life.recover(f.subjectId));
      expect(
        (await f.life.get(f.subjectId, f.activity.activityId))?.continuationRequired,
      ).toBe(true);
      expect(await c.run(() => agency.beginDelivery(part(2)))).toEqual({
        action: "return",
        outcome: accepted,
      });
      await f.cancel();
      expect(await agency.authorizeDelivery(part(2))).toEqual({ authorized: true });
      expect(await c.run(() => agency.beginDelivery(part(2)))).toEqual({
        action: "return",
        outcome: accepted,
      });
      expect(await c.run(() => agency.beginDelivery(part(7)))).toEqual({
        action: "return",
        outcome: {
          state: "accepted",
          platformMessageId: "late-reliable-message-id",
          acceptedAt: "2026-10-16T00:00:00.000Z",
        },
      });
      await expect(
        c.run(() =>
          agency.beginDelivery({ ...part(2), deliveryQueueId: "different-queue" }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "agency.part_changed" } });
      await expect(
        c.run(() => agency.beginDelivery({ ...part(2), replyToId: "different-quote" })),
      ).rejects.toMatchObject({ problem: { problemCode: "agency.recipient_changed" } });
      await expect(c.run(() => agency.beginDelivery(part(11)))).rejects.toMatchObject({
        problem: { problemCode: "agency.scope_denied" },
      });
    } finally {
      await c.close();
    }
  }, 120000);

  it("preserves native first-payload implicit reply policy without authorizing later quote changes", async () => {
    const f = await fixture("first");
    try {
      expect(await f.agency.authorizeDelivery(f.part(2))).toEqual({ authorized: true });
      expect(await f.agency.authorizeDelivery(f.part(7))).toEqual({ authorized: true });
      await expect(
        f.agency.authorizeDelivery({ ...f.part(7), replyToId: "quoted-message" }),
      ).rejects.toMatchObject({ problem: { problemCode: "agency.recipient_changed" } });
    } finally {
      await f.c.close();
    }
  }, 120000);

  it("rechecks cancellation committed while begin waits for the behavior row lock", async () => {
    const f = await fixture();
    const locker = await f.client();
    const monitor = await f.client();
    try {
      await locker.query("BEGIN");
      await locker.query(
        "SELECT behavior_id FROM heptalogos.agency_behavior WHERE behavior_id=$1 FOR UPDATE",
        [f.part(2).reference],
      );
      const pid = (
        await locker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid;
      const attempt = f.c
        .run(() => f.agency.beginDelivery(f.part(2)))
        .then(
          (value) => ({ value }),
          (error) => ({ error }),
        );
      await expect
        .poll(
          async () =>
            Number(
              (
                await monitor.query(
                  "SELECT count(*) AS waiting FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",
                  [pid],
                )
              ).rows[0]!.waiting,
            ),
          { timeout: 5000, interval: 10 },
        )
        .toBeGreaterThan(0);
      await f.cancel();
      await locker.query("COMMIT");
      expect(await attempt).toMatchObject({
        error: { problem: { problemCode: "agency.scope_denied" } },
      });
      expect(
        Number(
          (
            await monitor.query(
              "SELECT count(*) AS count FROM heptalogos.agency_delivery_part WHERE behavior_id=$1",
              [f.part(2).reference],
            )
          ).rows[0]!.count,
        ),
      ).toBe(0);
    } finally {
      await locker.query("ROLLBACK").catch(() => {});
      await locker.end();
      await monitor.end();
      await f.c.close();
    }
  }, 120000);

  it("holds the Life row until its send point commits, so a later cancellation waits", async () => {
    const f = await fixture();
    const monitor = await f.client();
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let entered!: () => void;
    const observed = new Promise<void>((done) => {
      entered = done;
    });
    try {
      f.control.beforeAuthorityReturn = async () => {
        entered();
        await gate;
      };
      const begin = f.c.run(() => f.agency.beginDelivery(f.part(2)));
      await observed;
      const cancelled = f.cancel();
      await expect
        .poll(
          async () =>
            Number(
              (
                await monitor.query(
                  "SELECT count(*) AS waiting FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%life_activity%FOR UPDATE%' AND cardinality(pg_blocking_pids(pid))>0",
                )
              ).rows[0]!.waiting,
            ),
          { timeout: 5000, interval: 10 },
        )
        .toBeGreaterThan(0);
      release();
      expect(await begin).toMatchObject({ action: "send" });
      await cancelled;
      expect((await f.life.get(f.subjectId, f.activity.activityId))?.state).toBe(
        "cancelled",
      );
      await expect(
        f.c.run(() => f.agency.beginDelivery(f.part(7))),
      ).rejects.toMatchObject({ problem: { problemCode: "agency.scope_denied" } });
    } finally {
      release();
      await monitor.end();
      await f.c.close();
    }
  }, 120000);
});

real("canonical future message source transmission", () => {
  it("uses adopted conversation observation for verified future messages and rejects another conversation's source", async () => {
    const f = await fixture();
    try {
      const sourceRef = "message:" + randomUUID();
      f.control.sourceRefs = [sourceRef];
      f.control.messageSources = [{ sourceRef, conversationRef: "qq:allowed" }];
      expect(await f.c.run(() => f.agency.adoptDelivery(f.request))).toHaveProperty(
        "reference",
      );
      const released = "role-result-release:" + randomUUID();
      f.control.sourceRefs = [released];
      await expect(
        f.c.run(() =>
          f.agency.adoptDelivery({ ...f.request, nativeIntentId: randomUUID() }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "agency.source_denied" } });
      f.control.authorizedDerivedSourceRefs = [released];
      expect(
        await f.c.run(() =>
          f.agency.adoptDelivery({ ...f.request, nativeIntentId: randomUUID() }),
        ),
      ).toHaveProperty("reference");
      f.control.authorizedDerivedSourceRefs = [];
      f.control.sourceRefs = [sourceRef];
      f.control.messageSources = [{ sourceRef, conversationRef: "qq:private" }];
      await expect(
        f.c.run(() =>
          f.agency.adoptDelivery({ ...f.request, nativeIntentId: randomUUID() }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "agency.source_denied" } });
    } finally {
      await f.c.close();
    }
  }, 120000);
});
