// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** The current virtual interface uses canonical actions and explicit owner object handles.
 * @module situation-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import {
  foregroundQualificationSchema,
  interactionActionKindSchema,
} from "./reactor-contracts.js";
import { activitySchema, worldPointSchema } from "./contracts.js";
const object = { additionalProperties: false } as const;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
/** Only source directories and already adopted local state are displayed before viewing. */
export const situationObjectSchema = Type.Object(
  {
    handle: ref,
    owner: Type.Union([
      Type.Literal("messaging"),
      Type.Literal("world"),
      Type.Literal("life"),
      Type.Literal("role_result"),
    ]),
    kind: Type.Union([
      Type.Literal("notification"),
      Type.Literal("conversation"),
      Type.Literal("message"),
      Type.Literal("task"),
      Type.Literal("world_event"),
      Type.Literal("world_entry"),
      Type.Literal("place"),
      Type.Literal("schedule"),
      Type.Literal("page"),
      Type.Literal("activity"),
      Type.Literal("expression_candidate"),
    ]),
    sourceRef: ref,
    sourceRevision: ref,
    label: Type.String({ maxLength: 1024 }),
    state: Type.Union([
      Type.Literal("available"),
      Type.Literal("unread"),
      Type.Literal("ready"),
      Type.Literal("pending"),
      Type.Literal("viewed"),
    ]),
    actions: Type.Array(interactionActionKindSchema, {
      maxItems: 12,
      uniqueItems: true,
    }),
  },
  object,
);
/** A handle is meaningful only within the actual current frame and focus qualification. */
export type SituationObject = Static<typeof situationObjectSchema>;
/** The frame is not an observation of unread objects; actual content enters only through native contact admission. */
export const situationFrameSchema = Type.Object(
  {
    subjectId: activitySchema.properties.subjectId,
    activityId: activitySchema.properties.activityId,
    ...foregroundQualificationSchema.properties,
    frameRef: ref,
    world: worldPointSchema,
    locationRef: Type.Optional(ref),
    currentActivityRefs: Type.Array(ref, { maxItems: 64, uniqueItems: true }),
    energy: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
    currentHandle: Type.Optional(ref),
    objects: Type.Array(situationObjectSchema, { maxItems: 128 }),
    remainingSteps: Type.Integer({ minimum: 0 }),
    deadlineAt: activitySchema.properties.createdAt,
    limitation: Type.Optional(ref),
  },
  object,
);
/** One bounded actual current view shared by deliberation and action execution. */
export type SituationFrame = Static<typeof situationFrameSchema>;
