// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Semantic world actions have owner-defined duration and actual due completion.
 * @module world-action-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import { worldDefinitionSchema, worldIntervalSchema } from "./world-contracts.js";
import { worldPointSchema } from "./contracts.js";
const object = { additionalProperties: false } as const;
const id = worldDefinitionSchema.properties.worldId,
  ref = Type.String({ minLength: 1, maxLength: 2048 });
/** The model names a known target, never supplies a new clock value or action duration. */
export const worldActionSchema = Type.Union([
  Type.Object({ kind: Type.Literal("move"), placeRef: ref }, object),
  Type.Object({ kind: Type.Literal("participate"), scheduleId: id }, object),
  Type.Object({ kind: Type.Literal("rest") }, object),
]);
/** Source Reaction identity is supplied by the trusted foreground caller. */
export const adoptWorldActionSchema = Type.Object(
  {
    operationId: id,
    subjectId: id,
    worldId: id,
    sourceReactionRef: ref,
    interruptingEventId: Type.Optional(id),
    action: worldActionSchema,
  },
  object,
);
/** One adopted semantic action; pending means its future interval has not been realized. */
export const worldActionResultSchema = Type.Object(
  {
    actionId: id,
    actionRef: ref,
    subjectId: id,
    worldId: id,
    operationId: id,
    sourceReactionRef: ref,
    interruptingEventId: Type.Optional(id),
    action: worldActionSchema,
    status: Type.Union([
      Type.Literal("completed"),
      Type.Literal("pending"),
      Type.Literal("unavailable"),
      Type.Literal("rejected"),
      Type.Literal("cancelled"),
      Type.Literal("uncertain"),
    ]),
    interval: worldIntervalSchema,
    realizedThrough: worldPointSchema,
    fromPlaceRef: ref,
    toPlaceRef: ref,
    scheduleId: Type.Union([id, Type.Null()]),
    eventRefs: Type.Array(ref),
    reason: Type.String({ maxLength: 16384 }),
    nextOpportunity: Type.Union([worldPointSchema, Type.Null()]),
    recordedAt: worldPointSchema.properties.at,
  },
  object,
);
/** Profile and current presence, not token use, define this action's physical/virtual result. */
export type WorldActionResult = Static<typeof worldActionResultSchema>;
/** Public schema-derived actual action request. */
export type AdoptWorldAction = Static<typeof adoptWorldActionSchema>;
