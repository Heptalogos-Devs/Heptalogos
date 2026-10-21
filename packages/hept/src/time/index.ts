// Port of Nous subject-clock.rs 412b0620, originally Apache-2.0; see package NOTICE.
// Capture/high-water/CAS/monotonic algorithms retained.
// Copyright 2026 Aravine Zhu; SPDX-License-Identifier: AGPL-3.0-only
import type { Client } from "pg";
import { v7 as uuid } from "uuid";
import { canonicalize } from "json-canonicalize";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Kysely } from "kysely";
import { sql } from "@nous-wave/platform/storage";
import { problem, safeProblem } from "@nous-wave/platform/errors";
import {
  readReal,
  parseInstant,
  micros,
  formatMicros,
  scaleMicros,
  addMicros,
  normalizeRate,
  projectDeadline,
} from "@nous-wave/platform/time";
import type { CallContext, Ref, Problem } from "@nous-wave/contracts/common";
import { canonicalRefKey, RefSchema } from "@nous-wave/contracts/common";
import {
  ClockConfigureSchema,
  ClockPauseSchema,
  ClockResumeSchema,
  ClockAdvanceSchema,
  ClockRecordSchema,
  ClockSnapshotSchema,
  ClockSegmentSchema,
  TimeCaptureReceiptSchema,
  TimeSelectionSchema,
  TimeDomainCreateSchema,
  TimeDomainSchema,
  ClockChangeReceiptSchema,
  type ClockRef,
  type ClockConfigure,
  type ClockRecord,
  type ClockSnapshot,
  type ClockSegment,
  type ClockChangeReceipt,
  type TimeCaptureReceipt,
  type TimeSelection,
  type TimeDomain,
  type TimeRecordings,
} from "@nous-wave/contracts/time";
import type { Settings, ConfigScope } from "@nous-wave/platform/settings";
import { TimeReferenceSchema } from "./config.js";
import type { TimeDatabase } from "./migration.js";
import { recoverClock } from "./lifecycle.js";
import { createTimeData } from "./data.js";
export { TimeDataBundleSchema, type TimeDataBundle } from "./data.js";
export { timeMigration, type TimeDatabase } from "./migration.js";
export { timeSettingsModule } from "./config.js";
export interface TimeStore {
  installationId: string;
  db: Kysely<any>;
  createSession(): Client;
  transaction<T>(
    name: string,
    use: (db: Kysely<any>) => Promise<T>,
  ): Promise<T>;
  authorize(
    ctx: CallContext,
    operation: string,
    target?: Ref,
    db?: Kysely<any>,
  ): Promise<void>;
}
export interface TimeOptions {
  settings: Settings;
  processBootId: string;
  wall?: () => string;
  monotonic?: () => bigint;
  onError?: (error: Problem) => void;
  recordings?: (capability: TimeRecordings) => void;
}
type ClockRow = TimeDatabase["clocks"];
const json = <T>(value: T) => sql<T>`${JSON.stringify(value)}::jsonb`;
const hash = (value: unknown) =>
  createHash("sha256").update(canonicalize(value)).digest("hex");
