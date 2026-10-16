// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** The Host receives native context separately from the bounded model request.
 * @module native-life-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { activitySchema, worldPointSchema } from "@heptalogos/subject";
const object = { additionalProperties: false } as const;
const text = Type.String({ minLength: 1, maxLength: 2048 });
/** No Subject, source, artifact, permission or result identity comes from model arguments. */
const nativeLifeActionSchema = Type.Union([
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
]);
/** These fields are constructed only by the actual plugin factory/execute context. */
export const nativeLifeRequestSchema = Type.Object(
  {
    nativeRunId: activitySchema.properties.activityId,
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
export const nativeLifeResponseSchema = Type.Object(
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
/** Service-only native Life request. */
export type NativeLifeRequest = Static<typeof nativeLifeRequestSchema>;
/** Bounded native Activity projection. */
export type NativeLifeResponse = Static<typeof nativeLifeResponseSchema>;
