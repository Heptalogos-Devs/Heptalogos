// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adopted expression, claim history and local narrative transaction contracts.
 * @module narrative-contracts
 */
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
/** Final payload, brief and the actual role that read back the text. */
export const narrativeCommitSchema = Type.Object(
  {
    operationId: id,
    briefId: id,
    reviewerRunId: ref,
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
