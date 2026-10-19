// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * World definitions, bounded realization and role-visible life projections.
 * @module world-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceService } from "@heptalogos/persistence";
import {
  worldEventEnergySchema,
  worldEnergyKindSchema,
} from "./world-energy-contracts.js";
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
/** RFC 5545 local recurrence identity; timezone conversion occurs through the explicit IANA policy. */
export const calendarLocalSchema = Type.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}$",
});
/** Original recurrence identities survive moves and future-series revisions. */
export const worldCalendarExceptionSchema = Type.Object(
  {
    exceptionId: id,
    ruleId: id,
    recurrenceId: calendarLocalSchema,
    startLocal: Type.Optional(calendarLocalSchema),
    preserveRuleRevision: Type.Optional(Type.Integer({ minimum: 1 })),
    durationMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 10080 })),
    placeRef: Type.Optional(ref),
    actorRefs: Type.Optional(refs),
    status: Type.Union([Type.Literal("planned"), Type.Literal("cancelled")]),
    reason: text,
  },
  object,
);
/** Attendance and interruption are independent of who may edit the environment's timetable. */
export const worldAttendancePolicySchema = Type.Object(
  {
    mode: Type.Union([
      Type.Literal("autonomous"),
      Type.Literal("usual"),
      Type.Literal("strict"),
    ]),
    startToleranceMinutes: Type.Integer({ minimum: 0, maximum: 1440 }),
    earlyMinutes: Type.Integer({ minimum: 0, maximum: 1440 }),
    lateMinutes: Type.Integer({ minimum: 0, maximum: 1440 }),
    minimumContinuationMinutes: Type.Integer({ minimum: 0, maximum: 1440 }),
    interruptAfterMinutes: Type.Union([
      Type.Integer({ minimum: 1, maximum: 10080 }),
      Type.Null(),
    ]),
    interruptEvents: Type.Array(
      Type.Union([
        Type.Literal("social"),
        Type.Literal("important"),
        Type.Literal("emergency"),
        Type.Literal("official_change"),
      ]),
      { uniqueItems: true, maxItems: 4 },
    ),
  },
  object,
);
export type WorldAttendancePolicy = Static<typeof worldAttendancePolicySchema>;
/** Old persisted rules are interpreted once here; runtime consumers use this policy. */
export function worldAttendancePolicy(rule: {
  attendancePolicy?: WorldAttendancePolicy;
  mode?: "fixed" | "choice";
  adjustable?: boolean;
}): WorldAttendancePolicy {
  const autonomous = rule.mode !== "fixed" || rule.adjustable;
  return (
    rule.attendancePolicy ?? {
      mode: autonomous ? "autonomous" : "usual",
      startToleranceMinutes: 0,
      earlyMinutes: autonomous ? 60 : 0,
      lateMinutes: autonomous ? 60 : 0,
      minimumContinuationMinutes: 0,
      interruptAfterMinutes: autonomous ? 1 : null,
      interruptEvents: ["social", "important", "emergency", "official_change"],
    }
  );
}
/** One effective revision of a stable local-time RFC 5545 series. */
export const worldRoutineRuleSchema = Type.Object(
  {
    ruleId: id,
    revision: Type.Integer({ minimum: 1 }),
    title: ref,
    content: text,
    subjectPerception: Type.Union([text, Type.Null()]),
    startsAtLocal: calendarLocalSchema,
    timezone: ref,
    rrule: Type.Union([Type.String({ minLength: 1, maxLength: 2048 }), Type.Null()]),
    rdates: Type.Array(calendarLocalSchema, { maxItems: 256, uniqueItems: true }),
    exdates: Type.Array(calendarLocalSchema, { maxItems: 256, uniqueItems: true }),
    validThrough: Type.Union([
      Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" }),
      Type.Null(),
    ]),
    effectiveFrom: Type.Union([calendarLocalSchema, Type.Null()]),
    effectiveUntil: Type.Union([calendarLocalSchema, Type.Null()]),
    startShiftSeconds: Type.Integer(),
    disambiguation: Type.Union([
      Type.Literal("compatible"),
      Type.Literal("earlier"),
      Type.Literal("later"),
      Type.Literal("reject"),
    ]),
    durationMinutes: Type.Integer({ minimum: 1, maximum: 10080 }),
    actorRefs: refs,
    placeRef: ref,
    activityId: Type.Union([id, Type.Null()]),
    kind: worldEnergyKindSchema,
    visibility: Type.Union([
      Type.Literal("subject"),
      Type.Literal("world_author"),
      Type.Literal("public"),
    ]),
    adjustable: Type.Boolean(),
    attendancePolicy: Type.Optional(worldAttendancePolicySchema),
    cancelled: Type.Optional(Type.Boolean()),
    archived: Type.Optional(Type.Boolean()),
    mode: Type.Union([Type.Literal("fixed"), Type.Literal("choice")]),
  },
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
    routineRules: Type.Optional(Type.Array(worldRoutineRuleSchema, { maxItems: 256 })),
    calendarExceptions: Type.Optional(
      Type.Array(worldCalendarExceptionSchema, { maxItems: 1024 }),
    ),
  },
  object,
);
/** Complete environment adopted explicitly by an authenticated operator. */
export type WorldDefinition = Static<typeof worldDefinitionSchema>;
/** A definite or planned life slot; recurrence can be expanded before realization. */
export const worldScheduleItemSchema = Type.Object(
  {
    scheduleId: id,
    ruleRef: Type.Optional(
      Type.Object(
        {
          ruleId: id,
          revision: Type.Integer({ minimum: 1 }),
          recurrenceId: calendarLocalSchema,
          originalInterval: worldIntervalSchema,
          timezoneAdjusted: Type.Boolean(),
          exceptionId: Type.Union([id, Type.Null()]),
        },
        object,
      ),
    ),
    interval: worldIntervalSchema,
    attendancePolicy: Type.Optional(worldAttendancePolicySchema),
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
/** Materialized recurrence copies retain the policy owned by their exact rule revision. */
export function worldScheduleAttendancePolicy(
  definition: WorldDefinition,
  schedule: Static<typeof worldScheduleItemSchema>,
) {
  const rule =
    schedule.ruleRef &&
    definition.routineRules?.find(
      (item) =>
        item.ruleId === schedule.ruleRef!.ruleId &&
        item.revision === schedule.ruleRef!.revision,
    );
  return worldAttendancePolicy(rule || schedule);
}
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
    activityId: Type.Optional(id),
    interruptionKind: Type.Optional(
      Type.Union([
        Type.Literal("social"),
        Type.Literal("important"),
        Type.Literal("emergency"),
        Type.Literal("official_change"),
      ]),
    ),
    energy: Type.Optional(worldEventEnergySchema),
    interval: worldIntervalSchema,
    title: ref,
    content: text,
    actorRefs: refs,
    placeRef: ref,
    scheduleId: Type.Union([id, Type.Null()]),
    scheduleOutcome: Type.Optional(
      Type.Union([
        Type.Literal("completed"),
        Type.Literal("missed"),
        Type.Literal("partial"),
      ]),
    ),
    parentEventId: Type.Union([id, Type.Null()]),
    causalEventRefs: refs,
    overlap: Type.Union([Type.Literal("exclusive"), Type.Literal("concurrent")]),
    source: Type.Object(
      {
        kind: Type.Union([
          Type.Literal("rule"),
          Type.Literal("world_planner"),
          Type.Literal("narrative"),
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
    schedule: Type.Optional(Type.Array(worldScheduleItemSchema, { maxItems: 256 })),
    coverage: Type.Union([Type.Literal("complete"), Type.Literal("limited")]),
  },
  object,
);
/** Planner proposals omit the identity, elapsed range and producer fields bound by the Host. */
export const worldPlannerProposalSchema = Type.Object(
  {
    ...Type.Omit(realizeWorldSchema, [
      "operationId",
      "subjectId",
      "worldId",
      "expectedRevision",
      "interval",
    ]).properties,
    events: Type.Array(
      Type.Object(
        {
          ...Type.Omit(worldEventInputSchema, ["source"]).properties,
          source: Type.Pick(worldEventInputSchema.properties.source, ["sourceRefs"]),
        },
        object,
      ),
      { maxItems: 128 },
    ),
  },
  object,
);
/** World-author proposal before the Host binds identity, time and producer provenance. */
export type WorldPlannerProposal = Static<typeof worldPlannerProposalSchema>;
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
  { subjectId: id, worldId: id, eventId: id, contactRef: ref, runId: ref },
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
/** The world planner frame is an execution-only view and must never enter Subject history. */
export const worldFrameSchema = Type.Object(
  {
    state: worldStateSchema,
    world: worldPointSchema,
    schedule: Type.Array(worldScheduleItemSchema, { maxItems: 256 }),
    recentEvents: Type.Array(realizedWorldEventSchema, { maxItems: 128 }),
    nextOpportunity: Type.Union([worldPointSchema, Type.Null()]),
    needsRefinement: Type.Boolean(),
    currentPolicy: Type.Union([
      Type.Object(
        {
          scheduleId: id,
          policy: worldAttendancePolicySchema,
          nextInterruptAt: worldPointSchema,
        },
        object,
      ),
      Type.Null(),
    ]),
    role: Type.Literal("world.planner"),
    contactNature: Type.Literal("execution_only"),
  },
  object,
);
/** Bounded deterministic realization never creates future physical effects. */
export const advanceWorldRulesSchema = Type.Object(
  { subjectId: id, worldId: id, interval: worldIntervalSchema },
  object,
);
/** Bounded author revision history is separate from the life-event timeline. */
export const worldHistoryQuerySchema = Type.Object(
  {
    subjectId: id,
    worldId: id,
    afterRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    limit: Type.Integer({ minimum: 1, maximum: 128 }),
  },
  object,
);
/** Recorded world state revisions; none of these records is a new Subject perception. */
export const worldHistoryResultSchema = Type.Object(
  {
    history: Type.Array(worldStateSchema),
    nextRevision: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  object,
);
/** Coverage query preserves explicit world domain and real recording cutoff. */
export const worldCoverageQuerySchema = Type.Object(
  {
    subjectId: id,
    worldId: id,
    interval: worldIntervalSchema,
    asRecordedAt: Type.Optional(instant),
  },
  object,
);
/** Adopted coverage segments retain their real commit order and gaps. */
export const worldCoverageResultSchema = Type.Object(
  {
    interval: worldIntervalSchema,
    coverage: Type.Union([
      Type.Literal("complete"),
      Type.Literal("limited"),
      Type.Literal("gap"),
    ]),
    segments: Type.Array(
      Type.Object(
        {
          interval: worldIntervalSchema,
          coverage: Type.Union([Type.Literal("complete"), Type.Literal("limited")]),
          recordedAt: instant,
        },
        object,
      ),
      { maxItems: 4096 },
    ),
  },
  object,
);
