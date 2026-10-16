// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** World definitions, bounded realization and role-visible life projections. @module world-contracts */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceService } from "@heptalogos/persistence";
import { worldPointSchema } from "./contracts.js";
const object = { additionalProperties: false } as const;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
const text = Type.String({ minLength: 1, maxLength: 16384 });
const id = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});
const refs = Type.Array(ref, { maxItems: 128, uniqueItems: true });
const instant = worldPointSchema.properties.at;
/** A half-open interval in exactly one declared clock domain. */
export const worldIntervalSchema = Type.Object(
  { timeDomainRef: ref, start: instant, end: instant },
  object,
);
/** An actor is world-scoped and never an implicitly linked platform person. */
export const worldActorSchema = Type.Object(
  { entityRef: ref, name: ref, description: text },
  object,
);
/** Adopted environment; personal biography and Seed remain outside this owner. */
export const worldDefinitionSchema = Type.Object(
  {
    worldId: id,
    subjectId: id,
    revision: Type.Integer({ minimum: 1 }),
    name: ref,
    timeDomainRef: ref,
    timezone: ref,
    offlinePolicy: Type.Union([
      Type.Literal("simulate_elapsed"),
      Type.Literal("pause_with_host"),
    ]),
    places: Type.Array(
      Type.Object({ placeRef: ref, name: ref, description: text }, object),
      { maxItems: 128 },
    ),
    actors: Type.Array(worldActorSchema, { maxItems: 128 }),
    subjectActorRef: ref,
    rules: text,
    creationScope: text,
    informationSourceRefs: refs,
  },
  object,
);
/** Complete environment adopted explicitly by an authenticated operator. */
export type WorldDefinition = Static<typeof worldDefinitionSchema>;
/** A definite or planned life slot; recurrence can be expanded before realization. */
export const worldScheduleItemSchema = Type.Object(
  {
    scheduleId: id,
    interval: worldIntervalSchema,
    title: ref,
    description: text,
    actorRefs: refs,
    placeRef: ref,
    activityId: Type.Union([id, Type.Null()]),
    sourceRefs: refs,
    status: Type.Union([Type.Literal("planned"), Type.Literal("cancelled")]),
    overlap: Type.Union([Type.Literal("exclusive"), Type.Literal("concurrent")]),
  },
  object,
);
/** A visible portion of an adopted virtual event, released only to the named actor. */
export const worldPerceptionSchema = Type.Object(
  {
    actorRef: ref,
    kind: Type.Union([
      Type.Literal("seen"),
      Type.Literal("heard"),
      Type.Literal("recall"),
    ]),
    at: worldPointSchema,
    content: text,
  },
  object,
);
/** A proposed event becomes canonical only through WorldLife realization. */
export const worldEventInputSchema = Type.Object(
  {
    eventId: id,
    interval: worldIntervalSchema,
    title: ref,
    content: text,
    actorRefs: refs,
    placeRef: ref,
    scheduleId: Type.Union([id, Type.Null()]),
    parentEventId: Type.Union([id, Type.Null()]),
    causalEventRefs: refs,
    overlap: Type.Union([Type.Literal("exclusive"), Type.Literal("concurrent")]),
    source: Type.Object(
      {
        kind: Type.Union([
          Type.Literal("rule"),
          Type.Literal("world_planner"),
          Type.Literal("environment"),
        ]),
        producerRef: ref,
        sourceRefs: refs,
      },
      object,
    ),
    perceptions: Type.Array(worldPerceptionSchema, { maxItems: 128 }),
  },
  object,
);
/** Canonical event retains when realization actually happened in the real host. */
export const realizedWorldEventSchema = Type.Object(
  {
    ...worldEventInputSchema.properties,
    revision: Type.Integer({ minimum: 1 }),
    recordedAt: instant,
  },
  object,
);
/** Typed canonical virtual event. */
export type RealizedWorldEvent = Static<typeof realizedWorldEventSchema>;
/** Revision-aware setup and future-plan mutation, separate from Subject cognition. */
export const configureWorldSchema = Type.Object(
  {
    operationId: id,
    expectedRevision: Type.Integer({ minimum: 0 }),
    definition: worldDefinitionSchema,
    schedule: Type.Array(worldScheduleItemSchema, { maxItems: 256 }),
  },
  object,
);
/** A bounded patch binds exactly the frame revision used outside the write transaction. */
export const realizeWorldSchema = Type.Object(
  {
    operationId: id,
    subjectId: id,
    worldId: id,
    expectedRevision: Type.Integer({ minimum: 1 }),
    interval: worldIntervalSchema,
    events: Type.Array(worldEventInputSchema, { maxItems: 128 }),
    coverage: Type.Union([Type.Literal("complete"), Type.Literal("limited")]),
  },
  object,
);
/** Bounded world/subject reads distinguish story knowledge from database history. */
export const queryWorldSchema = Type.Object(
  {
    subjectId: id,
    worldId: id,
    interval: worldIntervalSchema,
    view: Type.Union([Type.Literal("world_author"), Type.Literal("subject")]),
    asRecordedAt: Type.Optional(instant),
    knowledgeAtWorldTime: Type.Optional(worldPointSchema),
    afterEventId: Type.Optional(id),
    limit: Type.Integer({ minimum: 1, maximum: 128 }),
  },
  object,
);
/** Owner dependencies; world clock reads happen outside a Host mutation. */
export interface WorldLifeOptions {
  readonly persistence: PersistenceService;
  readonly now: () => string;
  readonly worldNow: (subjectId: string) => Promise<Static<typeof worldPointSchema>>;
}
/** One world state revision; full author state is never a Subject prompt. */
export interface WorldState {
  readonly definition: WorldDefinition;
  readonly revision: number;
  readonly schedule: readonly Static<typeof worldScheduleItemSchema>[];
  readonly updatedAt: string;
}
/** Current state projection returned by authenticated world author operations. */
export const worldStateSchema = Type.Object(
  {
    definition: worldDefinitionSchema,
    revision: Type.Integer({ minimum: 1 }),
    schedule: Type.Array(worldScheduleItemSchema, { maxItems: 256 }),
    updatedAt: instant,
  },
  object,
);
/** Exact same-Subject world lookup. */
export const readWorldSchema = Type.Object({ subjectId: id, worldId: id }, object);
/** A canonical event may be released once to its Subject through a stable Nous contact. */
export const acknowledgeWorldContactSchema = Type.Object(
  { subjectId: id, worldId: id, eventId: id, contactRef: ref },
  object,
);
/** Typed realization receipt; coverage is adopted only by the world owner. */
export const worldRealizationResultSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 1 }),
    events: Type.Array(realizedWorldEventSchema, { maxItems: 128 }),
    interval: worldIntervalSchema,
    coverage: Type.Union([Type.Literal("complete"), Type.Literal("limited")]),
  },
  object,
);
/** Subject-only projection excludes hidden event content and producer instructions. */
export const visibleWorldEventSchema = Type.Object(
  {
    eventId: id,
    eventRevision: Type.Integer({ minimum: 1 }),
    worldId: id,
    interval: worldIntervalSchema,
    recordedAt: instant,
    ...worldPerceptionSchema.properties,
  },
  object,
);
/** Public query shape follows the authenticated requested perspective. */
export const worldQueryResultSchema = Type.Union([
  Type.Object(
    {
      revision: Type.Integer({ minimum: 1 }),
      view: Type.Literal("world_author"),
      events: Type.Array(realizedWorldEventSchema),
      nextEventId: Type.Union([id, Type.Null()]),
    },
    object,
  ),
  Type.Object(
    {
      revision: Type.Integer({ minimum: 1 }),
      view: Type.Literal("subject"),
      events: Type.Array(visibleWorldEventSchema),
      nextEventId: Type.Union([id, Type.Null()]),
    },
    object,
  ),
]);