const positive = (value: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw problem(
      "time.revision_overflow",
      "failed",
      "时钟修订超出安全整数范围",
    );
  return number;
};
export function createTime(store: TimeStore, options: TimeOptions) {
  const database = store.db as Kysely<TimeDatabase>;
  const within = <T>(
    name: string,
    use: (db: Kysely<TimeDatabase>) => Promise<T>,
  ) => store.transaction(name, use);
  const wall = () =>
      parseInstant(options.wall ? options.wall() : readReal().at),
    mono = options.monotonic ?? (() => process.hrtime.bigint() / 1000n);
  let authority: Client | undefined,
    active = false,
    closing: Promise<void> | undefined,
    onlineSessionId = "",
    checking: Promise<void> | undefined;
  const lockName = `hept:clock-authority:${store.installationId}`;
  const anchors = new Map<
    string,
    {
      clockId: string;
      revision: number;
      mono: bigint;
      point: bigint;
      highWater: bigint;
    }
  >();
  const registrations = new Map<
    string,
    ReturnType<Settings["registerConsumer"]>
  >();
  const listeners = new Set<
    (change: { domainId: string; clockRef: Ref }) => void | Promise<void>
  >();
  const hostConsumer = {
    kind: "maintenance" as const,
    host: "hept",
    id: store.installationId,
  };
  const ref = <K extends string>(
    kind: K,
    id: string,
    subjectId?: string,
    revision?: number,
  ): Omit<Ref, "kind"> & { kind: K } => ({
    product: "hept",
    installationId: store.installationId,
    ...(subjectId ? { subjectId } : {}),
    kind,
    id,
    ...(revision ? { revision } : {}),
  });
  const clockRef = (row: ClockRow) =>
    ref(
      "Clock",
      row.clockId,
      row.subjectId ?? undefined,
      positive(row.revision),
    );
  function own(reference: Ref, kind?: string) {
    if (
      reference.product !== "hept" ||
      reference.installationId !== store.installationId ||
      reference.selector ||
      (kind && reference.kind !== kind)
    )
      throw problem(
        "time.reference_mismatch",
        "forbidden",
        "时间引用不属于本安装的实际对象",
      );
  }
  function scoped(ctx: CallContext, subjectId?: string | null): CallContext {
    ownership(ctx, subjectId ?? null);
    return subjectId ? { ...ctx, subjectId } : ctx;
  }
  function ownership(
    ctx: Pick<CallContext, "subjectId">,
    subjectId: string | null,
  ) {
    if (subjectId && ctx.subjectId !== undefined && ctx.subjectId !== subjectId)
      throw problem(
        "time.subject_mismatch",
        "forbidden",
        "时钟不属于当前主体范围",
      );
  }
  async function live() {
    if (!active || !authority)
      throw problem(
        "time.authority_unavailable",
        "unavailable",
        "本安装时钟authority未运行",
      );
    const connection = authority;
    checking ??= connection
      .query("select 1")
      .then(() => {})
      .catch(() => {
        active = false;
        anchors.clear();
        throw problem(
          "time.authority_unavailable",
          "unavailable",
          "时钟authority连接已中断",
        );
      })
      .finally(() => {
        checking = undefined;
      });
    await checking;
    if (!active || authority !== connection)
      throw problem(
        "time.authority_unavailable",
        "unavailable",
        "时钟authority已停止",
      );
  }

  function emit(receipt: ClockChangeReceipt) {
    for (const [id, anchor] of anchors)
      if (
        anchor.clockId === receipt.record.ref.id &&
        anchor.revision < receipt.record.revision
      )
        anchors.delete(id);
    for (const listener of listeners)
      void Promise.resolve()
        .then(() =>
          listener({
            domainId: receipt.record.domainId,
            clockRef: receipt.record.ref,
          }),
        )
        .catch(() =>
          options.onError?.(
            problem("time.notification_failed", "failed", "时钟修订通知失败")
              .problem,
          ),
        );
  }

  function record(row: ClockRow): ClockRecord {
    return ClockRecordSchema.parse({
      ref: clockRef(row),
      domainId: row.domainId,
      revision: positive(row.revision),
      currentSegmentRef: ref(
        "ClockSegment",
        row.currentSegmentId,
        row.subjectId ?? undefined,
      ),
      onlineRate: normalizeRate(row.onlineRate),
      offlinePolicy: row.offlinePolicy,
      status: row.status,
    });
  }
  async function segment(
    db: Kysely<TimeDatabase>,
    row: ClockRow,
  ): Promise<ClockSegment> {
    const value = await db
      .selectFrom("clockSegments")
      .selectAll()
      .where("segmentId", "=", row.currentSegmentId)
      .executeTakeFirstOrThrow();
    return ClockSegmentSchema.parse({
      ref: ref("ClockSegment", value.segmentId, row.subjectId ?? undefined),
      clockRef: clockRef(row),
      domainId: row.domainId,
      revision: positive(value.revision),
      domainAnchor: value.domainAnchor,
      realAnchor: value.realAnchor,
      rate: normalizeRate(value.rate),
      startedByOperationId: value.operationId,
      reason: value.reason,
    });
  }
  async function sample(db: Kysely<TimeDatabase>, row: ClockRow) {
    const seg = await segment(db, row),
      anchor = anchors.get(seg.ref.id);
    if (!anchor) {
      const current = await db
        .selectFrom("clocks")
        .select("revision")
        .where("clockId", "=", row.clockId)
        .executeTakeFirst();
      if (current && current.revision !== row.revision)
        throw problem(
          "time.revision_conflict",
          "conflict",
          "读取期间Clock已经改变",
          { currentRevision: positive(current.revision) },
        );
      throw problem(
        "time.authority_revision_unavailable",
        "unavailable",
        "当前段尚未由本authority接管",
      );
    }
    const checkpoint = await db
      .selectFrom("clockCheckpoints")
      .selectAll()
      .where("clockId", "=", row.clockId)
      .executeTakeFirst();
    const tick = mono(),
      realAt = wall(),
      elapsed = tick - anchor.mono;
    let point =
      anchor.point + scaleMicros(elapsed > 0n ? elapsed : 0n, seg.rate);
    if (point < anchor.highWater) point = anchor.highWater;
    if (
      checkpoint?.clockRevision === row.revision &&
      point < micros(checkpoint.domainHighWater)
    )
      point = micros(checkpoint.domainHighWater);
    anchor.highWater = point;
    const now = {
      point: { domainId: row.domainId, at: formatMicros(point) },
      realAt,
      clockRef: clockRef(row),
      clockRevision: positive(row.revision),
      segmentRef: seg.ref,
    };
    return {
      snapshot: ClockSnapshotSchema.parse({
        domainId: row.domainId,
        rate: seg.rate,
        clockRef: clockRef(row),
        revision: positive(row.revision),
        segment: seg,
        now,
      }),
      mono: tick,
    };
  }
  async function reference(
    ctx: Pick<CallContext, "subjectId">,
    db?: Kysely<TimeDatabase>,
  ) {
    const scope: ConfigScope = ctx.subjectId
      ? { kind: "subject", subjectId: ctx.subjectId }
      : { kind: "installation", installationId: store.installationId };
    const key = canonicalize(scope);
    let registered = registrations.get(key);
    if (!registered) {
      registered = options.settings.registerConsumer({
        namespace: "time.reference",
        consumerId: "time.clock",
        processBootId: options.processBootId,
        scope,
      });
      registrations.set(key, registered);
    }
    const snapshot = await registered.snapshot(db);
    if (!db?.isTransaction) registered.reportApplied(snapshot);
    return TimeReferenceSchema.parse(snapshot.values);
  }
  async function selected(
    ctx: Pick<CallContext, "subjectId">,
    input: TimeSelection | undefined,
    db: Kysely<TimeDatabase>,
    lock = false,
  ) {
    const value = TimeSelectionSchema.parse(input ?? {});
    if (
      value.subjectId &&
      ctx.subjectId !== undefined &&
      value.subjectId !== ctx.subjectId
    )
      throw problem(
        "time.subject_mismatch",
        "forbidden",
        "请求主体不属于当前时间范围",
      );
    const binding =
      value.domainId === undefined && value.preferClock === undefined
        ? await reference(ctx, db)
        : undefined;
    let query = db.selectFrom("clocks").selectAll();
    const requested: Ref | null | undefined =
      value.preferClock ?? binding?.clockRef;
    const domain = value.domainId ?? binding?.domainId;
    if (requested) {
      own(requested, "Clock");
      query = query.where("clockId", "=", requested.id);
    } else if (domain === "real") return { kind: "real" as const };
    else if (domain) query = query.where("domainId", "=", domain);
    else
      throw problem(
        "time.selection_required",
        "validation",
        "需要明确时间域或Clock",
      );
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    if (!row)
      throw problem(
        "time.clock_not_found",
        "not_found",
        "时间域没有可用Clock映射",
      );
    ownership({ subjectId: ctx.subjectId ?? value.subjectId }, row.subjectId);
    if (row.status === "retired")
      throw problem("time.clock_retired", "unavailable", "Clock已经退役");
    if (domain && domain !== row.domainId)
      throw problem("time.clock_mismatch", "validation", "Clock与请求时域不同");
    if (requested && requested.subjectId !== (row.subjectId ?? undefined))
      throw problem(
        "time.reference_mismatch",
        "forbidden",
        "Clock引用归属与实际对象不同",
      );
    if (
      requested?.revision !== undefined &&
      requested.revision !== positive(row.revision)
    )
      throw problem("time.revision_conflict", "conflict", "Clock已采用新修订", {
        currentRevision: positive(row.revision),
      });
    return { kind: "mapped" as const, row };
  }
  async function checkpoint(
    db: Kysely<TimeDatabase>,
    row: ClockRow,
    capture: ClockSnapshot["now"],
  ) {
    await db
      .insertInto("clockCheckpoints")
      .values({
        clockId: row.clockId,
        segmentId: row.currentSegmentId,
        clockRevision: row.revision,
        domainHighWater: capture.point.at,
        capturedRealAt: capture.realAt,
      })
      .onConflict((oc) =>
        oc.column("clockId").doUpdateSet({
          segmentId: row.currentSegmentId,
          clockRevision: row.revision,
          domainHighWater: capture.point.at,
          capturedRealAt: capture.realAt,
        }),
      )
      .execute();
  }
  type TerminalProof = {
    originRef: Ref;
    observed: TimeCaptureReceipt;
    consumer: CallContext["consumer"];
  };
  const captureDigest = (
    ctx: CallContext,
    input: {
      operationId: string;
      selection?: TimeSelection;
      realAt?: string;
      existingOnly?: boolean;
    },
    terminal?: TerminalProof,
  ) =>
    hash({
      consumer: terminal?.consumer ?? ctx.consumer,
      subjectId: terminal
        ? (terminal.observed.captureRef.subjectId ?? null)
        : (ctx.subjectId ?? null),
      selection: input.selection ?? null,
      ...(terminal
        ? {
            originRef: terminal.originRef,
            observedRef: terminal.observed.captureRef,
          }
        : {}),
    });
  async function priorCapture(
    db: Kysely<TimeDatabase>,
    ctx: CallContext,
    input: {
      operationId: string;
      selection?: TimeSelection;
      realAt?: string;
      existingOnly?: boolean;
    },
    terminal?: TerminalProof,
  ) {
    const prior = await db
      .selectFrom("clockCaptures")
      .selectAll()
      .where("operationId", "=", input.operationId)
      .executeTakeFirst();
    if (!prior) return;
    ownership(ctx, prior.subjectId);
    if (prior.requestDigest !== captureDigest(ctx, input, terminal))
      throw problem(
        "time.capture_conflict",
        "conflict",
        "捕获身份已对应不同请求或消费身份",
      );
    if (!terminal)
      await store.authorize(
        scoped(ctx, prior.subjectId),
        "clock.capture",
        "clockRef" in prior.receipt
          ? prior.receipt.clockRef
          : prior.receipt.captureRef,
        db,
      );
    return TimeCaptureReceiptSchema.parse(prior.receipt);
  }
  async function captureCore(
    db: Kysely<any>,
    ctx: CallContext,
    input: {
      operationId: string;
      selection?: TimeSelection;
      realAt?: string;
      existingOnly?: boolean;
    },
    terminal?: TerminalProof,
  ): Promise<TimeCaptureReceipt> {
    z.string().min(1).max(2048).parse(input.operationId);
    if (input.selection !== undefined)
      input = {
        ...input,
        selection: TimeSelectionSchema.parse(input.selection),
      };
    await sql`select pg_advisory_xact_lock(hashtextextended(${`clock:capture:${input.operationId}`},0))`.execute(
      db,
    );
    const prior = await priorCapture(db, ctx, input, terminal);
    if (prior) return prior;
    if (input.existingOnly)
      throw problem(
        "time.capture_not_found",
        "not_found",
        "该操作尚无时间捕获回执",
      );
    const target = await selected(ctx, input.selection, db, true);
    let receipt: TimeCaptureReceipt;
    if (target.kind === "real") {
      if (!terminal) await store.authorize(ctx, "clock.capture", undefined, db);
      await ensureReal(db);
      const at =
        input.realAt === undefined ? wall() : parseInstant(input.realAt);
      receipt = {
        point: { domainId: "real", at },
        realAt: at,
        captureRef: ref(
          "TimeCapture",
          uuid(),
          terminal ? terminal.observed.captureRef.subjectId : ctx.subjectId,
        ),
      };
    } else {
      if (input.realAt !== undefined)
        throw problem(
          "time.capture_recovery_unavailable",
          "unavailable",
          "历史模型结果缺少该虚拟域的原捕获回执",
        );
      if (!terminal)
        await store.authorize(
          scoped(ctx, target.row.subjectId ?? input.selection?.subjectId),
          "clock.capture",
          clockRef(target.row),
          db,
        );
      await live();
      const current = (await sample(db, target.row)).snapshot;
      await checkpoint(db, target.row, current.now);
      receipt = TimeCaptureReceiptSchema.parse({
        ...current.now,
        captureRef: ref(
          "TimeCapture",
          uuid(),
          target.row.subjectId ?? ctx.subjectId ?? input.selection?.subjectId,
        ),
      });
    }
    await db
      .insertInto("clockCaptures")
      .values({
        captureId: receipt.captureRef.id,
        domainId: receipt.point.domainId,
        clockId: target.kind === "mapped" ? target.row.clockId : null,
        operationId: input.operationId,
        requestDigest: captureDigest(ctx, input, terminal),
        subjectId: receipt.captureRef.subjectId ?? null,
        actor: json(ctx.actor),
        actorAuthorityRef: ctx.actor.authorityRef,
        consumer: json(terminal?.consumer ?? ctx.consumer),
        receipt: json(receipt),
        originRef: terminal ? json(terminal.originRef) : null,
      })
      .execute();
    return receipt;
  }
  async function captureIn(
    db: Kysely<any>,
    ctx: CallContext,
    input: {
      operationId: string;
      selection?: TimeSelection;
      realAt?: string;
      existingOnly?: boolean;
    },
  ) {
    return captureCore(db, ctx, input);
  }
  const recordings: TimeRecordings = {
    async captureTerminal(ctx, input) {
      const originRef = RefSchema.parse(input.originRef),
        observed = TimeCaptureReceiptSchema.parse(input.observed);
      own(originRef, "ModelInvocation");
      own(observed.captureRef, "TimeCapture");
      if (
        originRef.revision !== undefined ||
        originRef.subjectId !== observed.captureRef.subjectId
      )
        throw problem(
          "time.terminal_origin_mismatch",
          "forbidden",
          "实际终止来源与原观察主体不符",
        );
      return within("time.recordTerminal", async (db) => {
        const basis = await db
          .selectFrom("clockCaptures")
          .selectAll()
          .where("captureId", "=", observed.captureRef.id)
          .executeTakeFirst();
        if (
          !basis ||
          canonicalize(basis.receipt) !== canonicalize(observed) ||
          canonicalize(basis.consumer) !== canonicalize(input.consumer) ||
          basis.subjectId !== (originRef.subjectId ?? null)
        )
          throw problem(
            "time.terminal_proof_mismatch",
            "forbidden",
            "终止记录缺少该消费者的原实际观察证明",
          );
        ownership(ctx, basis.subjectId);
        const selection: TimeSelection = {
          domainId: observed.point.domainId,
          ...(basis.subjectId ? { subjectId: basis.subjectId } : {}),
          ...("clockRef" in observed
            ? { preferClock: { ...observed.clockRef, revision: undefined } }
            : {}),
        };
        return captureCore(
          db,
          ctx,
          {
            operationId: input.operationId,
            selection,
            ...(input.realAt ? { realAt: input.realAt } : {}),
          },
          { originRef, observed, consumer: input.consumer },
        );
      });
    },
  };
  options.recordings?.(Object.freeze(recordings));
  async function append(
    db: Kysely<TimeDatabase>,
    input: {
      row: ClockRow;
      point: string;
      realAt: string;
      tick: bigint;
      rate: string;
      onlineRate: string;
      policy: ClockRow["offlinePolicy"];
      operationId: string;
      reason: ClockSegment["reason"];
      actor: CallContext["actor"];
      consumer: CallContext["consumer"];
      request: unknown;
      requestDigest: string;
      previous?: ClockSnapshot;
      lifecycle?: ClockChangeReceipt["lifecycle"];
    },
  ) {
    const nextRevision = positive(input.row.revision) + 1;
    if (!Number.isSafeInteger(nextRevision))
      throw problem(
        "time.revision_overflow",
        "failed",
        "时钟修订已超出安全范围",
      );
    const row: ClockRow = {
      ...input.row,
      revision: String(nextRevision),
      currentSegmentId: uuid(),
      onlineRate: input.onlineRate,
      offlinePolicy: input.policy,
      status: input.rate === "0" ? "paused" : "running",
    };
    await db
      .insertInto("clockSegments")
      .values({
        segmentId: row.currentSegmentId,
        clockId: row.clockId,
        revision: row.revision,
        domainAnchor: input.point,
        realAnchor: input.realAt,
        rate: input.rate,
        operationId: input.operationId,
        reason: input.reason,
      })
      .execute();
    await db
      .updateTable("clocks")
      .set({
        revision: row.revision,
        currentSegmentId: row.currentSegmentId,
        onlineRate: row.onlineRate,
        offlinePolicy: json(row.offlinePolicy),
        status: row.status,
      })
      .where("clockId", "=", row.clockId)
      .execute();
    anchors.set(row.currentSegmentId, {
      clockId: row.clockId,
      revision: nextRevision,
      point: micros(input.point),
      highWater: micros(input.point),
      mono: input.tick,
    });
    const seg = await segment(db, row);
    const snapshot = ClockSnapshotSchema.parse({
      domainId: row.domainId,
      rate: seg.rate,
      clockRef: clockRef(row),
      revision: nextRevision,
      segment: seg,
      now: {
        point: { domainId: row.domainId, at: input.point },
        realAt: input.realAt,
        clockRef: clockRef(row),
        clockRevision: nextRevision,
        segmentRef: seg.ref,
      },
    });
    await checkpoint(db, row, snapshot.now);
    const receipt = ClockChangeReceiptSchema.parse({
      operationId: input.operationId,
      record: record(row),
      snapshot,
      ...(input.previous && "segment" in input.previous
        ? {
            closure: {
              segmentRef: input.previous.segment.ref,
              closedByClockRevision: nextRevision,
              domainEnd: input.previous.now.point.at,
              endedRealAt: input.realAt,
              endedByOperationId: input.operationId,
            },
          }
        : {}),
      ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
    });
    await db
      .insertInto("clockChanges")
      .values({
        clockId: row.clockId,
        operationId: input.operationId,
        requestDigest: input.requestDigest,
        actor: json(input.actor),
        actorAuthorityRef: input.actor.authorityRef,
        consumer: json(input.consumer),
        request: json(input.request),
        receipt: json(receipt),
      })
      .execute();
    return receipt;
  }
  async function changeIn(
    db: Kysely<TimeDatabase>,
    ctx: CallContext,
    action: "configure" | "pause" | "resume" | "advance",
    input:
      | ClockConfigure
      | z.infer<typeof ClockPauseSchema>
      | z.infer<typeof ClockResumeSchema>
      | z.infer<typeof ClockAdvanceSchema>,
  ): Promise<ClockChangeReceipt> {
    await live();
    if (
      "subjectId" in input &&
      input.subjectId &&
      ctx.subjectId !== undefined &&
      input.subjectId !== ctx.subjectId
    )
      throw problem(
        "time.subject_mismatch",
        "forbidden",
        "Clock请求主体与当前范围不同",
      );
    const operationId = ctx.trace.operationId;
    const request = { action, input };
    const requestDigest = hash({
      request,
      actor: ctx.actor,
      consumer: ctx.consumer,
    });
    let domainId = "domainId" in input ? input.domainId : undefined;
    if (!domainId) {
      const requested = (input as z.infer<typeof ClockPauseSchema>).clockRef;
      own(requested, "Clock");
      const target = await db
        .selectFrom("clocks")
        .selectAll()
        .where("clockId", "=", requested.id)
        .executeTakeFirst();
      if (!target)
        throw problem("time.clock_not_found", "not_found", "Clock不存在");
      ownership(ctx, target.subjectId);
      if (requested.subjectId !== (target.subjectId ?? undefined))
        throw problem(
          "time.reference_mismatch",
          "forbidden",
          "Clock引用归属不符",
        );
      domainId = target.domainId;
    }
    if (domainId === "real")
      throw problem(
        "time.real_immutable",
        "validation",
        "现实域不支持虚拟Clock配置",
      );
    await sql`select pg_advisory_xact_lock(hashtextextended(${`clock:domain:${domainId}`},0))`.execute(
      db,
    );
    let row = await db
      .selectFrom("clocks")
      .selectAll()
      .where("domainId", "=", domainId)
      .forUpdate()
      .executeTakeFirst();
    if (row) {
      ownership(ctx, row.subjectId);
      await store.authorize(
        scoped(ctx, row.subjectId),
        `clock.${action}`,
        clockRef(row),
        db,
      );
      const prior = await db
        .selectFrom("clockChanges")
        .selectAll()
        .where("clockId", "=", row.clockId)
        .where("operationId", "=", operationId)
        .executeTakeFirst();
      if (prior) {
        if (prior.requestDigest !== requestDigest)
          throw problem(
            "time.submission_conflict",
            "conflict",
            "改钟身份已对应不同请求",
          );
        return ClockChangeReceiptSchema.parse(prior.receipt);
      }
    }
    const current = row ? positive(row.revision) : 0;
    if (current !== input.expectedRevision)
      throw problem("time.revision_conflict", "conflict", "Clock修订已经改变", {
        currentRevision: current,
      });
    if ("clockRef" in input && input.clockRef) {
      own(input.clockRef, "Clock");
      if (
        !row ||
        row.clockId !== input.clockRef.id ||
        (input.clockRef.revision !== undefined &&
          input.clockRef.revision !== current)
      )
        throw problem(
          "time.revision_conflict",
          "conflict",
          "请求Clock或修订不匹配",
          { currentRevision: current },
        );
    }
    if (!row) {
      if (action !== "configure" || !("initialAt" in input))
        throw problem(
          "time.clock_not_found",
          "not_found",
          "首次配置需要初始时间",
        );
      const domain = await db
        .selectFrom("timeDomains")
        .selectAll()
        .where("domainId", "=", domainId)
        .executeTakeFirst();
      if (!domain || domain.status !== "active")
        throw problem("time.domain_not_found", "not_found", "时间域尚未建立");
      ownership(ctx, domain.subjectId);
      await store.authorize(
        scoped(ctx, domain.subjectId),
        "clock.configure",
        ref("TimeDomain", domainId, domain.subjectId ?? undefined),
        db,
      );
      const id = uuid(),
        segmentId = uuid(),
        tick = mono(),
        at = wall();
      row = {
        clockId: id,
        domainId,
        subjectId: domain.subjectId,
        revision: "1",
        currentSegmentId: segmentId,
        onlineRate: input.rate,
        offlinePolicy: input.offlinePolicy,
        status: input.rate === "0" ? "paused" : "running",
      };
      await db
        .insertInto("clocks")
        .values({ ...row, offlinePolicy: json(row.offlinePolicy) })
        .execute();
      await db
        .insertInto("clockSegments")
        .values({
          segmentId,
          clockId: id,
          revision: "1",
          domainAnchor: input.initialAt,
          realAnchor: at,
          rate: input.rate,
          operationId,
          reason: "configure",
        })
        .execute();
      anchors.set(segmentId, {
        clockId: id,
        revision: 1,
        mono: tick,
        point: micros(input.initialAt),
        highWater: micros(input.initialAt),
      });
      const seg = await segment(db, row),
        snapshot = ClockSnapshotSchema.parse({
          domainId,
          rate: seg.rate,
          clockRef: clockRef(row),
          revision: 1,
          segment: seg,
          now: {
            point: { domainId, at: input.initialAt },
            realAt: at,
            clockRef: clockRef(row),
            clockRevision: 1,
            segmentRef: seg.ref,
          },
        });
      await checkpoint(db, row, snapshot.now);
      const receipt = ClockChangeReceiptSchema.parse({
        operationId,
        record: record(row),
        snapshot,
      });
      await db
        .insertInto("clockChanges")
        .values({
          clockId: id,
          operationId,
          requestDigest,
          actor: json(ctx.actor),
          actorAuthorityRef: ctx.actor.authorityRef,
          consumer: json(ctx.consumer),
          request: json(request),
          receipt: json(receipt),
        })
        .execute();
      return receipt;
    }
    const sampled = await sample(db, row),
      before = sampled.snapshot;
    let point = before.now.point.at,
      rate = before.rate,
      onlineRate = row.onlineRate,
      policy = row.offlinePolicy;
    if (action === "configure") {
      const config = input as ClockConfigure;
      if ("rate" in config && config.rate !== undefined)
        rate = onlineRate = config.rate;
      if (config.offlinePolicy) policy = config.offlinePolicy;
    }
    if (action === "pause") rate = "0";
    if (action === "resume")
      rate = onlineRate = (input as z.infer<typeof ClockResumeSchema>).rate;
    if (action === "advance")
      point = addMicros(
        point,
        BigInt((input as z.infer<typeof ClockAdvanceSchema>).deltaMicros),
      );
    return append(db, {
      row,
      point,
      realAt: before.now.realAt,
      tick: sampled.mono,
      rate,
      onlineRate: normalizeRate(onlineRate),
      policy,
      operationId,
      reason: action,
      actor: ctx.actor,
      consumer: ctx.consumer,
      request,
      requestDigest,
      previous: before,
    });
  }
  async function domainCreateIn(
    db: Kysely<TimeDatabase>,
    ctx: CallContext,
    input: z.infer<typeof TimeDomainCreateSchema>,
  ) {
    input = TimeDomainCreateSchema.parse(input);
    await store.authorize(
      scoped(ctx, input.subjectId),
      "time.domains.create",
      ref("TimeDomain", input.domainId, input.subjectId),
      db,
    );
    if (input.domainId === "real")
      throw problem("time.real_reserved", "validation", "real为保留时间域");
    if (
      input.subjectId &&
      ctx.subjectId !== undefined &&
      input.subjectId !== ctx.subjectId
    )
      throw problem("time.subject_mismatch", "forbidden", "时间域主体不匹配");
    const operationId = ctx.trace.operationId,
      digest = hash({ input, actor: ctx.actor, consumer: ctx.consumer });
    await sql`select pg_advisory_xact_lock(hashtextextended(${`time:domain-create:${operationId}`},0))`.execute(
      db,
    );
    const prior = await db
      .selectFrom("timeDomainReceipts")
      .selectAll()
      .where("operationId", "=", operationId)
      .executeTakeFirst();
    if (prior) {
      if (prior.requestDigest !== digest)
        throw problem(
          "time.submission_conflict",
          "conflict",
          "域创建身份对应不同请求",
        );
      return TimeDomainSchema.parse(prior.result);
    }
    const at = wall(),
      domain: TimeDomain = {
        ...input,
        coordinateSystem: "iso8601",
        precision: "microsecond",
        authorityRef: ref("Installation", store.installationId),
        status: "active",
        createdRealAt: at,
      };
    const inserted = await db
      .insertInto("timeDomains")
      .values({
        domainId: input.domainId,
        label: input.label,
        authorityRef: json(domain.authorityRef),
        status: "active",
        subjectId: input.subjectId ?? null,
        createdRealAt: at,
      })
      .onConflict((oc) => oc.column("domainId").doNothing())
      .returning("domainId")
      .executeTakeFirst();
    if (!inserted)
      throw problem("time.domain_exists", "conflict", "该时间域已经存在");
    await db
      .insertInto("timeDomainReceipts")
      .values({
        operationId,
        requestDigest: digest,
        actor: json(ctx.actor),
        actorAuthorityRef: ctx.actor.authorityRef,
        consumer: json(ctx.consumer),
        result: json(domain),
      })
      .execute();
    return domain;
  }
  async function ensureReal(db: Kysely<TimeDatabase>) {
    await db
      .insertInto("timeDomains")
      .values({
        domainId: "real",
        label: "现实时间",
        authorityRef: json(ref("Installation", store.installationId)),
        status: "active",
        subjectId: null,
        createdRealAt: wall(),
      })
      .onConflict((oc) => oc.column("domainId").doNothing())
      .execute();
  }
  async function bind(
    ctx: CallContext,
    input: {
      scope: ConfigScope;
      expectedRevision: number;
      domainId: string;
      preferClock?: ClockRef;
    },
    db?: Kysely<any>,
  ) {
    await store.authorize(ctx, "time.bindings.update", input.preferClock, db);
    const selectedClock = await selected(
      ctx,
      {
        domainId: input.domainId,
        ...(input.preferClock ? { preferClock: input.preferClock } : {}),
      },
      db ?? database,
    );
    const source =
      selectedClock.kind === "real" ? null : clockRef(selectedClock.row);
    const { revision: ignored, ...identity } = source ?? {};
    const value = {
      domainId: input.domainId,
      clockRef: source ? identity : null,
    };
    const result = await options.settings.update(
      ctx,
      {
        namespace: "time.reference",
        scope: input.scope,
        expectedRevision: input.expectedRevision,
        patch: [{ op: "replace", path: "", value }],
      },
      db,
    );
    return result;
  }
  async function recoverIn(db: Kysely<TimeDatabase>, id: string) {
    const row = await db
      .selectFrom("clocks")
      .selectAll()
      .where("clockId", "=", id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const prior = await db
      .selectFrom("clockChanges")
      .select("receipt")
      .where("clockId", "=", row.clockId)
      .orderBy("recordedRealAt", "desc")
      .execute();
    const latest = prior
      .map((p) => p.receipt)
      .find((p) => p.record.revision === positive(row.revision));
    const cp = await db
      .selectFrom("clockCheckpoints")
      .selectAll()
      .where("clockId", "=", row.clockId)
      .executeTakeFirstOrThrow();
    const seg = await segment(db, row),
      at = wall(),
      tick = mono();
    const recovery = recoverClock({
      point: cp.domainHighWater,
      realAt: cp.capturedRealAt,
      wall: at,
      onlineRate: normalizeRate(row.onlineRate),
      currentRate: seg.rate,
      policy: row.offlinePolicy,
      status: row.status,
      latest,
    });
    const operationId =
      latest?.lifecycle?.resumeOperationId ??
      `clock:host-start:${options.processBootId}:${onlineSessionId}:${row.clockId}`;
    return append(db, {
      row,
      point: recovery.point,
      realAt: at,
      tick,
      rate: recovery.rate,
      onlineRate: normalizeRate(row.onlineRate),
      policy: row.offlinePolicy,
      operationId,
      reason: "host_start",
      actor: {
        kind: "service",
        id: "hept-clock",
        authorityRef: `installation:${store.installationId}`,
      },
      consumer: hostConsumer,
      request: { reason: "host_start" },
      requestDigest: hash({ operationId }),
      lifecycle: { status: recovery.status, gap: recovery.gap },
    });
  }
  async function start() {
    if (active) return;
    if (closing) throw problem("time.closed", "unavailable", "时钟owner已关闭");
    const connection = store.createSession();
    connection.on("error", () => {
      if (authority === connection) {
        active = false;
        anchors.clear();
        options.onError?.(
          problem(
            "time.authority_lost",
            "unavailable",
            "时钟authority连接已中断",
          ).problem,
        );
      }
    });
    try {
      await connection.connect();
      const result = await connection.query<{ acquired: boolean }>(
        "select pg_try_advisory_lock(hashtextextended($1,0)) as acquired",
        [lockName],
      );
      if (!result.rows[0]?.acquired)
        throw problem(
          "time.authority_conflict",
          "conflict",
          "该安装已有在线时钟authority",
        );
      authority = connection;
      active = true;
      onlineSessionId = uuid();
      await ensureReal(database);
      for (const item of await database
        .selectFrom("clocks")
        .select("clockId")
        .where("status", "!=", "retired")
        .execute()) {
        const receipt = await within("time.hostStart", (db) =>
          recoverIn(db, item.clockId),
        );
        emit(receipt);
      }
    } catch (error) {
      active = false;
      anchors.clear();
      if (authority === connection) authority = undefined;
      await connection.end().catch(() => {});
      throw safeProblem(error, "time.start_failed");
    }
  }
  async function stop() {
    if (!active) return;
    await live();
    try {
      for (const item of await database
        .selectFrom("clocks")
        .select("clockId")
        .where("status", "!=", "retired")
        .execute()) {
        const receipt = await within("time.hostStop", async (db) => {
          const row = await db
            .selectFrom("clocks")
            .selectAll()
            .where("clockId", "=", item.clockId)
            .forUpdate()
            .executeTakeFirstOrThrow();
          const before = await sample(db, row);
          if (before.snapshot.rate === "0") return null;
          const operationId = `clock:host-stop:${options.processBootId}:${onlineSessionId}:${row.clockId}`;
          return append(db, {
            row,
            point: before.snapshot.now.point.at,
            realAt: before.snapshot.now.realAt,
            tick: before.mono,
            rate:
              row.offlinePolicy.mode === "freeze"
                ? "0"
                : row.offlinePolicy.offlineRate,
            onlineRate: normalizeRate(row.onlineRate),
            policy: row.offlinePolicy,
            operationId,
            reason: "host_stop",
            actor: {
              kind: "service",
              id: "hept-clock",
              authorityRef: `installation:${store.installationId}`,
            },
            consumer: hostConsumer,
            request: { reason: "host_stop" },
            requestDigest: hash({ operationId }),
            previous: before.snapshot,
            lifecycle: {
              status: "offline",
              resumeOperationId: `${operationId}:resume`,
              gap: null,
            },
          });
        });
        if (receipt) emit(receipt);
      }
    } finally {
      active = false;
      anchors.clear();
      const connection = authority;
      authority = undefined;
      await checking?.catch(() => {});
      await connection?.end();
    }
  }
  async function readIn(
    db: Kysely<any>,
    ctx: CallContext,
    selection?: TimeSelection,
    options: { lock?: boolean } = {},
  ): Promise<ClockSnapshot> {
    const target = await selected(ctx, selection, db, options.lock ?? false);
    if (target.kind === "real") {
      await store.authorize(ctx, "clock.read", undefined, db);
      const at = wall();
      return {
        domainId: "real",
        rate: "1",
        now: { point: { domainId: "real", at }, realAt: at },
      };
    }
    await store.authorize(
      scoped(ctx, target.row.subjectId ?? selection?.subjectId),
      "clock.read",
      clockRef(target.row),
      db,
    );
    await live();
    return (await sample(db, target.row)).snapshot;
  }
  async function readReferences(
    ctx: CallContext,
    input: { refs: Ref[] },
    db = database,
  ) {
    z.array(RefSchema).max(200).parse(input.refs);
    const loaded = new Map<
      string,
      Promise<{ ref: Ref; value?: unknown; problem?: Problem }>
    >();
    for (const requested of input.refs) {
      const key = canonicalRefKey(requested);
      if (loaded.has(key)) continue;
      loaded.set(
        key,
        (async () => {
          try {
            own(requested);
            if (requested.kind === "TimeDomain") {
              const row = await db
                .selectFrom("timeDomains")
                .selectAll()
                .where("domainId", "=", requested.id)
                .executeTakeFirst();
              if (!row)
                throw problem(
                  "time.domain_not_found",
                  "not_found",
                  "时间域不存在",
                );
              ownership(ctx, row.subjectId);
              if (
                requested.subjectId !== (row.subjectId ?? undefined) ||
                requested.revision !== undefined
              )
                throw problem(
                  "time.reference_mismatch",
                  "validation",
                  "时间域引用不匹配",
                );
              await store.authorize(
                scoped(ctx, row.subjectId),
                "clock.references.read",
                requested,
                db,
              );
              return {
                ref: requested,
                value: TimeDomainSchema.parse({
                  ...row,
                  subjectId: row.subjectId ?? undefined,
                  coordinateSystem: "iso8601",
                  precision: "microsecond",
                }),
              };
            }
            if (requested.kind === "TimeCapture") {
              if (requested.revision !== undefined)
                throw problem(
                  "time.reference_mismatch",
                  "validation",
                  "捕获事实不带修订",
                );
              const row = await db
                .selectFrom("clockCaptures")
                .selectAll()
                .where("captureId", "=", requested.id)
                .executeTakeFirst();
              if (!row)
                throw problem(
                  "time.capture_not_found",
                  "not_found",
                  "捕获事实不存在",
                );
              ownership(ctx, row.subjectId);
              if (canonicalRefKey(row.receipt.captureRef) !== key)
                throw problem(
                  "time.reference_mismatch",
                  "validation",
                  "捕获归属与引用不同",
                );
              await store.authorize(
                scoped(ctx, row.subjectId),
                "clock.references.read",
                row.receipt.captureRef,
                db,
              );
              return {
                ref: requested,
                value: TimeCaptureReceiptSchema.parse(row.receipt),
              };
            }
            if (requested.kind === "ClockSegment") {
              if (requested.revision !== undefined)
                throw problem(
                  "time.reference_mismatch",
                  "validation",
                  "不可变段不带引用修订",
                );
              const seg = await db
                .selectFrom("clockSegments")
                .selectAll()
                .where("segmentId", "=", requested.id)
                .executeTakeFirst();
              if (!seg)
                throw problem(
                  "time.segment_not_found",
                  "not_found",
                  "时钟段不存在",
                );
              const row = await db
                .selectFrom("clocks")
                .selectAll()
                .where("clockId", "=", seg.clockId)
                .executeTakeFirstOrThrow();
              ownership(ctx, row.subjectId);
              const value = await segment(db, {
                ...row,
                revision: seg.revision,
                currentSegmentId: seg.segmentId,
              });
              if (canonicalRefKey(value.ref) !== key)
                throw problem(
                  "time.reference_mismatch",
                  "validation",
                  "时钟段归属与引用不同",
                );
              await store.authorize(
                scoped(ctx, row.subjectId),
                "clock.references.read",
                value.ref,
                db,
              );
              return { ref: requested, value };
            }
            if (requested.kind === "Clock") {
              const row = await db
                .selectFrom("clocks")
                .selectAll()
                .where("clockId", "=", requested.id)
                .executeTakeFirst();
              if (!row)
                throw problem(
                  "time.clock_not_found",
                  "not_found",
                  "Clock不存在",
                );
              ownership(ctx, row.subjectId);
              if (requested.subjectId !== (row.subjectId ?? undefined))
                throw problem(
                  "time.reference_mismatch",
                  "validation",
                  "Clock归属与引用不同",
                );
              await store.authorize(
                scoped(ctx, row.subjectId),
                "clock.references.read",
                requested,
                db,
              );
              if (
                requested.revision === undefined ||
                requested.revision === positive(row.revision)
              ) {
                const value = record(row);
                return { ref: value.ref, value };
              }
              const changes = await db
                .selectFrom("clockChanges")
                .select("receipt")
                .where("clockId", "=", row.clockId)
                .execute();
              const saved = changes.find(
                (change) =>
                  change.receipt.record.revision === requested.revision,
              );
              if (!saved)
                throw problem(
                  "time.revision_not_found",
                  "not_found",
                  "Clock修订不存在",
                );
              return {
                ref: requested,
                value: ClockRecordSchema.parse(saved.receipt.record),
              };
            }
            throw problem(
              "time.reference_kind_unsupported",
              "validation",
              "该对象不是本owner的时间事实",
            );
          } catch (error) {
            return {
              ref: requested,
              problem: safeProblem(error, "time.reference_read_failed"),
            };
          }
        })(),
      );
    }
    return {
      items: await Promise.all(
        input.refs.map((reference) => loaded.get(canonicalRefKey(reference))!),
      ),
    };
  }
  const data = createTimeData({
    installationId: store.installationId,
    db: database,
    authorize: store.authorize,
    readReferences,
    record,
    imported: async (db, ids) => {
      if (active) for (const id of ids) await recoverIn(db, id);
    },
    removed: (ids) => {
      for (const id of ids) anchors.delete(id);
    },
  });
  const api = {
    start,
    stop,
    data,
    bindings: { update: bind },
    references: { read: readReferences },
    close() {
      return (closing ??= (async () => {
        active = false;
        anchors.clear();
        const connection = authority;
        authority = undefined;
        await checking?.catch(() => {});
        await connection?.end();
        for (const consumer of registrations.values()) consumer.close();
        registrations.clear();
        listeners.clear();
      })());
    },
    read: (ctx: CallContext, selection?: TimeSelection) =>
      readIn(database, ctx, selection),
    readIn,
    async readCurrent(selection: TimeSelection): Promise<ClockSnapshot> {
      const target = await selected(
        { subjectId: selection.subjectId },
        selection,
        database,
      );
      if (target.kind === "real") {
        const at = wall();
        return {
          domainId: "real",
          rate: "1",
          now: { point: { domainId: "real", at }, realAt: at },
        };
      }
      await live();
      return (await sample(database, target.row)).snapshot;
    },
    captureIn,
    capture(
      ctx: CallContext,
      input: {
        operationId: string;
        selection?: TimeSelection;
        realAt?: string;
        existingOnly?: boolean;
      },
    ) {
      return within("time.capture", (db) => captureIn(db, ctx, input));
    },
    configureIn: (db: Kysely<any>, ctx: CallContext, input: ClockConfigure) =>
      changeIn(db, ctx, "configure", ClockConfigureSchema.parse(input)),
    async configure(ctx: CallContext, input: ClockConfigure) {
      const result = await within("time.configure", (db) =>
        changeIn(db, ctx, "configure", ClockConfigureSchema.parse(input)),
      );
      emit(result);
      return result;
    },
    async pause(ctx: CallContext, input: z.infer<typeof ClockPauseSchema>) {
      const result = await within("time.pause", (db) =>
        changeIn(db, ctx, "pause", ClockPauseSchema.parse(input)),
      );
      emit(result);
      return result;
    },
    async resume(ctx: CallContext, input: z.infer<typeof ClockResumeSchema>) {
      const result = await within("time.resume", (db) =>
        changeIn(db, ctx, "resume", ClockResumeSchema.parse(input)),
      );
      emit(result);
      return result;
    },
    async advance(ctx: CallContext, input: z.infer<typeof ClockAdvanceSchema>) {
      const result = await within("time.advance", (db) =>
        changeIn(db, ctx, "advance", ClockAdvanceSchema.parse(input)),
      );
      emit(result);
      return result;
    },
    async inspect(ctx: CallContext, id: string) {
      const row = await database
        .selectFrom("clocks")
        .selectAll()
        .where("clockId", "=", id)
        .executeTakeFirst();
      if (!row)
        throw problem("time.clock_not_found", "not_found", "Clock不存在");
      ownership(ctx, row.subjectId);
      await store.authorize(
        scoped(ctx, row.subjectId),
        "clock.inspect",
        clockRef(row),
      );
      return record(row);
    },
    async history(
      ctx: CallContext,
      input: { clockRef: Ref; afterRevision?: number; limit?: number },
    ) {
      own(input.clockRef, "Clock");
      await store.authorize(ctx, "clock.history", input.clockRef);
      const row = await database
        .selectFrom("clocks")
        .selectAll()
        .where("clockId", "=", input.clockRef.id)
        .executeTakeFirst();
      if (!row)
        throw problem("time.clock_not_found", "not_found", "Clock不存在");
      ownership(ctx, row.subjectId);
      const after = input.afterRevision ?? 0,
        limit = input.limit ?? 50;
      z.number().int().min(1).max(200).parse(limit);
      z.number().int().nonnegative().safe().parse(after);
      const changes = await database
        .selectFrom("clockChanges")
        .select("receipt")
        .where("clockId", "=", row.clockId)
        .execute();
      const items = changes
        .map((c) => ClockChangeReceiptSchema.parse(c.receipt))
        .filter(
          (c) =>
            c.record.revision > after &&
            c.record.revision <=
              (input.clockRef.revision ?? positive(row.revision)),
        )
        .sort((a, b) => a.record.revision - b.record.revision);
      return {
        items: items.slice(0, limit),
        ...(items.length > limit
          ? { afterRevision: items[limit - 1].record.revision }
          : {}),
      };
    },
    domains: {
      createIn: (
        db: Kysely<any>,
        ctx: CallContext,
        input: z.infer<typeof TimeDomainCreateSchema>,
      ) => domainCreateIn(db, ctx, input),
      create: (
        ctx: CallContext,
        input: z.infer<typeof TimeDomainCreateSchema>,
      ) =>
        within("time.domains.create", (db) => domainCreateIn(db, ctx, input)),
      async read(ctx: CallContext, domainId: string, db = database) {
        const row = await db
          .selectFrom("timeDomains")
          .selectAll()
          .where("domainId", "=", domainId)
          .executeTakeFirst();
        if (!row)
          throw problem("time.domain_not_found", "not_found", "时间域不存在");
        ownership(ctx, row.subjectId);
        await store.authorize(
          scoped(ctx, row.subjectId),
          "time.domains.read",
          ref("TimeDomain", domainId, row.subjectId ?? undefined),
          db,
        );
        return TimeDomainSchema.parse({
          ...row,
          subjectId: row.subjectId ?? undefined,
          coordinateSystem: "iso8601",
          precision: "microsecond",
        });
      },
    },
    async validateCapture(
      ctx: CallContext,
      input: TimeCaptureReceipt,
      db = database,
    ) {
      const receipt = TimeCaptureReceiptSchema.parse(input);
      own(receipt.captureRef, "TimeCapture");
      const row = await db
        .selectFrom("clockCaptures")
        .selectAll()
        .where("captureId", "=", receipt.captureRef.id)
        .executeTakeFirst();
      if (!row)
        throw problem("time.capture_not_found", "not_found", "捕获事实不存在");
      ownership(ctx, row.subjectId);
      await store.authorize(
        scoped(ctx, row.subjectId),
        "clock.references.read",
        row.receipt.captureRef,
        db,
      );
      if (canonicalize(receipt) !== canonicalize(row.receipt))
        throw problem(
          "time.capture_mismatch",
          "conflict",
          "捕获回执与正式事实不同",
        );
      return TimeCaptureReceiptSchema.parse(row.receipt);
    },
    projectDeadline,
    subscribe(
      listener: (change: {
        domainId: string;
        clockRef: Ref;
      }) => void | Promise<void>,
    ) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notifyChanged: emit,
  };
  return api;
}
export type Time = ReturnType<typeof createTime>;
