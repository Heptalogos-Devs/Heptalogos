// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Consumes one durable pending message at a trusted native scheduling opportunity.
 * @module activity-opportunity
 */
import { createHash } from "node:crypto";
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { createLifeService } from "@heptalogos/subject";
import { captureActivityOpportunity } from "@heptalogos/subject";
import type { MessagingService } from "@heptalogos/messaging";
import { activityDispatchResultSchema } from "./activity-dispatch-contracts.js";
import type { createActivityDispatcher } from "./activity-dispatch.js";
import type { GatewayScope } from "./gateway-contracts.js";
/** The Channel supplies only its actual account and conversation, never grants or prompts. */
export const activityOpportunityInputSchema = Type.Object(
  {
    accountId: Type.String(),
    conversation: Type.Object(
      {
        kind: Type.Union([Type.Literal("group"), Type.Literal("direct")]),
        id: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
/** A quiet opportunity preserves pending facts; a selected one reports the existing durable dispatch identity. */
export const activityOpportunityResultSchema = Type.Object(
  {
    decision: Type.Union([
      Type.Literal("defer"),
      Type.Literal("rest"),
      Type.Literal("dispatched"),
    ]),
    dispatch: Type.Optional(activityDispatchResultSchema),
  },
  { additionalProperties: false },
);
function requestIdentity(parts: readonly unknown[]): string {
  const hash = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
/** One actual native opportunity; Host owns no timer, model loop or network retry worker. */
export function createActivityOpportunity(options: {
  readonly scope: () => Promise<GatewayScope>;
  readonly enabled: () => Promise<boolean>;
  readonly life: Pick<
    ReturnType<typeof createLifeService>,
    "schedule" | "takeAttention" | "worldNow"
  >;
  readonly messaging: Pick<
    MessagingService,
    | "resolveConversations"
    | "listPending"
    | "prepareRead"
    | "completePending"
    | "messageSources"
  >;
  readonly activities: ReturnType<typeof createActivityDispatcher>;
}) {
  return async (
    input: Static<typeof activityOpportunityInputSchema>,
  ): Promise<Static<typeof activityOpportunityResultSchema>> => {
    const current = await options.scope();
    const grant = current.conversations.find(
      (c) =>
        c.kind === input.conversation.kind &&
        c.conversationId === input.conversation.id,
    );
    if (
      current.accountId !== input.accountId ||
      !grant?.receive ||
      !grant.observe ||
      !(await options.enabled())
    )
      return { decision: "defer" };
    const canonical = await options.messaging.resolveConversations({
      conversations: [
        {
          platform: "qq",
          accountId: current.accountId,
          kind: grant.kind,
          conversationId: grant.conversationId,
        },
      ],
    });
    const conversationId = canonical.conversationIds[0];
    if (!conversationId) return { decision: "defer" };
    const target = "conversation:heptalogos:" + conversationId;
    const schedule = await options.life.schedule({
      subjectId: current.subjectId,
      states: ["active"],
      limit: 128,
    });
    if (schedule.activities.some((a) => a.mode === "rest")) return { decision: "rest" };
    const activity = schedule.activities.find(
      (a) =>
        !a.continuationRequired &&
        a.adoptedBy &&
        a.workContextId &&
        a.scope?.conversations.some(
          (c) => c.conversationRef === target && c.operations.includes("observe"),
        ),
    );
    if (!activity) return { decision: "defer" };
    const pending = await options.messaging.listPending({ conversationId, limit: 128 });
    const next = pending.pending.find((p) => p.kind === "message");
    if (!next) {
      const world = await options.life.worldNow(current.subjectId);
      const due = schedule.activities.find(
        (a) =>
          a.scope?.conversations.some(
            (c) => c.conversationRef === target && c.operations.includes("observe"),
          ) && captureActivityOpportunity(a, world),
      );
      if (!due) return { decision: "defer" };
      const requestId = requestIdentity([
        "activity-continuation-v1",
        due.activityId,
        due.revision,
        due.nextOpportunity,
      ]);
      const dispatch = await options.activities.dispatch({
        requestId,
        subjectId: current.subjectId,
        activityId: due.activityId,
        conversationRef: target,
        messageRefs: [],
      });
      return { decision: "dispatched", dispatch };
    }
    const sources = await options.messaging.messageSources({
      messageRefs: [next.factId],
      conversationIds: [conversationId],
    });
    if (sources.sources[0]?.lifecycle === "retracted") {
      await options.messaging.completePending({ pendingRefs: [next.pendingRef] });
      return { decision: "defer" };
    }
    const read = await options.messaging.prepareRead({
      messageRefs: [next.factId],
      audience: { subjectId: current.subjectId, conversationIds: [conversationId] },
      budget: { maxMessages: 1, maxBytes: 1024 * 1024 },
    });
    const material = read.materials[0];
    if (!material || material.withheld || material.lifecycle !== "present")
      return { decision: "defer" };
    if (material.direction !== "INBOUND") {
      await options.messaging.completePending({ pendingRefs: [next.pendingRef] });
      return { decision: "defer" };
    }
    const attention = await options.life.takeAttention({
      subjectId: current.subjectId,
      activityId: activity.activityId,
      resting: false,
      naturalOpportunity: true,
      maxItems: 1,
      maxWaitMs: 60000,
      candidates: [
        {
          messageRef: material.messageId,
          conversationRef: target,
          receivedAt: material.receivedAt,
          direct: grant.kind === "direct",
          mention: material.parts.some((p) => p.kind === "at"),
          reply: material.parts.some((p) => p.kind === "reply"),
        },
      ],
    });
    if (attention.decision !== "read") return { decision: "defer" };
    const requestId = requestIdentity([
      "activity-opportunity-v1",
      next.pendingRef,
      target,
      next.factId,
    ]);
    const dispatch = await options.activities.dispatch({
      requestId,
      subjectId: current.subjectId,
      activityId: activity.activityId,
      conversationRef: target,
      messageRefs: attention.messageRefs,
    });
    // Native input/dispatch now owns reconciliation, including uncertain outcomes; never resubmit it as a new pending message.
    await options.messaging.completePending({ pendingRefs: [next.pendingRef] });
    return { decision: "dispatched", dispatch };
  };
}
