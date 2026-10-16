// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Canonical calendar read/change contracts shared by owner, Management and Client.
 * @module world-calendar-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import {
  worldDefinitionSchema,
  worldIntervalSchema,
  worldScheduleItemSchema,
  realizedWorldEventSchema,
  visibleWorldEventSchema,
  calendarLocalSchema,
  worldCalendarExceptionSchema,
} from "./world-contracts.js";
const object = { additionalProperties: false } as const;
const id = worldDefinitionSchema.properties.worldId;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
/** One bounded page from any finite interval; reads have no realization/model effects. */
export const readCalendarSchema = Type.Object(
  {
    subjectId: id,
    worldId: id,
    interval: worldIntervalSchema,
    view: Type.Union([
      Type.Literal("planned"),
      Type.Literal("lived"),
      Type.Literal("combined"),
    ]),
    perspective: Type.Union([
      Type.Literal("world_author"),
      Type.Literal("subject"),
      Type.Literal("public"),
    ]),
    displayTimezone: ref,
    actorRef: Type.Optional(ref),
    activityId: Type.Optional(id),
    limit: Type.Integer({ minimum: 1, maximum: 128 }),
    continuation: Type.Optional(Type.String({ maxLength: 4096 })),
    asRecordedAt: Type.Optional(worldIntervalSchema.properties.start),
  },
  object,
);
/** Calendar keeps both the original arrangement and the actual realized record. */
export const calendarItemSchema = Type.Object(
  {
    instanceId: id,
    interval: worldIntervalSchema,
    localStart: ref,
    localEnd: ref,
    status: Type.Union([
      Type.Literal("planned"),
      Type.Literal("cancelled"),
      Type.Literal("realized"),
      Type.Literal("unplanned"),
    ]),
    planned: Type.Union([worldScheduleItemSchema, Type.Null()]),
    lived: Type.Array(Type.Union([realizedWorldEventSchema, visibleWorldEventSchema])),
    recordedAt: worldIntervalSchema.properties.start,
    sourceRefs: Type.Array(ref),
  },
  object,
);
/** Stable owner continuation is invalidated by a relevant world revision or changed query. */
export const calendarResultSchema = Type.Object(
  {
    worldId: id,
    revision: Type.Integer({ minimum: 1 }),
    interval: worldIntervalSchema,
    displayTimezone: ref,
    items: Type.Array(calendarItemSchema),
    continuation: Type.Union([ref, Type.Null()]),
  },
  object,
);
/** A single-instance edit or a future effective series revision; realized instances remain fixed. */
export const changeCalendarSchema = Type.Object(
  {
    operationId: id,
    subjectId: id,
    worldId: id,
    expectedRevision: Type.Integer({ minimum: 1 }),
    ruleId: id,
    recurrenceId: calendarLocalSchema,
    scope: Type.Union([
      Type.Literal("this"),
      Type.Literal("future"),
      Type.Literal("unrealized"),
    ]),
    change: Type.Pick(worldCalendarExceptionSchema, [
      "startLocal",
      "durationMinutes",
      "placeRef",
      "actorRefs",
      "status",
    ]),
    reason: Type.String({ minLength: 1, maxLength: 16384 }),
  },
  object,
);
/** Input types are derived from the same public schemas. */
export type ReadCalendar = Static<typeof readCalendarSchema>;
/** Input types are derived from the same public schemas. */
export type ChangeCalendar = Static<typeof changeCalendarSchema>;
/** Output types are derived from the same public schemas. */
export type CalendarResult = Static<typeof calendarResultSchema>;
