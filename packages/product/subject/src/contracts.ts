// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product Activity and behavior contracts, independent of the native agent loop.
 * @module contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceService } from "@heptalogos/persistence";

const object = { additionalProperties: false } as const;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
const id = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});
const instant = Type.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$",
});
const refs = Type.Array(ref, { maxItems: 128, uniqueItems: true });
const optionalRef = Type.Union([ref, Type.Null()]);

/** One explicit audience and the external effects adopted for it. */
export const conversationScopeSchema = Type.Object(
  {
    conversationRef: ref,
    operations: Type.Array(
      Type.Union([
        Type.Literal("observe"),
        Type.Literal("send"),
        Type.Literal("edit"),
        Type.Literal("withdraw"),
        Type.Literal("moderate"),
      ]),
      { maxItems: 5, uniqueItems: true },
    ),
  },
  object,
);
/** Adopted scope is a subset of the trusted installation and parent Activity grants. */
export const activityScopeSchema = Type.Object(
  {
    conversations: Type.Array(conversationScopeSchema, { maxItems: 128 }),
    tools: refs,
    sourceRefs: refs,
    maxRunMs: Type.Integer({ minimum: 1000, maximum: 3_600_000 }),
  },
  object,
);
/** Product scope never authorizes access by itself; Host adoption validates actual grants. */
export type ActivityScope = Static<typeof activityScopeSchema>;
/** One point in the Subject's declared world, distinct from real recorded time. */
export const worldPointSchema = Type.Object(
  { timeDomainRef: ref, at: instant },
  object,
);
/** State and useful continuation facts for one long-lived Product Activity. */
export const activitySchema = Type.Object(
  {
    activityId: id,
    subjectId: id,
    revision: Type.Integer({ minimum: 1 }),
    purpose: Type.String({ minLength: 1, maxLength: 4096 }),
    mode: Type.Union([
      Type.Literal("work"),
      Type.Literal("rest"),
      Type.Literal("wait"),
    ]),
    window: Type.Object(
      {
        notBefore: Type.Union([worldPointSchema, Type.Null()]),
        notAfter: Type.Union([worldPointSchema, Type.Null()]),
      },
      object,
    ),
    sourceRefs: refs,
    workContextId: Type.Union([id, Type.Null()]),
    state: Type.Union([
      Type.Literal("planned"),
      Type.Literal("active"),
      Type.Literal("paused"),
      Type.Literal("completed"),
      Type.Literal("cancelled"),
      Type.Literal("failed"),
    ]),
    proposedBy: ref,
    adoptedBy: optionalRef,
    adoptedAt: Type.Union([instant, Type.Null()]),
    lastTransitionReason: Type.String({ maxLength: 4096 }),
    scope: Type.Union([activityScopeSchema, Type.Null()]),
    world: worldPointSchema,
    nextOpportunity: Type.Union([worldPointSchema, Type.Null()]),
    progress: Type.Object(
      {
        note: Type.String({ maxLength: 8192 }),
        sourceRefs: refs,
        artifactRefs: refs,
        resultRefs: refs,
      },
      object,
    ),
    interruptOn: Type.Array(
      Type.Union([
        Type.Literal("direct"),
        Type.Literal("mention"),
        Type.Literal("reply"),
        Type.Literal("deadline"),
        Type.Literal("correction"),
        Type.Literal("manual"),
      ]),
      { maxItems: 6, uniqueItems: true },
    ),
    continuationRequired: Type.Boolean(),
    createdAt: instant,
    updatedAt: instant,
  },
  object,
);
/** Canonical Activity projection. */
export type LifeActivity = Static<typeof activitySchema>;
/** An unadopted proposal, including idempotent creation identity. */
export const proposeActivitySchema = Type.Object(
  {
    operationId: id,
    subjectId: id,
    purpose: activitySchema.properties.purpose,
    mode: activitySchema.properties.mode,
    window: activitySchema.properties.window,
    proposedBy: ref,
    sourceRefs: refs,
    workContextId: Type.Union([id, Type.Null()]),
    world: worldPointSchema,
    nextOpportunity: Type.Union([worldPointSchema, Type.Null()]),
    interruptOn: activitySchema.properties.interruptOn,
  },
  object,
);
/** Explicit proposal input used by both API generation and the owning operation. */
export type ProposeActivity = Static<typeof proposeActivitySchema>;
/** CAS adoption after the Host has resolved the actual actor and permission scope. */
export const adoptActivitySchema = Type.Object(
  {
    subjectId: id,
    activityId: id,
    expectedRevision: Type.Integer({ minimum: 1 }),
    adoptedBy: ref,
    scope: activityScopeSchema,
  },
  object,
);
/** One lifecycle operation, without fictional execution recovery. */
export const transitionActivitySchema = Type.Object(
  {
    subjectId: id,
    activityId: id,
    expectedRevision: Type.Integer({ minimum: 1 }),
    action: Type.Union([
      Type.Literal("start"),
      Type.Literal("pause"),
      Type.Literal("resume"),
      Type.Literal("finish"),
      Type.Literal("cancel"),
      Type.Literal("fail"),
    ]),
    reason: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  object,
);
/** Trusted tool/host results update useful progress; model claims alone do not prove a result. */
export const progressActivitySchema = Type.Object(
  {
    subjectId: id,
    activityId: id,
    expectedRevision: Type.Integer({ minimum: 1 }),
    progress: activitySchema.properties.progress,
    nextOpportunity: Type.Union([worldPointSchema, Type.Null()]),
  },
  object,
);
/** Bounded schedule query; a different time domain is explicitly not comparable. */
export const scheduleQuerySchema = Type.Object(
  {
    subjectId: id,
    afterId: Type.Optional(id),
    limit: Type.Integer({ minimum: 1, maximum: 128 }),
    states: Type.Array(activitySchema.properties.state, {
      maxItems: 6,
      uniqueItems: true,
    }),
  },
  object,
);
/** Metadata supplied by Messaging before any actual reading or model invocation. */
export const attentionCandidateSchema = Type.Object(
  {
    messageRef: ref,
    conversationRef: ref,
    receivedAt: instant,
    direct: Type.Boolean(),
    mention: Type.Boolean(),
    reply: Type.Boolean(),
  },
  object,
);
/** Fair bounded attention selection at a real natural opportunity. */
export const takeAttentionSchema = Type.Object(
  {
    subjectId: id,
    activityId: Type.Union([id, Type.Null()]),
    resting: Type.Boolean(),
    naturalOpportunity: Type.Boolean(),
    candidates: Type.Array(attentionCandidateSchema, { maxItems: 128 }),
    maxItems: Type.Integer({ minimum: 1, maximum: 64 }),
    maxWaitMs: Type.Integer({ minimum: 1000, maximum: 86_400_000 }),
  },
  object,
);
/** Actual read selection does not itself record a Nous Observation. */
export const attentionResultSchema = Type.Object(
  {
    decision: Type.Union([
      Type.Literal("read"),
      Type.Literal("defer"),
      Type.Literal("continue"),
      Type.Literal("rest"),
    ]),
    messageRefs: refs,
    reason: ref,
  },
  object,
);
/** Product Life composes on the existing Host-fenced transaction owner. */
export interface LifeOptions {
  readonly persistence: PersistenceService;
  readonly now: () => string;
  readonly worldNow: (subjectId: string) => Promise<Static<typeof worldPointSchema>>;
  readonly scopeAuthority: (
    subjectId: string,
    actorRef: string,
    requested: ActivityScope,
  ) => Promise<ActivityScope>;
}

/** Exact lookup for one same-Subject Activity; no inferred identifier or CAS. */
export const readActivitySchema = Type.Object(
  { subjectId: id, activityId: id },
  object,
);
