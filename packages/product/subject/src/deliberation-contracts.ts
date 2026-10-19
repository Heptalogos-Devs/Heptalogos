// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adopted Subject decisions are distinct from model proposals and actual task outcomes.
 * @module deliberation-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceService } from "@heptalogos/persistence";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import { changeCalendarSchema } from "./world-calendar-contracts.js";
import { interactionActionSchema } from "./reactor-contracts.js";
import { activitySchema, worldPointSchema } from "./contracts.js";
import type { createLifeService } from "./life.js";
const object = { additionalProperties: false } as const;
const id = activitySchema.properties.activityId;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
const refs = Type.Array(ref, { maxItems: 128, uniqueItems: true });
const summary = Type.String({ minLength: 1, maxLength: 4096 });
/** Explicitly adopted communication content does not grant an audience or permission. */
export const decisionExpressionIntentSchema = Type.Object(
  {
    semanticRequirement: Type.Optional(
      Type.Union([
        Type.Literal("important_conflict"),
        Type.Literal("world_fact"),
        Type.Literal("serious_commitment"),
      ]),
    ),
    intent: summary,
    stance: summary,
    qualifications: Type.Array(summary, { maxItems: 64 }),
    deception: Type.Union([
      Type.Literal("none"),
      Type.Literal("conceal"),
      Type.Literal("fabricate"),
    ]),
    eventRefs: refs,
    cognitionRefs: refs,
    priorClaimRefs: refs,
  },
  object,
);
/** One bounded subjective choice; accompanying expression is explicit and never inferred from its action. */
export const deliberationDecisionSchema = Type.Object(
  {
    ...interactionActionSchema.properties,
    reason: Type.Optional(summary),
    calendarChange: Type.Optional(Type.Pick(changeCalendarSchema, ["scope", "change"])),
    nextOpportunity: Type.Optional(Type.Union([worldPointSchema, Type.Null()])),
    expressionIntent: Type.Optional(decisionExpressionIntentSchema),
    delegation: Type.Optional(
      Type.Object({ goal: summary, sourceRefs: refs, tools: refs }, object),
    ),
    newActivity: Type.Optional(
      Type.Object({ purpose: summary, mode: activitySchema.properties.mode }, object),
    ),
  },
  object,
);
/** One structured subjective proposal before owner adoption. */
export type DeliberationDecision = Static<typeof deliberationDecisionSchema>;

/** Actual Host producer identity accompanies a model decision and is never supplied by the model itself. */
export const adoptDeliberationSchema = Type.Object(
  {
    operationId: id,
    subjectId: id,
    activityId: id,
    sourceRunId: ref,
    expectedActivityRevision: Type.Integer({ minimum: 1 }),
    decision: deliberationDecisionSchema,
  },
  object,
);
/** Request to adopt one actual Subject deliberation. */
export type AdoptDeliberation = Static<typeof adoptDeliberationSchema>;
/** Immutable adopted choice, including exact source and actual resulting Activity revision. */
export const decisionCommitSchema = Type.Object(
  {
    decisionId: id,
    decisionRef: ref,
    operationId: id,
    subjectId: id,
    activityId: id,
    sourceRunId: ref,
    previousActivityRevision: Type.Integer({ minimum: 1 }),
    activityRevision: Type.Integer({ minimum: 1 }),
    decision: deliberationDecisionSchema,
    sourceRefs: refs,
    tools: refs,
    mode: activitySchema.properties.mode,
    nextOpportunity: Type.Union([worldPointSchema, Type.Null()]),
    adoptedAt: worldPointSchema.properties.at,
  },
  object,
);
/** Canonical DecisionCommit; it proves adoption rather than delivery, perception or task completion. */
export type DecisionCommit = Static<typeof decisionCommitSchema>;
/** Captured actual run scope, distinct from proposal fields. */
export interface DeliberationRunAuthority {
  readonly sourceRefs: readonly string[];
  readonly tools: readonly string[];
}
/** All provider/clock reads occur outside the short adoption transaction. */
export interface DeliberationOptions {
  readonly persistence: PersistenceService;
  readonly life: Pick<ReturnType<typeof createLifeService>, "progressIn">;
  readonly now: () => string;
  readonly worldNow: (subjectId: string) => Promise<Static<typeof worldPointSchema>>;
  /** Validates actual subject.deliberation role, provider admission and referenced inputs; no model field grants scope. */
  readonly validateSourceRun: (
    input: AdoptDeliberation,
  ) => Promise<DeliberationRunAuthority>;
  /** Rechecks actual run and current authority using this same transaction, without provider/network I/O. */
  readonly assertSourceRunIn: (
    tx: PersistenceInternalTransaction,
    input: AdoptDeliberation,
    authority: DeliberationRunAuthority,
  ) => Promise<void>;
}
