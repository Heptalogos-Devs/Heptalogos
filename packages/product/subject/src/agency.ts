// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Product authority for native durable delivery; no network execution lives here.
 * @module agency
 */
import {
  createUuidV7Id,
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import {
  type PersistenceInternalTransaction,
  executeRepositorySql,
  readRepositorySql,
  useRepositoryMutationTransaction,
} from "@heptalogos/persistence/repository";
import {
  preparedDeliverySchema,
  authorizeDeliverySchema,
  recordDeliverySchema,
  type PreparedDelivery,
  type AgencyOptions,
  type AgencyRunAuthority,
} from "./agency-contracts.js";
import { activitySchema, type LifeActivity } from "./contracts.js";
import { subjectProblem } from "./problems.js";
const hash = (value: unknown) =>
  digestCanonicalJson("agency.delivery.v1", value as CanonicalJsonValue).hex;
function checked<T>(schema: Parameters<typeof compileSchema<T>>[0], value: unknown): T {
  const result = compileSchema<T>(schema).validate(value);
  if (!result.ok)
    deny(
      "agency.invalid_input",
      "The native delivery does not match the owning contract",
    );
  return result.value;
}
function deny(code: string, detail: string): never {
  throw subjectProblem(code, "Delivery is not authorized", detail);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    deny("agency.invalid_payload", "Expected a complete native payload object");
  return value as Record<string, unknown>;
}
function active(authority: AgencyRunAuthority) {
  const a = authority.activity;
  if (
    authority.role !== "subject.render" ||
    a.state !== "active" ||
    a.continuationRequired ||
    !a.scope ||
    !a.adoptedBy ||
    a.adoptedBy !== authority.actorEntityRef
  )
    deny(
      "agency.scope_denied",
      "The adopted rendered expression and original Activity must still allow this effect",
    );
  if (
    !a.scope.conversations.some(
      (c) =>
        c.conversationRef === authority.conversationRef &&
        c.operations.includes("send"),
    )
  )
    deny("agency.scope_denied", "The actual conversation has no send grant");
  if (
    authority.sourceRefs.some(
      (ref) =>
        !a.scope!.sourceRefs.includes(ref) &&
        !(
          ref.startsWith("message:") &&
          authority.messageSources.some(
            (source) =>
              source.sourceRef === ref &&
              source.conversationRef === authority.conversationRef &&
              a.scope!.conversations.some(
                (c) =>
                  c.conversationRef === source.conversationRef &&
                  c.operations.includes("observe"),
              ),
          )
        ),
    )
  )
    deny(
      "agency.source_denied",
      "A used source cannot be transmitted under the current Activity scope",
    );
}
function entries(input: PreparedDelivery) {
  const batch = input.preparedBatch;
  if (
    batch.schemaVersion !== 1 ||
    !Array.isArray(batch.entries) ||
    batch.entries.length > 512 ||
    batch.runId !== input.runId
  )
    deny(
      "agency.invalid_payload",
      "The actual prepared native batch and producer run are required",
    );
  const seen = new Set<number>();
  const accepted = batch.entries
    .map(record)
    .filter((e) => e.status === "accepted")
    .map((e) => {
      if (
        !Number.isInteger(e.sourceIndex) ||
        (e.sourceIndex as number) < 0 ||
        seen.has(e.sourceIndex as number)
      )
        deny(
          "agency.invalid_payload",
          "Original source indices must be unique nonnegative integers",
        );
      seen.add(e.sourceIndex as number);
      return { sourceIndex: e.sourceIndex as number, payload: record(e.payload) };
    });
  if (!accepted.length)
    deny("agency.invalid_payload", "An empty prepared batch cannot be adopted");
  return accepted;
}
function exactPayload(
  input: PreparedDelivery,
  actual: Static<typeof authorizeDeliverySchema>["payload"],
) {
  const accepted = entries(input).find((e) => e.sourceIndex === actual.sourceIndex);
  if (!accepted) deny("agency.payload_changed", "The source index was not adopted");
  if ((actual.deliveryPartIndex ?? 0) !== 0 || (actual.deliveryPartCount ?? 1) !== 1)
    deny(
      "agency.payload_changed",
      "QQ currently sends each complete approved source payload as one part",
    );
  const p = accepted.payload;
  if (actual.kind === "payload") {
    if (hash(actual.payload) !== hash(p))
      deny(
        "agency.payload_changed",
        "The complete actual native payload changed after adoption",
      );
  } else {
    if ((actual.text ?? "") !== (p.text ?? ""))
      deny("agency.payload_changed", "The complete approved text must be preserved");
    const urls = Array.isArray(p.mediaUrls)
      ? p.mediaUrls
      : p.mediaUrl
        ? [p.mediaUrl]
        : [];
    if (actual.kind === "text" && (urls.length || actual.mediaUrl))
      deny("agency.payload_changed", "A media payload cannot become a text-only send");
    if (actual.kind === "media" && (urls.length !== 1 || actual.mediaUrl !== urls[0]))
      deny(
        "agency.payload_changed",
        "The complete approved media source must be preserved",
      );
    if (p.channelData || p.poll || p.buttons)
      deny(
        "agency.invalid_payload",
        "This payload requires a supported complete native payload route",
      );
  }
  return p;
}
type Behavior = {
  behaviorId: string;
  request: PreparedDelivery;
  subjectId: string;
  activityId: string;
  actorEntityRef: string;
  sourceRefs: readonly string[];
};
/** Adopts exact batches and records each send point behind the existing Host transaction fence. */
export function createAgencyService(options: AgencyOptions) {
  const load = async (reference: string): Promise<Behavior> => {
    const rows = await readRepositorySql<{ document: Behavior }>(
      options.persistence,
      "SELECT document FROM heptalogos.agency_behavior WHERE behavior_id=$1",
      [reference],
    );
    if (!rows[0]) deny("agency.not_found", "The behavior reference is unknown");
    return rows[0].document;
  };
  type Delivery = Static<typeof authorizeDeliverySchema>;
  type Part = { state: string; document: Record<string, unknown> };
  const exact = (behavior: Behavior, input: Delivery) => {
    if (
      input.channel !== behavior.request.channel ||
      input.accountId !== behavior.request.accountId ||
      input.to !== behavior.request.to
    )
      deny(
        "agency.recipient_changed",
        "The recipient differs from the adopted behavior",
      );
    const prepared = exactPayload(behavior.request, input.payload);
    const firstSource = entries(behavior.request)[0]!.sourceIndex;
    const inheritedReply =
      behavior.request.replyToMode === "first" &&
      input.payload.sourceIndex !== firstSource
        ? null
        : (behavior.request.replyToId ?? null);
    const replyToId = prepared.replyToId ?? inheritedReply;
    if (
      (input.replyToId ?? null) !== replyToId ||
      (input.threadId ?? null) !== (behavior.request.threadId ?? null)
    )
      deny(
        "agency.recipient_changed",
        "The actual reply target or thread differs from the adopted behavior",
      );
  };
  const partDigest = (input: Delivery) =>
    hash({
      payload: input.payload,
      replyToId: input.replyToId ?? null,
      threadId: input.threadId ?? null,
    });
  const prior = (old: Part | undefined, input: Delivery) => {
    if (
      old &&
      (old.document.payloadDigest !== partDigest(input) ||
        old.document.deliveryQueueId !== input.deliveryQueueId)
    )
      deny(
        "agency.part_changed",
        "The durable queue or exact part differs from the first attempt",
      );
    return old?.state === "accepted"
      ? (old.document.outcome as Static<typeof recordDeliverySchema>["outcome"])
      : undefined;
  };
  const authorizeCurrent = async (
    behavior: Behavior,
    input: Delivery,
    activity?: LifeActivity,
    transaction?: PersistenceInternalTransaction,
  ) => {
    const resolved = await options.authority(
      behavior.request.runId,
      input,
      transaction,
    );
    const current = activity ? { ...resolved, activity } : resolved;
    active(current);
    if (
      current.activity.activityId !== behavior.activityId ||
      current.activity.subjectId !== behavior.subjectId ||
      current.actorEntityRef !== behavior.actorEntityRef ||
      hash(current.sourceRefs) !== hash(behavior.sourceRefs)
    )
      deny(
        "agency.scope_changed",
        "The original actor, Activity or source scope changed",
      );
  };
  const prepareAdoption = async (value: PreparedDelivery) => {
    const input = checked<PreparedDelivery>(preparedDeliverySchema, value);
    entries(input);
    const current = await options.authority(input.runId, input);
    active(current);
    return { input, current };
  };
  const adoptDeliveryIn = async (
    tx: PersistenceInternalTransaction,
    input: PreparedDelivery,
    current: AgencyRunAuthority,
  ) => {
    checked<PreparedDelivery>(preparedDeliverySchema, input);
    entries(input);
    active(current);
    const digest = hash(input);
    const activities = await executeRepositorySql<{ document: unknown }>(
      tx,
      "SELECT document FROM heptalogos.life_activity WHERE subject_id=$1 AND activity_id=$2 FOR UPDATE",
      [current.activity.subjectId, current.activity.activityId],
    );
    if (!activities[0])
      deny("agency.scope_denied", "The adopted Activity no longer exists");
    const latest = await options.authority(input.runId, input, tx);
    const finalAuthority = {
      ...latest,
      activity: checked<LifeActivity>(activitySchema, activities[0].document),
    };
    active(finalAuthority);
    if (
      finalAuthority.activity.activityId !== current.activity.activityId ||
      finalAuthority.actorEntityRef !== current.actorEntityRef
    )
      deny("agency.scope_changed", "The actual Activity changed during adoption");
    const behaviorId = createUuidV7Id("BehaviorId");
    const document: Behavior = {
      behaviorId,
      request: input,
      subjectId: current.activity.subjectId,
      activityId: current.activity.activityId,
      actorEntityRef: current.actorEntityRef,
      sourceRefs: finalAuthority.sourceRefs,
    };
    await executeRepositorySql(
      tx,
      "INSERT INTO heptalogos.agency_behavior(behavior_id,subject_id,activity_id,run_id,native_intent_id,request_digest,document,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT(native_intent_id) DO NOTHING",
      [
        behaviorId,
        document.subjectId,
        document.activityId,
        input.runId,
        input.nativeIntentId,
        digest,
        JSON.stringify(document),
        options.now(),
      ],
    );
    const rows = await executeRepositorySql<{
      behavior_id: string;
      request_digest: string;
    }>(
      tx,
      "SELECT behavior_id,request_digest FROM heptalogos.agency_behavior WHERE native_intent_id=$1",
      [input.nativeIntentId],
    );
    if (!rows[0] || rows[0].request_digest !== digest)
      deny(
        "agency.intent_conflict",
        "The native intent is already bound to another exact batch",
      );
    return { reference: rows[0].behavior_id };
  };
  return {
    prepareAdoption,
    adoptDeliveryIn,
    async adoptDelivery(value: PreparedDelivery) {
      const prepared = await prepareAdoption(value);
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, (tx) =>
          adoptDeliveryIn(tx, prepared.input, prepared.current),
        ),
      );
    },
    async authorizeDelivery(value: Static<typeof authorizeDeliverySchema>) {
      const input = checked<Delivery>(authorizeDeliverySchema, value);
      const behavior = await load(input.reference);
      exact(behavior, input);
      const rows = await readRepositorySql<Part>(
        options.persistence,
        "SELECT state,document FROM heptalogos.agency_delivery_part WHERE behavior_id=$1 AND source_index=$2 AND part_index=$3",
        [
          input.reference,
          input.payload.sourceIndex,
          input.payload.deliveryPartIndex ?? 0,
        ],
      );
      // Reading a known receipt does not start a new effect or require an active Activity.
      if (!prior(rows[0], input)) await authorizeCurrent(behavior, input);
      return { authorized: true as const };
    },
    async beginDelivery(value: Static<typeof authorizeDeliverySchema>) {
      const input = checked<Delivery>(authorizeDeliverySchema, value);
      const behavior = await load(input.reference);
      exact(behavior, input);
      const previous = await readRepositorySql<Part>(
        options.persistence,
        "SELECT state,document FROM heptalogos.agency_delivery_part WHERE behavior_id=$1 AND source_index=$2 AND part_index=$3",
        [
          input.reference,
          input.payload.sourceIndex,
          input.payload.deliveryPartIndex ?? 0,
        ],
      );
      const known = prior(previous[0], input);
      if (known) return { action: "return" as const, outcome: known };
      if (previous[0] && previous[0].state !== "not_sent")
        deny(
          "agency.send_unresolved",
          "The prior actual send is failed, in flight or uncertain; automatic replay is forbidden",
        );

      // No remote work is permitted inside the fenced write transaction. The
      // actual source propagation check precedes it; current local grants and
      // cancellation are then checked while holding the adopted Activity row.
      await options.checkSources(behavior.request.runId);
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          const behaviors = await executeRepositorySql<{ document: Behavior }>(
            tx,
            "SELECT document FROM heptalogos.agency_behavior WHERE behavior_id=$1 FOR UPDATE",
            [input.reference],
          );
          if (!behaviors[0])
            deny("agency.not_found", "The behavior reference is unknown");
          const behavior = behaviors[0].document;
          exact(behavior, input);
          const rows = await executeRepositorySql<Part>(
            tx,
            "SELECT state,document FROM heptalogos.agency_delivery_part WHERE behavior_id=$1 AND source_index=$2 AND part_index=$3 FOR UPDATE",
            [
              input.reference,
              input.payload.sourceIndex,
              input.payload.deliveryPartIndex ?? 0,
            ],
          );
          const old = rows[0];
          const receipt = prior(old, input);
          if (receipt) return { action: "return" as const, outcome: receipt };
          if (old && old.state !== "not_sent")
            deny(
              "agency.send_unresolved",
              "This payload already crossed the send point, failed, or has an uncertain outcome; automatic replay is forbidden",
            );
          // Life transitions take this same row lock. Their committed document, not
          // an authority snapshot read before waiting, decides the new send point.
          const activities = await executeRepositorySql<{ document: unknown }>(
            tx,
            "SELECT document FROM heptalogos.life_activity WHERE subject_id=$1 AND activity_id=$2 FOR UPDATE",
            [behavior.subjectId, behavior.activityId],
          );
          if (!activities[0])
            deny("agency.scope_denied", "The adopted Activity no longer exists");
          await authorizeCurrent(
            behavior,
            input,
            checked<LifeActivity>(activitySchema, activities[0].document),
            tx,
          );
          const attemptId = createUuidV7Id("DeliveryAttemptId");
          const document = {
            payloadDigest: partDigest(input),
            deliveryQueueId: input.deliveryQueueId,
            attemptId,
            state: "dispatching",
          };
          await executeRepositorySql(
            tx,
            "INSERT INTO heptalogos.agency_delivery_part(behavior_id,source_index,part_index,state,document,updated_at) VALUES($1,$2,$3,'dispatching',$4::jsonb,$5) ON CONFLICT(behavior_id,source_index,part_index) DO UPDATE SET state=excluded.state,document=excluded.document,updated_at=excluded.updated_at",
            [
              input.reference,
              input.payload.sourceIndex,
              input.payload.deliveryPartIndex ?? 0,
              JSON.stringify(document),
              options.now(),
            ],
          );
          return { action: "send" as const, attemptId };
        }),
      );
    },
    async recordDelivery(value: Static<typeof recordDeliverySchema>) {
      const input = checked<Static<typeof recordDeliverySchema>>(
        recordDeliverySchema,
        value,
      );
      const behavior = await load(input.reference);
      await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          const rows = await executeRepositorySql<{
            state: string;
            document: Record<string, unknown>;
          }>(
            tx,
            "SELECT state,document FROM heptalogos.agency_delivery_part WHERE behavior_id=$1 AND source_index=$2 AND part_index=$3 FOR UPDATE",
            [input.reference, input.sourceIndex, input.partIndex],
          );
          const old = rows[0];
          if (!old || old.document.attemptId !== input.attemptId)
            deny(
              "agency.attempt_conflict",
              "The result does not belong to this persisted attempt",
            );
          if (old.document.outcome) {
            if (hash(old.document.outcome) === hash(input.outcome))
              return { recorded: true as const };
            if (old.state !== "uncertain" || input.outcome.state !== "accepted")
              deny("agency.result_conflict", "A known result cannot be overwritten");
          }
          if (!["dispatching", "uncertain"].includes(old.state))
            deny(
              "agency.result_conflict",
              "This attempt is not awaiting a real network result",
            );
          // A late reliable receipt may resolve a crash-marked uncertain attempt; text matching cannot.
          const document = {
            ...old.document,
            state: input.outcome.state,
            outcome: input.outcome,
          };
          await executeRepositorySql(
            tx,
            "UPDATE heptalogos.agency_delivery_part SET state=$4,document=$5::jsonb,updated_at=$6 WHERE behavior_id=$1 AND source_index=$2 AND part_index=$3",
            [
              input.reference,
              input.sourceIndex,
              input.partIndex,
              input.outcome.state,
              JSON.stringify(document),
              options.now(),
            ],
          );
          return { recorded: true as const };
        }),
      );
      if (options.onDeliveryRecorded) {
        const rows = await readRepositorySql<{
          updated_at: string | Date;
          document: { attemptId: string; outcome: typeof input.outcome };
        }>(
          options.persistence,
          "SELECT updated_at,document FROM heptalogos.agency_delivery_part WHERE behavior_id=$1 AND source_index=$2 AND part_index=$3",
          [input.reference, input.sourceIndex, input.partIndex],
        );
        const saved = rows[0]!;
        await options.onDeliveryRecorded({
          subjectId: behavior.subjectId,
          activityId: behavior.activityId,
          runId: behavior.request.runId,
          reference: input.reference,
          nativeIntentId: behavior.request.nativeIntentId,
          channel: behavior.request.channel,
          accountId: behavior.request.accountId,
          to: behavior.request.to,
          sourceIndex: input.sourceIndex,
          partIndex: input.partIndex,
          attemptId: saved.document.attemptId,
          outcome: saved.document.outcome,
          recordedAt: new Date(saved.updated_at).toISOString(),
        });
      }
      return { recorded: true as const };
    },
  };
}
