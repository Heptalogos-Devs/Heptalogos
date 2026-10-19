// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adopted expression, claim history and local narrative transaction contracts.
 * @module narrative-contracts
 */
import { decisionExpressionIntentSchema } from "./deliberation-contracts.js";
import { reactorActionProblemSchema } from "./reactor-contracts.js";
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { worldIntervalSchema, realizeWorldSchema } from "./world-contracts.js";
import { preparedDeliverySchema } from "./agency-contracts.js";
import { activitySchema, worldPointSchema } from "./contracts.js";
const object = { additionalProperties: false } as const;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
const id = activitySchema.properties.activityId;
const refs = Type.Array(ref, { maxItems: 128, uniqueItems: true });
const text = Type.String({ minLength: 1, maxLength: 16384 });
/** Audience comes from the adopted decision, never from the renderer. */
export const expressionAudienceSchema = Type.Object(
  {
    conversationRef: ref,
    channel: ref,
    accountId: ref,
    to: ref,
  },
  object,
);
/** World and undertaking semantics are adopted before their natural expression. */
export const narrativeIntentProposalSchema = Type.Object(
  {
    worldPatch: Type.Union([realizeWorldSchema, Type.Null()]),
    commitments: Type.Array(
      Type.Object({ purpose: text, due: worldPointSchema, sourceRefs: refs }, object),
      { maxItems: 32 },
    ),
    conflicts: Type.Array(text, { maxItems: 32 }),
  },
  object,
);
export type NarrativeIntentProposal = Static<typeof narrativeIntentProposalSchema>;
/** Current adoption of an immutable earlier renderer result. */
const expressionCandidateAdoptionSchema = Type.Object(
  {
    decisionRef: ref,
    sourceRunId: ref,
    activityRevision: Type.Integer({ minimum: 1 }),
    adoptedAt: worldPointSchema.properties.at,
  },
  object,
);
export const expressionCandidateSelectionSchema = Type.Object(
  { subjectId: id, briefId: id },
  object,
);
export const recoverExpressionCandidatesSchema = Type.Object(
  { subjectId: id, activityId: id },
  object,
);
export const expressionCandidateDeliverySchema = Type.Object(
  { reference: ref, prepared: preparedDeliverySchema },
  object,
);
/** Communication intent and the exact scope the candidate may elaborate. */
export const expressionBriefSchema = Type.Object(
  {
    briefId: id,
    decisionRef: ref,
    subjectId: id,
    activityId: id,
    expectedActivityRevision: Type.Integer({ minimum: 1 }),
    actorEntityRef: ref,
    audience: expressionAudienceSchema,
    semanticRequirement: decisionExpressionIntentSchema.properties.semanticRequirement,
    semanticPreparation: Type.Optional(
      Type.Object(
        { reviewerRunId: ref, proposal: narrativeIntentProposalSchema },
        object,
      ),
    ),
    retainedCandidate: Type.Optional(
      Type.Object(
        {
          prepared: preparedDeliverySchema,
          recordedAt: worldPointSchema.properties.at,
          recoveredFrom: Type.Optional(ref),
          discardedBy: Type.Optional(ref),
          adoptions: Type.Array(expressionCandidateAdoptionSchema, { maxItems: 128 }),
        },
        object,
      ),
    ),
    intent: text,
    stance: text,
    sourceRefs: refs,
    cognitionRefs: refs,
    eventRefs: refs,
    priorClaimRefs: refs,
    epistemicView: Type.Record(Type.String(), Type.Unknown()),
    qualifications: Type.Array(text, { maxItems: 64 }),
    deception: Type.Union([
      Type.Literal("none"),
      Type.Literal("conceal"),
      Type.Literal("fabricate"),
    ]),
    worldDetailScope: Type.Union([
      Type.Null(),
      Type.Object(
        {
          worldId: id,
          interval: worldIntervalSchema,
          actorRefs: refs,
          placeRefs: refs,
          description: text,
        },
        object,
      ),
    ]),
    createdAt: worldPointSchema.properties.at,
    validUntil: worldPointSchema.properties.at,
  },
  object,
);
/** Brief storage asserts neither generated claims nor delivery. */
export type ExpressionBrief = Static<typeof expressionBriefSchema>;
/** Important statements reference the exact final native payload using UTF-16 offsets. */
export const narrativeClaimSchema = Type.Object(
  {
    sourceIndex: Type.Integer({ minimum: 0, maximum: 65535 }),
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 1 }),
    quote: text,
    content: text,
    entityRefs: refs,
    kind: Type.Union([
      Type.Literal("life"),
      Type.Literal("identity"),
      Type.Literal("knowledge"),
      Type.Literal("relationship"),
      Type.Literal("commitment"),
      Type.Literal("external_result"),
    ]),
    stance: Type.Union([
      Type.Literal("asserted"),
      Type.Literal("uncertain"),
      Type.Literal("conditional"),
      Type.Literal("reported"),
      Type.Literal("deliberate"),
    ]),
    polarity: Type.Union([Type.Literal("affirm"), Type.Literal("deny")]),
    about: Type.Union([worldIntervalSchema, Type.Null()]),
    basis: Type.Union([
      Type.Literal("world"),
      Type.Literal("cognition"),
      Type.Literal("new_virtual_detail"),
      Type.Literal("commitment"),
      Type.Literal("deliberate"),
      Type.Literal("uncertain"),
      Type.Literal("report"),
    ]),
    sourceRefs: refs,
    eventRefs: refs,
    cognitionRefs: refs,
    priorClaimRefs: refs,
  },
  object,
);
/** A future undertaking has an actual next opportunity, unlike a mere wish. */
export const narrativeCommitmentSchema = Type.Object(
  {
    claimIndex: Type.Integer({ minimum: 0, maximum: 127 }),
    purpose: text,
    due: worldPointSchema,
    sourceRefs: refs,
  },
  object,
);
/** One narrow readback; structural and source constraints remain owner checks. */
export const narrativeReviewSchema = Type.Object(
  {
    claims: Type.Array(narrativeClaimSchema, { maxItems: 128 }),
    conflicts: Type.Array(text, { maxItems: 32 }),
    commitments: Type.Array(narrativeCommitmentSchema, { maxItems: 32 }),
    worldPatch: Type.Union([realizeWorldSchema, Type.Null()]),
  },
  object,
);
/** A review can reject a candidate; it never publishes or silently rewrites text. */
export type NarrativeReview = Static<typeof narrativeReviewSchema>;
/** Review quotes actual text; the owner derives canonical UTF-16 positions. */
export const narrativeReviewProposalSchema = Type.Object(
  {
    ...narrativeReviewSchema.properties,
    claims: Type.Array(Type.Omit(narrativeClaimSchema, ["start", "end"]), {
      maxItems: 128,
    }),
  },
  object,
);
/** Model review before the owner binds exact final text positions. */
export type NarrativeReviewProposal = Static<typeof narrativeReviewProposalSchema>;
/** Final payload, brief and the actual role that read back the text. */
export const narrativeCommitSchema = Type.Object(
  {
    operationId: id,
    briefId: id,
    reviewerRunId: Type.Union([ref, Type.Null()]),
    prepared: preparedDeliverySchema,
    review: narrativeReviewSchema,
  },
  object,
);
/** Canonical local adoption, separate from platform outcome. */
export type NarrativeCommitInput = Static<typeof narrativeCommitSchema>;
/** Bounded audience history; the calling Authority checks visibility. */
export const claimsToSchema = Type.Object(
  {
    subjectId: id,
    conversationRef: ref,
    about: Type.Optional(worldIntervalSchema),
    status: Type.Optional(
      Type.Union([
        Type.Literal("adopted"),
        Type.Literal("expressed"),
        Type.Literal("uncertain"),
        Type.Literal("not_sent"),
      ]),
    ),
    order: Type.Optional(Type.Union([Type.Literal("oldest"), Type.Literal("newest")])),
    afterClaimId: Type.Optional(id),
    relatedRefs: Type.Optional(refs),
    limit: Type.Integer({ minimum: 1, maximum: 128 }),
  },
  object,
);
/** Exact statement with status derived from the single sender's receipts. */
export interface AdoptedClaim extends Static<typeof narrativeClaimSchema> {
  readonly claimId: string;
  readonly briefId: string;
  readonly behaviorRef: string;
  readonly conversationRef: string;
  readonly recordedAt: string;
  readonly status: "adopted" | "expressed" | "uncertain" | "not_sent";
  readonly platformMessageIds: readonly string[];
}

/** Exact owner rejection is a result of one rendered candidate, not a rewritten brief. */
export const narrativeRejectionSchema = Type.Object(
  {
    subjectId: id,
    activityId: id,
    rendererRunId: ref,
    reviewerRunId: ref,
    preparedDigest: ref,
    recordedAt: activitySchema.properties.createdAt,
    problem: reactorActionProblemSchema,
  },
  object,
);
/** Durable evidence that this candidate did not reach Narrative/Agency commit. */
export type NarrativeRejection = Static<typeof narrativeRejectionSchema>;
