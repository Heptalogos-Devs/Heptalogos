// Clock-owner data closure. Product data management owns the enclosing operation/receipt.
// Copyright 2026 Aravine Zhu; SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
import type { Kysely } from "kysely";
import { sql } from "@nous-wave/platform/storage";
import { problem } from "@nous-wave/platform/errors";
import { canonicalize } from "json-canonicalize";
import {
  ActorSchema,
  ConsumerSchema,
  InstantSchema,
  JsonValueSchema,
  RefSchema,
  type CallContext,
  type Ref,
} from "@nous-wave/contracts/common";
import {
  ClockRecordSchema,
  ClockSegmentSchema,
  ClockChangeReceiptSchema,
  TimeDomainSchema,
  TimeCaptureReceiptSchema,
  ClockRateSchema,
  type ClockSegment,
} from "@nous-wave/contracts/time";
import { micros } from "@nous-wave/platform/time";
import type { TimeDatabase } from "./migration.js";
const json = <T>(value: T) => sql<T>`${JSON.stringify(value)}::jsonb`;
const metadata = {
  operationId: z.string().min(1),
  requestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  actor: ActorSchema,
  actorAuthorityRef: z.string().min(1),
  consumer: ConsumerSchema,
};
export const TimeDataBundleSchema = z.strictObject({
  formatVersion: z.literal(1),
  sourceInstallationId: z.string().min(1),
  subjectId: z.string().nullable(),
  domains: z.array(TimeDomainSchema),
  clocks: z.array(ClockRecordSchema),
  segments: z.array(ClockSegmentSchema),
  checkpoints: z.array(
    z.strictObject({
      clockId: z.uuid(),
      segmentId: z.uuid(),
      clockRevision: z.string().regex(/^[1-9]\d*$/),
      domainHighWater: InstantSchema,
      capturedRealAt: InstantSchema,
    }),
  ),
  captures: z.array(
    z.strictObject({
      ...metadata,
      captureId: z.uuid(),
      originRef: RefSchema.nullable(),
      domainId: z.string(),
      clockId: z.uuid().nullable(),
      subjectId: z.string().nullable(),
      receipt: TimeCaptureReceiptSchema,
      recordedRealAt: InstantSchema,
    }),
  ),
  changes: z.array(
    z.strictObject({
      ...metadata,
      clockId: z.uuid(),
      request: JsonValueSchema,
      receipt: ClockChangeReceiptSchema,
      recordedRealAt: InstantSchema,
    }),
  ),
  domainReceipts: z.array(
    z.strictObject({ ...metadata, result: TimeDomainSchema }),
  ),
});
export type TimeDataBundle = z.infer<typeof TimeDataBundleSchema>;
interface Options {
  installationId: string;
  db: Kysely<TimeDatabase>;
  authorize(
    ctx: CallContext,
    operation: string,
    target?: Ref,
    db?: Kysely<any>,
  ): Promise<void>;
  readReferences(
    ctx: CallContext,
    input: { refs: Ref[] },
    db: Kysely<any>,
  ): Promise<{ items: { ref: Ref; value?: unknown; problem?: unknown }[] }>;
  record(row: TimeDatabase["clocks"]): z.infer<typeof ClockRecordSchema>;
  imported(db: Kysely<TimeDatabase>, clockIds: string[]): Promise<void>;
  removed(segmentIds: string[]): void;
}
export function createTimeData(options: Options) {
  const within = <T>(
    client: Kysely<any> | undefined,
    use: (db: Kysely<TimeDatabase>) => Promise<T>,
  ) =>
    client
      ? use(client)
      : options.db
          .transaction()
          .setIsolationLevel("repeatable read")
          .execute(use);
  const checkSubject = (ctx: CallContext, subjectId?: string | null) => {
    if (ctx.subjectId !== undefined && ctx.subjectId !== subjectId)
      throw problem(
        "time.subject_mismatch",
        "forbidden",
        "时间数据不属于当前主体范围",
      );
  };
  const sourceRef = (
    kind: string,
    id: string,
    subjectId?: string | null,
    revision?: number,
  ): Ref => ({
    product: "hept",
    installationId: options.installationId,
    kind,
    id,
    ...(subjectId ? { subjectId } : {}),
    ...(revision ? { revision } : {}),
  });
  return {
    export(
      ctx: CallContext,
      input: { subjectId?: string; refs?: Ref[] },
      client?: Kysely<any>,
    ) {
      return within(client, async (db) => {
        checkSubject(ctx, input.subjectId);
        await options.authorize(ctx, "data.export", undefined, db);
        const requested = z
            .array(RefSchema)
            .max(200)
            .parse(input.refs ?? []),
          resolved = await options.readReferences(ctx, { refs: requested }, db);
        if (resolved.items.some((item) => item.problem))
          throw problem(
            "time.export_reference_unavailable",
            "forbidden",
            "导出的时间来源引用不可用",
          );
        let cq = db.selectFrom("clockCaptures").selectAll();
        if (input.subjectId) cq = cq.where("subjectId", "=", input.subjectId);
        const captures = await cq.execute();
        const ids = new Set(
          captures.flatMap((c) => (c.clockId ? [c.clockId] : [])),
        );
        for (const item of resolved.items) {
          if (item.ref.kind === "Clock") ids.add(item.ref.id);
          if (item.ref.kind === "ClockSegment")
            ids.add((item.value as ClockSegment).clockRef.id);
          if (
            item.ref.kind === "TimeCapture" &&
            item.value &&
            typeof item.value === "object" &&
            "clockRef" in item.value
          )
            ids.add((item.value as { clockRef: Ref }).clockRef.id);
        }
        let clocksQuery = db.selectFrom("clocks").selectAll();
        if (input.subjectId)
          clocksQuery = clocksQuery.where((eb) =>
            eb.or([
              eb("subjectId", "=", input.subjectId!),
              ...(ids.size ? [eb("clockId", "in", [...ids])] : []),
            ]),
          );
        const clocks = await clocksQuery.forShare().execute();
        for (const row of clocks) ids.add(row.clockId);
        const clockIds = [...ids],
          segments = clockIds.length
            ? await db
                .selectFrom("clockSegments")
                .selectAll()
                .where("clockId", "in", clockIds)
                .execute()
            : [],
          checkpoints = clockIds.length
            ? await db
                .selectFrom("clockCheckpoints")
                .selectAll()
                .where("clockId", "in", clockIds)
                .execute()
            : [],
          changes = clockIds.length
            ? await db
                .selectFrom("clockChanges")
                .selectAll()
                .where("clockId", "in", clockIds)
                .execute()
            : [];
        const domainIds = new Set([
          ...clocks.map((c) => c.domainId),
          ...captures.map((c) => c.domainId),
          ...requested.filter((r) => r.kind === "TimeDomain").map((r) => r.id),
        ]);
        let dq = db.selectFrom("timeDomains").selectAll();
        if (input.subjectId)
          dq = dq.where((eb) =>
            eb.or([
              eb("subjectId", "=", input.subjectId!),
              ...(domainIds.size ? [eb("domainId", "in", [...domainIds])] : []),
            ]),
          );
        const domains = await dq.execute();
        const domainSet = new Set(domains.map((d) => d.domainId));
        const domainReceipts = (
          await db.selectFrom("timeDomainReceipts").selectAll().execute()
        ).filter((r) => domainSet.has(r.result.domainId));
        return TimeDataBundleSchema.parse({
          formatVersion: 1,
          sourceInstallationId: options.installationId,
          subjectId: input.subjectId ?? null,
          domains: domains.map((d) => ({
            ...d,
            subjectId: d.subjectId ?? undefined,
            coordinateSystem: "iso8601",
            precision: "microsecond",
          })),
          clocks: clocks.map(options.record),
          segments: segments.map((seg) => {
            const row = clocks.find((c) => c.clockId === seg.clockId)!;
            return {
              ref: sourceRef("ClockSegment", seg.segmentId, row.subjectId),
              clockRef: sourceRef(
                "Clock",
                row.clockId,
                row.subjectId,
                Number(seg.revision),
              ),
              domainId: row.domainId,
              revision: Number(seg.revision),
              domainAnchor: seg.domainAnchor,
              realAnchor: seg.realAnchor,
              rate: ClockRateSchema.parse(seg.rate),
              startedByOperationId: seg.operationId,
              reason: seg.reason,
            };
          }),
          checkpoints,
          captures,
          changes,
          domainReceipts,
        });
      });
    },
    import(ctx: CallContext, input: unknown, client?: Kysely<any>) {
      return within(client, async (db) => {
        const bundle = TimeDataBundleSchema.parse(input);
        checkSubject(ctx, bundle.subjectId);
        await options.authorize(ctx, "data.import", undefined, db);
        if (bundle.sourceInstallationId !== options.installationId)
          throw problem(
            "time.restore_identity_required",
            "conflict",
            "时间authority恢复须采用原安装身份；跨安装映射需显式来源连接",
          );
        const owned = new Set(bundle.clocks.map((c) => c.ref.id));
        const local = (reference: Ref) =>
          reference.product === "hept" &&
          reference.installationId === options.installationId;
        for (const domain of bundle.domains)
          if (
            !local(domain.authorityRef) ||
            domain.authorityRef.kind !== "Installation" ||
            domain.authorityRef.id !== options.installationId
          )
            throw problem(
              "time.import_authority_mismatch",
              "validation",
              "时间域的authority不是本安装",
            );
        for (const record of bundle.clocks) {
          if (
            record.ref.product !== "hept" ||
            record.ref.installationId !== options.installationId ||
            (record.ref.subjectId !== undefined &&
              record.ref.subjectId !== (bundle.subjectId ?? undefined)) ||
            record.currentSegmentRef.installationId !== options.installationId
          )
            throw problem(
              "time.import_identity_mismatch",
              "validation",
              "时间数据包含其他authority或主体",
            );
        }
        for (const capture of bundle.captures) {
          const receipt = capture.receipt;
          if (
            capture.originRef &&
            (!local(capture.originRef) ||
              capture.originRef.kind !== "ModelInvocation" ||
              capture.originRef.selector ||
              capture.originRef.revision !== undefined ||
              capture.originRef.subjectId !== (capture.subjectId ?? undefined))
          )
            throw problem(
              "time.import_origin_mismatch",
              "validation",
              "终止捕获来源与实际主体不符",
            );
          if (
            !local(receipt.captureRef) ||
            receipt.captureRef.subjectId !== (capture.subjectId ?? undefined) ||
            ("clockRef" in receipt
              ? capture.clockId !== receipt.clockRef.id
              : capture.clockId !== null)
          )
            throw problem(
              "time.import_capture_identity_mismatch",
              "validation",
              "捕获身份与归属不匹配",
            );
          if (
            receipt.captureRef.id !== capture.captureId ||
            receipt.captureRef.installationId !== options.installationId ||
            receipt.point.domainId !== capture.domainId ||
            capture.subjectId !== (bundle.subjectId ?? capture.subjectId)
          )
            throw problem(
              "time.import_capture_mismatch",
              "validation",
              "时间捕获闭包不匹配",
            );
          if (
            "clockRef" in receipt &&
            !bundle.segments.some(
              (s) =>
                s.ref.id === receipt.segmentRef.id &&
                s.clockRef.id === receipt.clockRef.id &&
                s.revision === receipt.clockRevision &&
                s.domainId === receipt.point.domainId,
            )
          )
            throw problem(
              "time.import_segment_missing",
              "validation",
              "捕获所引用的实际段缺失",
            );
        }
        for (const domain of bundle.domains)
          await db
            .insertInto("timeDomains")
            .values({
              domainId: domain.domainId,
              label: domain.label,
              authorityRef: json(domain.authorityRef),
              status: domain.status,
              subjectId: domain.subjectId ?? null,
              createdRealAt: domain.createdRealAt,
            })
            .onConflict((oc) => oc.column("domainId").doNothing())
            .execute();
        const inserted: string[] = [];
        for (const value of bundle.clocks) {
          const existing = await db
            .selectFrom("clocks")
            .selectAll()
            .where("clockId", "=", value.ref.id)
            .executeTakeFirst();
          if (existing) {
            const cp = await db
              .selectFrom("clockCheckpoints")
              .selectAll()
              .where("clockId", "=", value.ref.id)
              .executeTakeFirst();
            if (
              bundle.captures.some(
                (c) =>
                  c.clockId === value.ref.id &&
                  (!cp || c.receipt.point.at > cp.domainHighWater),
              )
            )
              throw problem(
                "time.import_current_clock_conflict",
                "conflict",
                "现有Clock高水位低于包中捕获，须明确恢复该authority",
              );
            if (
              existing.domainId !== value.domainId ||
              existing.subjectId !== (value.ref.subjectId ?? null)
            )
              throw problem(
                "time.import_clock_conflict",
                "conflict",
                "已有Clock身份与包不一致",
              );
            continue;
          }
          await db
            .insertInto("clocks")
            .values({
              clockId: value.ref.id,
              domainId: value.domainId,
              subjectId: value.ref.subjectId ?? null,
              revision: String(value.revision),
              currentSegmentId: value.currentSegmentRef.id,
              onlineRate: value.onlineRate,
              offlinePolicy: json(value.offlinePolicy),
              status: value.status,
            })
            .execute();
          inserted.push(value.ref.id);
        }
        for (const seg of bundle.segments) {
          const record = bundle.clocks.find(
            (c) => c.ref.id === seg.clockRef.id,
          );
          if (
            !owned.has(seg.clockRef.id) ||
            !local(seg.ref) ||
            !local(seg.clockRef) ||
            seg.clockRef.revision !== seg.revision ||
            seg.domainId !== record?.domainId ||
            seg.ref.subjectId !== record.ref.subjectId ||
            seg.clockRef.subjectId !== record.ref.subjectId
          )
            throw problem(
              "time.import_segment_mismatch",
              "validation",
              "段不属于所导入Clock闭包",
            );
          const value = {
            segmentId: seg.ref.id,
            clockId: seg.clockRef.id,
            revision: String(seg.revision),
            domainAnchor: seg.domainAnchor,
            realAnchor: seg.realAnchor,
            rate: seg.rate,
            operationId: seg.startedByOperationId,
            reason: seg.reason,
          };
          const old = await db
            .selectFrom("clockSegments")
            .selectAll()
            .where("segmentId", "=", value.segmentId)
            .executeTakeFirst();
          if (old && canonicalize(old) !== canonicalize(value))
            throw problem(
              "time.import_segment_conflict",
              "conflict",
              "不可变时钟段内容冲突",
            );
          if (!old)
            await db.insertInto("clockSegments").values(value).execute();
        }
        for (const row of bundle.checkpoints) {
          if (!inserted.includes(row.clockId)) continue;
          const captures = bundle.captures.filter(
            (c) => c.clockId === row.clockId,
          );
          if (
            captures.some(
              (c) => micros(c.receipt.point.at) > micros(row.domainHighWater),
            )
          )
            throw problem(
              "time.import_high_water_invalid",
              "validation",
              "高水位低于已导入实际捕获",
            );
          await db.insertInto("clockCheckpoints").values(row).execute();
        }
        for (const row of bundle.captures) {
          const old = await db
            .selectFrom("clockCaptures")
            .selectAll()
            .where("captureId", "=", row.captureId)
            .executeTakeFirst();
          if (old && canonicalize(old) !== canonicalize(row))
            throw problem(
              "time.import_capture_conflict",
              "conflict",
              "捕获事实内容冲突",
            );
          if (!old)
            await db
              .insertInto("clockCaptures")
              .values({
                ...row,
                consumer: json(row.consumer),
                receipt: json(row.receipt),
                originRef: row.originRef ? json(row.originRef) : null,
              })
              .execute();
        }
        for (const row of bundle.changes) {
          const old = await db
            .selectFrom("clockChanges")
            .selectAll()
            .where("clockId", "=", row.clockId)
            .where("operationId", "=", row.operationId)
            .executeTakeFirst();
          if (old && canonicalize(old) !== canonicalize(row))
            throw problem(
              "time.import_change_conflict",
              "conflict",
              "改钟回执内容冲突",
            );
          if (!old)
            await db
              .insertInto("clockChanges")
              .values({
                ...row,
                consumer: json(row.consumer),
                request: json(row.request),
                receipt: json(row.receipt),
              })
              .execute();
        }
        for (const row of bundle.domainReceipts) {
          const old = await db
            .selectFrom("timeDomainReceipts")
            .selectAll()
            .where("operationId", "=", row.operationId)
            .executeTakeFirst();
          if (old && canonicalize(old) !== canonicalize(row))
            throw problem(
              "time.import_domain_receipt_conflict",
              "conflict",
              "域创建回执内容冲突",
            );
          if (!old)
            await db
              .insertInto("timeDomainReceipts")
              .values({
                ...row,
                consumer: json(row.consumer),
                result: json(row.result),
              })
              .execute();
        }
        await options.imported(db, inserted);
        return {
          clocks: bundle.clocks.length,
          segments: bundle.segments.length,
          captures: bundle.captures.length,
          restored: inserted.length,
        };
      });
    },
    deleteSubject(
      ctx: CallContext,
      input: { subjectId: string },
      client?: Kysely<any>,
    ) {
      return within(client, async (db) => {
        checkSubject(ctx, input.subjectId);
        await options.authorize(ctx, "data.purge", undefined, db);
        const clocks = await db
            .selectFrom("clocks")
            .selectAll()
            .where("subjectId", "=", input.subjectId)
            .forUpdate()
            .execute(),
          ids = clocks.map((c) => c.clockId),
          domains = await db
            .selectFrom("timeDomains")
            .select("domainId")
            .where("subjectId", "=", input.subjectId)
            .execute();
        if (ids.length) {
          const foreign = await db
            .selectFrom("clockCaptures")
            .select("captureId")
            .where("clockId", "in", ids)
            .where((eb) =>
              eb.or([
                eb("subjectId", "!=", input.subjectId),
                eb("subjectId", "is", null),
              ]),
            )
            .limit(1)
            .executeTakeFirst();
          if (foreign)
            throw problem(
              "time.retained_by_other_subject",
              "conflict",
              "其他主体仍引用该时钟，须先完成来源保留处理",
            );
        }
        await db
          .deleteFrom("clockCaptures")
          .where("subjectId", "=", input.subjectId)
          .execute();
        if (ids.length) {
          const segments = await db
            .selectFrom("clockSegments")
            .select("segmentId")
            .where("clockId", "in", ids)
            .execute();
          await db
            .deleteFrom("clockChanges")
            .where("clockId", "in", ids)
            .execute();
          await db
            .deleteFrom("clockCheckpoints")
            .where("clockId", "in", ids)
            .execute();
          await db
            .deleteFrom("clockSegments")
            .where("clockId", "in", ids)
            .execute();
          await db.deleteFrom("clocks").where("clockId", "in", ids).execute();
          options.removed(segments.map((s) => s.segmentId));
        }
        for (const domain of domains) {
          await db
            .deleteFrom("timeDomainReceipts")
            .where(sql<string>`result->>'domainId'`, "=", domain.domainId)
            .execute();
          await db
            .deleteFrom("timeDomains")
            .where("domainId", "=", domain.domainId)
            .execute();
        }
        return { clocks: ids.length, domains: domains.length };
      });
    },
  };
}
