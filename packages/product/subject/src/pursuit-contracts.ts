// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Product adoption and result references for a long-lived Pursuit; Nous owns all conditions and evaluation.
 * @module pursuit-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceService } from "@heptalogos/persistence";
import type { createLifeService } from "./life.js";
const object = { additionalProperties: false } as const;
const uuid = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});
const text = Type.String({ minLength: 1, maxLength: 4096 });
/** Exact external reference, without a second writable cognition representation. */
export const pursuitReferenceSchema = Type.Object(
  { kind: Type.String({ minLength: 1, maxLength: 128 }), value: text },
  object,
);
/** Only the official evaluator may establish this saved Product projection. */
export const pursuitEvaluationSchema = Type.Object(
  {
    evaluationId: uuid,
    conditionRevision: pursuitReferenceSchema,
    verdict: Type.Union([
      Type.Literal("satisfied"),
      Type.Literal("violated"),
      Type.Literal("unknown"),
    ]),
    finalConclusion: Type.Boolean(),
    coverage: Type.Union([
      Type.Literal("complete"),
      Type.Literal("limited"),
      Type.Literal("gap"),
    ]),
    applicable: Type.Union([Type.Boolean(), Type.Null()]),
    timeDomainRef: text,
    evaluatedInterval: Type.Object(
      {
        kind: Type.Union([
          Type.Literal("instant"),
          Type.Literal("interval"),
          Type.Literal("unknown"),
        ]),
        from: Type.Union([Type.String(), Type.Null()]),
        until: Type.Union([Type.String(), Type.Null()]),
      },
      object,
    ),
    evidenceRefs: Type.Array(pursuitReferenceSchema, { maxItems: 512 }),
    recordedAt: Type.String({
      pattern:
        "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$",
    }),
  },
  object,
);
/** Durable behavior-side identity and exact adopted condition revision. */
export const pursuitSchema = Type.Object(
  {
    pursuitId: uuid,
    subjectId: uuid,
    activityId: uuid,
    workContextId: uuid,
    revision: Type.Integer({ minimum: 1 }),
    desireRevision: pursuitReferenceSchema,
    conditionRevision: pursuitReferenceSchema,
    desireEpoch: Type.String({ pattern: "^[0-9]+$" }),
    conditionEpoch: Type.String({ pattern: "^[0-9]+$" }),
    adoptedBy: text,
    reason: text,
    state: Type.Union([
      Type.Literal("active"),
      Type.Literal("paused"),
      Type.Literal("ended"),
    ]),
    reviewRequired: Type.Boolean(),
    reviewReason: Type.String({ maxLength: 4096 }),
    timeDomainRef: text,
    lastEvaluation: Type.Union([pursuitEvaluationSchema, Type.Null()]),
    createdAt: Type.String({
      pattern:
        "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$",
    }),
    updatedAt: Type.String({
      pattern:
        "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,9})?Z$",
    }),
  },
  object,
);
/** Explicit operator/service adoption associates an existing adopted Activity and open WorkContext. */
export const adoptPursuitSchema = Type.Object(
  {
    operationId: uuid,
    subjectId: uuid,
    activityId: uuid,
    desireRevision: Type.Object(
      { kind: Type.Literal("desire_revision"), value: text },
      object,
    ),
    conditionRevision: Type.Object(
      { kind: Type.Literal("desired_condition_revision"), value: text },
      object,
    ),
    adoptedBy: text,
    reason: text,
  },
  object,
);
/** Bounded identity lookup shared by the service API and its owner. */
export const readPursuitSchema = Type.Object(
  { subjectId: uuid, pursuitId: uuid },
  object,
);
/** Explicit continuation or termination never rewrites the adopted cognition revision. */
export const transitionPursuitSchema = Type.Object(
  {
    ...readPursuitSchema.properties,
    expectedRevision: Type.Integer({ minimum: 1 }),
    action: Type.Union([
      Type.Literal("pause"),
      Type.Literal("resume"),
      Type.Literal("end"),
    ]),
    reason: text,
  },
  object,
);
/** Explicit revision review keeps the old adoption/evaluation history and leaves actual execution paused. */
export const reconsiderPursuitSchema = Type.Object(
  {
    ...readPursuitSchema.properties,
    expectedRevision: Type.Integer({ minimum: 1 }),
    desireRevision: adoptPursuitSchema.properties.desireRevision,
    conditionRevision: adoptPursuitSchema.properties.conditionRevision,
    reason: text,
  },
  object,
);
/** Actual immutable evidence references are resolved by the existing Nous evaluator and SourceRead owner. */
export const evaluatePursuitSchema = Type.Object(
  {
    ...readPursuitSchema.properties,
    operationId: uuid,
    expectedRevision: Type.Integer({ minimum: 1 }),
    evidenceRefs: Type.Array(pursuitReferenceSchema, { maxItems: 256 }),
  },
  object,
);
/** Product Pursuit projection. */
export type Pursuit = Static<typeof pursuitSchema>;
/** Official condition evaluation projection, never a caller-supplied truth. */
export type PursuitEvaluation = Static<typeof pursuitEvaluationSchema>;
/** Exact external reference used by the adoption and result relationship. */
export type PursuitReference = Static<typeof pursuitReferenceSchema>;
/** The actual public Motivation adapter supplies only currentness and evaluator results. */
export interface PursuitMotivation {
  /** Checks both exact adopted revisions, lifecycle availability and condition world. */
  inspect(
    input: Pick<Pursuit, "subjectId" | "desireRevision" | "conditionRevision">,
  ): Promise<{
    current: boolean;
    desireEpoch: string;
    conditionEpoch: string;
    reason: string;
    timeDomainRef: string;
  }>;
  /** Uses the official evaluator with the current Activity's explicit source authority. */
  evaluate(input: {
    pursuit: Pursuit;
    activity: Awaited<ReturnType<ReturnType<typeof createLifeService>["get"]>> & {};
    operationId: string;
    evidenceRefs: PursuitReference[];
  }): Promise<PursuitEvaluation>;
  /** Reads the actual same-Subject WorkContext; it must be open, not an Activity state. */
  workContextOpen(subjectId: string, workContextId: string): Promise<boolean>;
}
/** Persistence stays Host-fenced; mutations require the existing current execution Activity. */
export interface PursuitServiceOptions {
  readonly persistence: PersistenceService;
  readonly life: Pick<ReturnType<typeof createLifeService>, "get" | "transition">;
  readonly motivation: PursuitMotivation;
  readonly now: () => string;
  /** Resolves the current trusted Subject actor and Activity authority before any adoption/use. */
  readonly authorize: (
    activity: NonNullable<
      Awaited<ReturnType<ReturnType<typeof createLifeService>["get"]>>
    >,
    actor: string,
  ) => Promise<void>;
}

/** Bounded Product listing; source cognition remains outside this projection. */
export const listPursuitsSchema = Type.Object(
  {
    subjectId: uuid,
    afterId: Type.Optional(uuid),
    limit: Type.Integer({ minimum: 1, maximum: 128 }),
    states: Type.Array(pursuitSchema.properties.state, {
      maxItems: 3,
      uniqueItems: true,
    }),
  },
  object,
);
/** Immutable adoption/review history for one exact same-Subject Pursuit. */
export const pursuitHistorySchema = Type.Object(
  {
    ...readPursuitSchema.properties,
    afterRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Integer({ minimum: 1, maximum: 128 }),
  },
  object,
);
/** Paginated current Pursuit results. */
export const listPursuitsResultSchema = Type.Object(
  { pursuits: Type.Array(pursuitSchema), nextId: Type.Union([uuid, Type.Null()]) },
  object,
);
/** Paginated immutable Product history; evaluating never rewrites these facts. */
export const pursuitHistoryResultSchema = Type.Object(
  {
    history: Type.Array(pursuitSchema),
    nextRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  object,
);
