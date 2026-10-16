// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** The Host receives native context separately from the bounded model request.
 * @module native-life-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import {
  activitySchema,
  worldPointSchema,
  worldIntervalSchema,
} from "@heptalogos/subject";
const object = { additionalProperties: false } as const;
const text = Type.String({ minLength: 1, maxLength: 2048 });
/** Read arguments describe an already authorized owner's query, never a Subject, role or audience grant. */
export const nativeLifeReadActionSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal("lifeAt"),
      worldId: activitySchema.properties.activityId,
      interval: worldIntervalSchema,
      knowledgeCutoff: Type.Optional(worldPointSchema),
      afterEventId: Type.Optional(activitySchema.properties.activityId),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
    },
    object,
  ),
  Type.Object(
    {
      action: Type.Literal("claimsTo"),
      aboutInterval: Type.Optional(worldIntervalSchema),
      afterClaimId: Type.Optional(activitySchema.properties.activityId),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 64 })),
    },
    object,
  ),
  Type.Object({ action: Type.Literal("explainStatement"), messageRef: text }, object),
  Type.Object({ action: Type.Literal("epistemic") }, object),
]);
/** No Subject, source, artifact, permission or result identity comes from model arguments. */
export const nativeLifeActionSchema = Type.Union([
  Type.Object({ action: Type.Literal("inspect") }, object),
  Type.Object(
    {
      action: Type.Literal("progress"),
      note: Type.String({ minLength: 1, maxLength: 4000 }),
      expectedRevision: Type.Integer({ minimum: 1 }),
      nextOpportunity: Type.Union([worldPointSchema, Type.Null()]),
      mode: activitySchema.properties.mode,
    },
    object,
  ),
  nativeLifeReadActionSchema.anyOf[0],
  nativeLifeReadActionSchema.anyOf[1],
  nativeLifeReadActionSchema.anyOf[2],
  nativeLifeReadActionSchema.anyOf[3],
]);
/** Read results are derived uses of existing canonical sources, not fresh external testimony. */
export const nativeLifeReadResponseSchema = Type.Object(
  {
    action: Type.Union([
      Type.Literal("lifeAt"),
      Type.Literal("claimsTo"),
      Type.Literal("explainStatement"),
      Type.Literal("epistemic"),
    ]),
    retrievalOnly: Type.Literal(true),
    sourceRefs: Type.Array(text, { maxItems: 128, uniqueItems: true }),
    data: Type.Record(Type.String(), Type.Unknown()),
  },
  object,
);
/** These fields are constructed only by the actual plugin factory/execute context. */
export const nativeLifeRequestSchema = Type.Object(
  {
    nativeRunId: text,
    activityRef: activitySchema.properties.activityId,
    nativeAgentId: text,
    sessionKey: text,
    sessionId: text,
    toolCallId: text,
    request: nativeLifeActionSchema,
  },
  object,
);
/** A projection of the current bound Activity, without management authority or body getters. */
const nativeLifeActivityResponseSchema = Type.Object(
  {
    revision: activitySchema.properties.revision,
    purpose: activitySchema.properties.purpose,
    state: activitySchema.properties.state,
    mode: activitySchema.properties.mode,
    world: worldPointSchema,
    nextOpportunity: activitySchema.properties.nextOpportunity,
    progress: activitySchema.properties.progress,
    feedbackOmitted: Type.Boolean(),
  },
  object,
);
export const nativeLifeResponseSchema = Type.Union([
  nativeLifeActivityResponseSchema,
  nativeLifeReadResponseSchema,
]);
/** A read action accepted by the existing native Life boundary. */
export type NativeLifeReadAction = Static<typeof nativeLifeReadActionSchema>;
/** An owner-derived read result bound to an actual native tool call. */
export type NativeLifeReadResponse = Static<typeof nativeLifeReadResponseSchema>;
/** Service-only native Life request. */
export type NativeLifeRequest = Static<typeof nativeLifeRequestSchema>;
/** Bounded native Activity projection. */
export type NativeLifeResponse = Static<typeof nativeLifeResponseSchema>;
