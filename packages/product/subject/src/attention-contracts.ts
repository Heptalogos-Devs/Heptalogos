// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bounded metadata choices for one Subject, before any message body is read.
 * @module attention-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceService } from "@heptalogos/persistence";
import { reactorPolicySchema } from "@heptalogos/management";
import { activitySchema } from "./contracts.js";
const object = { additionalProperties: false } as const;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
const id = activitySchema.properties.activityId;
const instant = activitySchema.properties.createdAt;
/** Priority is an explainable category, not a model score or a permission. */
export const attentionPrioritySchema = Type.Union([
  Type.Literal("important"),
  Type.Literal("direct"),
  Type.Literal("background"),
]);
/** Owner references and real notification metadata never include unread content. */
export const subjectAttentionCandidateSchema = Type.Object(
  {
    subjectId: id,
    candidateRef: ref,
    sourceOwner: Type.Union([
      Type.Literal("messaging"),
      Type.Literal("world"),
      Type.Literal("life"),
      Type.Literal("role_result"),
      Type.Literal("cognition"),
    ]),
    sourceKey: ref,
    sourceRef: ref,
    sourceRevision: ref,
    sourcePosition: Type.Optional(ref),
    kind: Type.Union([
      Type.Literal("message"),
      Type.Literal("world_event"),
      Type.Literal("world_entry"),
      Type.Literal("schedule"),
      Type.Literal("activity_result"),
      Type.Literal("cognition_change"),
      Type.Literal("explicit_subject_intent"),
    ]),
    activityId: Type.Optional(id),
    worldId: Type.Optional(id),
    priorityClass: attentionPrioritySchema,
    availableAt: instant,
    related: Type.Boolean(),
    metadata: Type.Object(
      {
        label: Type.String({ maxLength: 1024 }),
        conversationRef: Type.Optional(ref),
        messageRefs: Type.Optional(Type.Array(id, { maxItems: 64, uniqueItems: true })),
        unreadCount: Type.Optional(Type.Integer({ minimum: 0 })),
        direct: Type.Optional(Type.Boolean()),
        mention: Type.Optional(Type.Boolean()),
        reply: Type.Optional(Type.Boolean()),
      },
      object,
    ),
  },
  object,
);
/** A globally eligible source item; metadata is not an Observation. */
export type SubjectAttentionCandidate = Static<typeof subjectAttentionCandidateSchema>;
/** Reaction ownership remains in Reactor; Attention receives only its comparison view. */
export const attentionFocusSchema = Type.Object(
  {
    reactionId: id,
    activityId: id,
    focusRevision: Type.Integer({ minimum: 1 }),
    candidateRef: ref,
    priorityClass: attentionPrioritySchema,
  },
  object,
);
/** All source collection and ranking stays metadata-only. */
export const selectAttentionSchema = Type.Object(
  {
    subjectId: id,
    currentFocus: Type.Optional(attentionFocusSchema),
    manualActivityId: Type.Optional(id),
    naturalOpportunity: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 128 })),
  },
  object,
);
/** Actual policy fields consumed by collection, aggregation and reconsideration. */
export const subjectAttentionPolicySchema = Type.Pick(reactorPolicySchema, [
  "candidateLimit",
  "perSourceLimit",
  "messageBatchLimit",
  "coalesceMs",
  "reconsiderMs",
]);
/** Persisted source consideration advances fairness, never source read/completion state. */
export interface AttentionPosition {
  readonly sourceKey: string;
  readonly sourceRevision: string;
  readonly sourcePosition?: string;
  readonly consideredAt: string;
  readonly reactionId: string;
}
/** Source owners return their own bounded references; no generic content event store exists. */
export interface SubjectAttentionOptions {
  readonly persistence: PersistenceService;
  readonly now: () => string;
  readonly policy: () => Promise<Static<typeof subjectAttentionPolicySchema>>;
  readonly candidates: (input: {
    subjectId: string;
    perSourceLimit: number;
    messageBatchLimit: number;
    limit: number;
    positions: readonly AttentionPosition[];
    naturalOpportunity: boolean;
    manualActivityId?: string;
  }) => Promise<{ candidates: readonly SubjectAttentionCandidate[]; more: boolean }>;
}
/** Stored explanation contains references and policy reasons, never unread text. */
export const attentionExplanationSchema = Type.Object(
  {
    subjectId: id,
    state: Type.Union([
      Type.Literal("selected"),
      Type.Literal("switch_requested"),
      Type.Literal("focus_retained"),
      Type.Literal("coalescing"),
      Type.Literal("no_new_candidate"),
    ]),
    reason: ref,
    candidateRefs: Type.Array(ref, { maxItems: 128 }),
    candidates: Type.Array(subjectAttentionCandidateSchema, { maxItems: 128 }),
    limited: Type.Boolean(),
    policy: subjectAttentionPolicySchema,
    selected: Type.Optional(subjectAttentionCandidateSchema),
    switchRequested: Type.Optional(subjectAttentionCandidateSchema),
    nextConsiderAt: Type.Optional(instant),
  },
  object,
);
/** Stable read-model identity permits explaining the actual considered choice. */
export const attentionSelectionSchema = Type.Object(
  {
    ...attentionExplanationSchema.properties,
    explanationRef: ref,
  },
  object,
);
/** Exact chosen reference is advanced only after Reactor actually takes it. */
export const recordAttentionConsideredSchema = Type.Object(
  {
    subjectId: id,
    candidateRef: ref,
    explanationRef: ref,
    reactionId: id,
  },
  object,
);
