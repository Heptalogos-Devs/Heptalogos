// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** One Subject's bounded foreground qualification and actual interaction actions.
 * @module reactor-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { reactorPolicySchema as effectivePolicySchema } from "@heptalogos/management";
import type { PersistenceService } from "@heptalogos/persistence";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import { activitySchema } from "./contracts.js";
import type { createLifeService } from "./life.js";
import type { createSubjectAttentionService } from "./attention.js";
import { subjectAttentionCandidateSchema } from "./attention-contracts.js";
const object = { additionalProperties: false } as const;
const id = activitySchema.properties.activityId;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
/** This is an internal Host capability; a model cannot grant or refresh it. */
export const foregroundQualificationSchema = Type.Object(
  {
    reactionId: id,
    focusRevision: Type.Integer({ minimum: 1 }),
  },
  object,
);
/** Exact current Reaction and Subject focus generation. */
export type ForegroundQualification = Static<typeof foregroundQualificationSchema>;
/** All foreground limits are consumed from the one effective Product reactor policy. */
export const reactorLimitsSchema = Type.Pick(effectivePolicySchema, [
  "maxInteractionSteps",
  "reactionDeadlineMs",
  "workerConcurrency",
]);
/** The consumed subset of the single effective Product policy. */
export type ReactorLimits = Static<typeof reactorLimitsSchema>;
/** Shared finite vocabulary for SituationFrame affordances and actual Subject choices. */
export const interactionActionKindSchema = Type.Union([
  Type.Literal("inspect"),
  Type.Literal("open"),
  Type.Literal("read"),
  Type.Literal("search"),
  Type.Literal("move"),
  Type.Literal("participate"),
  Type.Literal("communicate"),
  Type.Literal("discard"),
  Type.Literal("continue"),
  Type.Literal("wait"),
  Type.Literal("rest"),
  Type.Literal("adjust_plan"),
]);
/** A target is one current frame handle or listed public sourceRef; neither grants authority. */
export const interactionActionSchema = Type.Object(
  {
    action: interactionActionKindSchema,
    target: Type.Optional(ref),
  },
  object,
);
/** The one canonical action projection; deliberation adds reason and explicit adopted intent. */
export type InteractionAction = Static<typeof interactionActionSchema>;
/** Durable foreground state contains owner references, never unread source bodies or model history. */
export const subjectReactionSchema = Type.Object(
  {
    subjectId: id,
    activityId: id,
    ...foregroundQualificationSchema.properties,
    candidate: subjectAttentionCandidateSchema,
    explanationRef: ref,
    startedAt: activitySchema.properties.createdAt,
    deadlineAt: activitySchema.properties.createdAt,
    policy: reactorLimitsSchema,
    state: Type.Union([
      Type.Literal("active"),
      Type.Literal("yielded"),
      Type.Literal("superseded"),
      Type.Literal("completed"),
    ]),
    stepCount: Type.Integer({ minimum: 0 }),
    currentRunId: Type.Optional(ref),
    continuationRef: Type.Optional(ref),
    stopReason: Type.Optional(ref),
  },
  object,
);
/** A foreground run can be retained after losing adoption qualification. */
export type SubjectReaction = Static<typeof subjectReactionSchema>;
/** Bounded pre-effect rejection metadata; these references confer no authority or new observation. */
export const reactorActionProblemSchema = Type.Object(
  {
    code: Type.String({ minLength: 1, maxLength: 128 }),
    detail: Type.String({ minLength: 1, maxLength: 512 }),
    availableSourceRefs: Type.Optional(
      Type.Array(ref, { maxItems: 16, uniqueItems: true }),
    ),
    availableCognitionRefs: Type.Optional(
      Type.Array(ref, { maxItems: 16, uniqueItems: true }),
    ),
  },
  object,
);
/** Only actual owner status is saved; ready task outputs are not marked viewed. */
export const reactorActionReceiptSchema = Type.Object(
  {
    actionId: id,
    reactionId: id,
    step: Type.Integer({ minimum: 1 }),
    action: interactionActionSchema,
    state: Type.Union([
      Type.Literal("started"),
      Type.Literal("completed"),
      Type.Literal("pending"),
      Type.Literal("rejected"),
      Type.Literal("unavailable"),
    ]),
    resultRefs: Type.Array(ref, { maxItems: 128, uniqueItems: true }),
    recordedAt: activitySchema.properties.createdAt,
    problem: Type.Optional(reactorActionProblemSchema),
  },
  object,
);
/** Exact action receipt is used on reentry instead of repeating an uncertain effect. */
export type ReactorActionReceipt = Static<typeof reactorActionReceiptSchema>;
/** The existing short Host-fenced transaction and Attention selection remain their owners. */
export interface SubjectReactorOptions {
  readonly persistence: PersistenceService;
  readonly life: Pick<ReturnType<typeof createLifeService>, "get" | "progressIn">;
  readonly now: () => string;
  readonly policy: (
    transaction?: PersistenceInternalTransaction,
  ) => Promise<ReactorLimits>;
  readonly attention: Pick<
    ReturnType<typeof createSubjectAttentionService>,
    "recordConsidered" | "explain"
  >;
  readonly assertActivityIn: (
    tx: PersistenceInternalTransaction,
    subjectId: string,
    activityId: string,
  ) => Promise<void>;
}
