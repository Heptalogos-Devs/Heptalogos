// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Owns world truth, finite realization and actor-visible projections.
 * @module world-life
 */
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { createSubjectSchemaReader } from "./checked-schema.js";
import { createSubjectRowsReader } from "./subject-read.js";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import {
  executeRepositorySql,
  readRepositorySql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import {
  worldHistoryQuerySchema,
  worldAttendancePolicy,
  worldScheduleAttendancePolicy,
  configureWorldSchema,
  queryWorldSchema,
  realizeWorldSchema,
  realizedWorldEventSchema,
  type WorldLifeOptions,
  type WorldState,
  type RealizedWorldEvent,
} from "./world-contracts.js";
import { createWorldActionService } from "./world-actions.js";
import { createWorldContactService } from "./world-contact.js";
import { subjectProblem } from "./problems.js";
import {
  realizeRuleSegments,
  scheduleFullyRealized,
} from "./world-rule-realization.js";
import { expandWorldRoutines, validateWorldRoutines } from "./world-calendar.js";
import {
  readWorldLiving,
  integrateWorldLivingIn,
  adoptWorldDeviceIn,
} from "./world-living.js";
import type {
  AdoptWorldDeviceView,
  AdoptedWorldProfile,
} from "./world-profile-contracts.js";
import { v5 as uuidv5 } from "uuid";
import {
  changeCalendarSchema,
  type ChangeCalendar,
} from "./world-calendar-contracts.js";
import {
  readWorldCalendar,
  applyCalendarChange,
  preserveElapsedSchedule,
  preserveElapsedRules,
} from "./world-calendar-service.js";

function conflict(detail: string): never {
  throw subjectProblem("world.conflict", "World patch is not admissible", detail);
}
const checked = createSubjectSchemaReader(() => {
  throw subjectProblem(
    "world.invalid_input",
    "Invalid world request",
    "Read the world operation schema",
    "validation",
  );
});
function interval(
  value: { timeDomainRef: string; start: string; end: string },
  domain: string,
) {
  if (
    value.timeDomainRef !== domain ||
    !Number.isFinite(Date.parse(value.start)) ||
    !Number.isFinite(Date.parse(value.end)) ||
    Date.parse(value.start) >= Date.parse(value.end)
  )
    conflict("Use a finite, increasing interval in this world's actual clock domain");
}
function overlaps(
  a: { start: string; end: string },
  b: { start: string; end: string },
) {
  return (
    Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end)
  );
}
function digest(value: unknown) {
  return digestCanonicalJson("world.operation.v1", value as CanonicalJsonValue).hex;
}
/** Shared lock order is Subject narrative, world, Activity, behavior; no model work runs here. */
export async function lockSubjectNarrative(
  tx: PersistenceInternalTransaction,
  subjectId: string,
): Promise<void> {
  await executeRepositorySql(
    tx,
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [subjectId],
  );
}
/** A composable WorldLife owner; same-transaction realization serves NarrativeCommit. */
export function createWorldLifeService(options: WorldLifeOptions) {
  const readIn = async (
    tx: PersistenceInternalTransaction,
    subjectId: string,
    worldId: string,
  ): Promise<WorldState | undefined> => {
    const rows = await executeRepositorySql<{ document: WorldState }>(
      tx,
      "SELECT document FROM heptalogos.world_life WHERE subject_id=$1 AND world_id=$2 FOR UPDATE",
      [subjectId, worldId],
    );
    return rows[0]?.document;
  };
  const replay = async (
    tx: PersistenceInternalTransaction,
    subjectId: string,
    operationId: string,
    input: unknown,
  ): Promise<unknown> => {
    const rows = await executeRepositorySql<{
      request_digest: string;
      document: unknown;
    }>(
      tx,
      "SELECT request_digest,document FROM heptalogos.world_realization WHERE subject_id=$1 AND operation_id=$2",
      [subjectId, operationId],
    );
    if (!rows[0]) return undefined;
    if (rows[0].request_digest !== digest(input))
      conflict("This operationId already identifies different world content");
    return rows[0].document;
  };
  const saveOperation = async (
    tx: PersistenceInternalTransaction,
    input: { subjectId: string; worldId: string; operationId: string },
    request: unknown,
    result: unknown,
    at: string,
  ) => {
    await executeRepositorySql(
      tx,
      "INSERT INTO heptalogos.world_realization(subject_id,world_id,operation_id,request_digest,document,recorded_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)",
      [
        input.subjectId,
        input.worldId,
        input.operationId,
        digest(request),
        JSON.stringify(result),
        at,
      ],
    );
  };
  const saveState = async (tx: PersistenceInternalTransaction, state: WorldState) => {
    await executeRepositorySql(
      tx,
      `INSERT INTO heptalogos.world_life(subject_id,world_id,revision,time_domain_ref,document,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)
ON CONFLICT(subject_id,world_id) DO UPDATE SET revision=excluded.revision,time_domain_ref=excluded.time_domain_ref,document=excluded.document,updated_at=excluded.updated_at`,
      [
        state.definition.subjectId,
        state.definition.worldId,
        state.revision,
        state.definition.timeDomainRef,
        JSON.stringify(state),
        state.updatedAt,
      ],
    );
    await executeRepositorySql(
      tx,
      "INSERT INTO heptalogos.world_life_history(subject_id,world_id,revision,document,recorded_at) VALUES($1,$2,$3,$4::jsonb,$5)",
      [
        state.definition.subjectId,
        state.definition.worldId,
        state.revision,
        JSON.stringify(state),
        state.updatedAt,
      ],
    );
  };
  const realizeIn = async (
    tx: PersistenceInternalTransaction,
    value: Static<typeof realizeWorldSchema>,
    world: { timeDomainRef: string; at: string },
  ) => {
    const input = checked<Static<typeof realizeWorldSchema>>(realizeWorldSchema, value);
    await lockSubjectNarrative(tx, input.subjectId);
    const previous = await replay(tx, input.subjectId, input.operationId, input);
    if (previous)
      return previous as {
        revision: number;
        events: RealizedWorldEvent[];
        coverage: "complete" | "limited";
        interval: Static<typeof realizeWorldSchema>["interval"];
      };
    const state = await readIn(tx, input.subjectId, input.worldId);
    if (!state || state.revision !== input.expectedRevision)
      conflict("Read a current WorldFrame before applying its patch");
    interval(input.interval, state.definition.timeDomainRef);
    if (
      world.timeDomainRef !== input.interval.timeDomainRef ||
      !Number.isFinite(Date.parse(world.at)) ||
      Date.parse(input.interval.end) > Date.parse(world.at)
    )
      conflict(
        "Realization cannot create future history or cross the current clock domain",
      );
    const rows = await executeRepositorySql<{ document: RealizedWorldEvent }>(
      tx,
      "SELECT document FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2 AND occurred_start<$4::timestamptz AND occurred_end>$3::timestamptz",
      [input.subjectId, input.worldId, input.interval.start, input.interval.end],
    );
    const related = rows.map((row) => row.document);
    const ids = new Set<string>();
    const at = options.now();
    const policyRows = await executeRepositorySql<{ max_delta: number }>(
      tx,
      "SELECT (document#>>'{profile,energy,maxEventDelta}')::double precision AS max_delta FROM heptalogos.world_profile WHERE subject_id=$1 AND world_id=$2",
      [input.subjectId, input.worldId],
    );
    for (const event of input.events)
      if (
        event.energy &&
        event.actorRefs.includes(state.definition.subjectActorRef) &&
        Math.abs(event.energy.delta) > (policyRows[0]?.max_delta ?? 0)
      )
        conflict(
          "The event appraisal exceeds this world's currently adopted delta allowance",
        );
    const events: RealizedWorldEvent[] = [];
    for (const event of input.events) {
      interval(event.interval, state.definition.timeDomainRef);
      if (ids.has(event.eventId)) conflict("A patch cannot repeat an event identity");
      ids.add(event.eventId);
      if (
        Date.parse(event.interval.start) < Date.parse(input.interval.start) ||
        Date.parse(event.interval.end) > Date.parse(input.interval.end)
      )
        conflict("An event must stay inside the prepared patch interval");
      if (
        !state.definition.places.some((place) => place.placeRef === event.placeRef) ||
        event.actorRefs.some(
          (actor) =>
            !state.definition.actors.some((known) => known.entityRef === actor),
        )
      )
        conflict("Every event must use adopted world actor and place identities");
      if (
        event.scheduleId &&
        ![
          ...(input.schedule ?? state.schedule),
          ...expandWorldRoutines(state.definition, input.interval).map(
            (value) => value.schedule,
          ),
        ].some(
          (item) => item.scheduleId === event.scheduleId && item.status === "planned",
        )
      )
        conflict("The referred schedule item is missing or cancelled");
      if (
        event.parentEventId &&
        ![...related, ...events].some(
          (parent) =>
            parent.eventId === event.parentEventId &&
            Date.parse(parent.interval.start) <= Date.parse(event.interval.start) &&
            Date.parse(parent.interval.end) >= Date.parse(event.interval.end),
        )
      )
        conflict("A detail must refer to a realized enclosing parent event");
      for (const other of [...related, ...events]) {
        if (
          event.scheduleId &&
          event.scheduleId === other.scheduleId &&
          overlaps(event.interval, other.interval) &&
          other.scheduleOutcome === "missed" &&
          event.actorRefs.includes(state.definition.subjectActorRef)
        )
          conflict("A recorded absence cannot become attendance through a late event");
        if (
          event.scheduleId &&
          event.scheduleId === other.scheduleId &&
          overlaps(event.interval, other.interval) &&
          event.scheduleOutcome &&
          other.scheduleOutcome &&
          event.scheduleOutcome !== other.scheduleOutcome
        )
          conflict(
            "Append a correction to a recorded outcome; do not replace absence or participation with a different outcome",
          );
        if (event.eventId === other.eventId)
          conflict(
            "An adopted event identity is immutable; append an explicit detail instead",
          );
        const shared = event.actorRefs.some((actor) => other.actorRefs.includes(actor));
        const parent =
          event.parentEventId === other.eventId ||
          other.parentEventId === event.eventId;
        if (
          shared &&
          overlaps(event.interval, other.interval) &&
          !parent &&
          (event.placeRef !== other.placeRef ||
            (event.overlap === "exclusive" && other.overlap === "exclusive"))
        )
          conflict(
            "An actor cannot occupy conflicting places or exclusive activities at the same time",
          );
      }
      for (const perception of event.perceptions) {
        if (
          !Number.isFinite(Date.parse(perception.at.at)) ||
          !event.actorRefs.includes(perception.actorRef) ||
          perception.at.timeDomainRef !== state.definition.timeDomainRef ||
          Date.parse(perception.at.at) < Date.parse(event.interval.start) ||
          Date.parse(perception.at.at) > Date.parse(event.interval.end)
        )
          conflict(
            "A perception must belong to a participating actor within the event's actual domain and interval",
          );
      }
      const canonical = checked<RealizedWorldEvent>(realizedWorldEventSchema, {
        ...event,
        revision: 1,
        recordedAt: at,
      });
      await executeRepositorySql(
        tx,
        "INSERT INTO heptalogos.world_event(subject_id,world_id,event_id,time_domain_ref,occurred_start,occurred_end,recorded_at,document) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
        [
          input.subjectId,
          input.worldId,
          event.eventId,
          event.interval.timeDomainRef,
          event.interval.start,
          event.interval.end,
          at,
          JSON.stringify(canonical),
        ],
      );
      events.push(canonical);
    }
    if (input.schedule)
      preserveElapsedSchedule(state.schedule, input.schedule, world.at);
    if (input.schedule)
      for (const item of input.schedule) {
        interval(item.interval, state.definition.timeDomainRef);
        if (
          !state.definition.places.some((place) => place.placeRef === item.placeRef) ||
          item.actorRefs.some(
            (actor) =>
              !state.definition.actors.some((known) => known.entityRef === actor),
          )
        )
          conflict("A world patch schedule requires adopted entities");
      }
    const next = {
      ...state,
      schedule: input.schedule ?? state.schedule,
      revision: state.revision + 1,
      updatedAt: at,
    };
    await saveState(tx, next);
    await integrateWorldLivingIn(tx, {
      subjectId: input.subjectId,
      worldId: input.worldId,
      worldRevision: next.revision,
      events,
      now: at,
    });
    const result = {
      revision: next.revision,
      events,
      interval: input.interval,
      coverage: input.coverage,
    };
    await saveOperation(tx, input, input, result, at);
    return result;
  };
  const configureIn = async (
    tx: PersistenceInternalTransaction,
    value: Static<typeof configureWorldSchema>,
    world?: { timeDomainRef: string; at: string },
  ): Promise<WorldState> => {
    const input = checked<Static<typeof configureWorldSchema>>(
      configureWorldSchema,
      value,
    );
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.definition.timezone }).format();
    } catch {
      conflict("Use an actual IANA timezone");
    }
    validateWorldRoutines(input.definition);
    const { subjectId, worldId } = input.definition;
    if (
      !input.definition.actors.some(
        (actor) => actor.entityRef === input.definition.subjectActorRef,
      ) ||
      new Set(input.definition.actors.map((actor) => actor.entityRef)).size !==
        input.definition.actors.length ||
      new Set(input.definition.places.map((place) => place.placeRef)).size !==
        input.definition.places.length ||
      new Set(input.schedule.map((item) => item.scheduleId)).size !==
        input.schedule.length
    )
      conflict(
        "Adopt unique actor/place/schedule identities and one existing Subject actor",
      );
    for (const item of input.schedule) {
      interval(item.interval, input.definition.timeDomainRef);
      if (
        !input.definition.places.some((place) => place.placeRef === item.placeRef) ||
        item.actorRefs.some(
          (actor) =>
            !input.definition.actors.some((known) => known.entityRef === actor),
        )
      )
        conflict("Schedule entries require known world entities");
    }
    await lockSubjectNarrative(tx, subjectId);
    const previous = await replay(tx, subjectId, input.operationId, input);
    if (previous) return previous as WorldState;
    const current = await readIn(tx, subjectId, worldId);
    if ((current?.revision ?? 0) !== input.expectedRevision)
      conflict("World configuration revision changed");
    if (
      current &&
      current.definition.subjectActorRef !== input.definition.subjectActorRef
    )
      conflict(
        "A world's Subject actor identity is stable across configuration revisions",
      );
    if (current && current.definition.timeDomainRef !== input.definition.timeDomainRef)
      conflict("Existing world history cannot be moved to another clock domain");
    if (input.definition.revision !== (current?.definition.revision ?? 0) + 1)
      conflict("Adopt the next explicit definition revision");
    if (current) {
      if (!world || world.timeDomainRef !== current.definition.timeDomainRef)
        conflict("Configuration updates require the actual current world clock");
      preserveElapsedSchedule(current.schedule, input.schedule, world.at);
      preserveElapsedRules(current.definition, input.definition, world.at);
    }
    const next = {
      definition: input.definition,
      revision: input.expectedRevision + 1,
      schedule: input.schedule,
      updatedAt: options.now(),
    };
    await saveState(tx, next);
    await saveOperation(
      tx,
      { subjectId, worldId, operationId: input.operationId },
      input,
      next,
      next.updatedAt,
    );
    return next;
  };
  const contacts = createWorldContactService({
    persistence: options.persistence,
    now: options.now,
    readIn,
    lockSubject: lockSubjectNarrative,
    readState: async (subjectId, worldId): Promise<WorldState | undefined> =>
      service.read(subjectId, worldId),
  });
  const actions = createWorldActionService({
    persistence: options.persistence,
    now: options.now,
    worldNow: options.worldNow,
    readIn,
    realizeIn,
    lockSubject: lockSubjectNarrative,
  });
  const service = {
    ...contacts,
    ...actions,
    readLivingState: (input: { subjectId: string; worldId: string }) =>
      readWorldLiving(options, input),
    async adoptDeviceViewIn(
      tx: PersistenceInternalTransaction,
      input: AdoptWorldDeviceView,
    ) {
      await lockSubjectNarrative(tx, input.subjectId);
      return adoptWorldDeviceIn(tx, input, options.now());
    },
    async adoptDeviceView(input: AdoptWorldDeviceView) {
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, input.subjectId);
          return adoptWorldDeviceIn(tx, input, options.now());
        }),
      );
    },
    async readRealization(subjectId: string, operationId: string): Promise<unknown> {
      const rows = await readRepositorySql<{ document: unknown }>(
        options.persistence,
        "SELECT document FROM heptalogos.world_realization WHERE subject_id=$1 AND operation_id=$2",
        [subjectId, operationId],
      );
      return rows[0]?.document;
    },
    /** Same transaction owner operation for atomic narrative adoption. */
    realizeIn,
    /** Arbitrary finite calendar ranges are read-only owner projections. */
    readCalendar: (input: Parameters<typeof readWorldCalendar>[1]) =>
      readWorldCalendar(options, input),
    /** Calendar changes share the Subject/world lock and operation replay with realization. */
    async changeCalendar(
      value: ChangeCalendar,
      authority?: {
        actorMode: "subject" | "operator";
        assertCurrentIn?: (tx: PersistenceInternalTransaction) => Promise<void>;
      },
    ) {
      const input = checked<ChangeCalendar>(changeCalendarSchema, value);
      const saved = await readRepositorySql<{
        request_digest: string;
        document: unknown;
      }>(
        options.persistence,
        "SELECT request_digest,document FROM heptalogos.world_realization WHERE subject_id=$1 AND operation_id=$2",
        [input.subjectId, input.operationId],
      );
      if (saved[0]) {
        if (saved[0].request_digest !== digest(input))
          conflict("This calendar operation already binds different input");
        return saved[0].document as WorldState;
      }
      const world = await options.worldNow(input.subjectId);
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, input.subjectId);
          const previous = await replay(tx, input.subjectId, input.operationId, input);
          if (previous) return previous as WorldState;
          const current = await readIn(tx, input.subjectId, input.worldId);
          if (!current || current.revision !== input.expectedRevision)
            conflict("Calendar world revision changed");
          if (world.timeDomainRef !== current.definition.timeDomainRef)
            conflict("The current world clock has another domain");
          const rows = await executeRepositorySql<{ document: RealizedWorldEvent }>(
            tx,
            "SELECT document FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2 AND document->>'scheduleId' IS NOT NULL",
            [input.subjectId, input.worldId],
          );
          const realizedIds = new Set(rows.map((row) => row.document.scheduleId!));
          if (authority?.assertCurrentIn) await authority.assertCurrentIn(tx);
          if (authority?.actorMode === "subject") {
            const affected = (current.definition.routineRules ?? []).filter(
              (rule) =>
                rule.ruleId === input.ruleId &&
                !rule.archived &&
                (!rule.effectiveUntil || rule.effectiveUntil > input.recurrenceId) &&
                (input.scope !== "this" ||
                  !rule.effectiveFrom ||
                  rule.effectiveFrom <= input.recurrenceId),
            );
            if (!affected.length || affected.some((rule) => !rule.adjustable))
              conflict(
                "The Subject cannot rewrite a school's fixed rule; choose participation or absence instead",
              );
            if (input.change.startLocal) {
              const rule = affected[0]!;
              const exception = current.definition.calendarExceptions?.find(
                (item) =>
                  item.ruleId === input.ruleId &&
                  item.recurrenceId === input.recurrenceId,
              );
              const original =
                Date.parse((exception?.startLocal ?? input.recurrenceId) + "Z") +
                (exception?.startLocal ? 0 : rule.startShiftSeconds * 1000);
              const offsetMinutes =
                (Date.parse(input.change.startLocal + "Z") - original) / 60000;
              const policy = worldAttendancePolicy(rule);
              if (
                offsetMinutes < -policy.earlyMinutes ||
                offsetMinutes > policy.lateMinutes
              )
                conflict(
                  "The Subject's schedule change exceeds the adopted early/late allowance",
                );
            }
          }
          const definition = applyCalendarChange(
            current.definition,
            input,
            realizedIds,
            rows.map((row) => row.document),
            world.at,
          );
          validateWorldRoutines(definition);
          const next: WorldState = {
            ...current,
            definition,
            revision: current.revision + 1,
            updatedAt: options.now(),
            schedule: current.schedule.filter(
              (plan) =>
                Date.parse(plan.interval.end) <= Date.parse(world.at) ||
                plan.ruleRef?.ruleId !== input.ruleId,
            ),
          };
          await saveState(tx, next);
          await saveOperation(tx, input, input, next, next.updatedAt);
          return next;
        }),
      );
    },
    /** Reads authoritative world state without interpreting private Nous storage. */
    async read(subjectId: string, worldId: string): Promise<WorldState | undefined> {
      const rows = await readRepositorySql<{ document: WorldState }>(
        options.persistence,
        "SELECT document FROM heptalogos.world_life WHERE subject_id=$1 AND world_id=$2",
        [subjectId, worldId],
      );
      return rows[0]?.document;
    },
    /** Explicitly adopts environment and future schedule, retaining every revision. */
    configureIn,
    async configure(value: Static<typeof configureWorldSchema>) {
      const world = await options.worldNow(value.definition.subjectId);
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, (tx) =>
          configureIn(tx, value, world),
        ),
      );
    },
    /** Realization does not infer that planned events actually occurred. */
    async realize(value: Static<typeof realizeWorldSchema>) {
      const world = await options.worldNow(value.subjectId);
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, (tx) => realizeIn(tx, value, world)),
      );
    },
    /** Advances adopted life once; callers consume changes and the next condition together. */
    async advance(subjectId: string, worldId: string) {
      const world = await options.worldNow(subjectId);
      const completedActions = await service.completeActions(
        { subjectId, worldId, limit: 32 },
        world,
      );
      let frame = await service.prepareAdvance(subjectId, worldId, world);
      const cursor = await service.realizationCursor(subjectId, worldId);
      const range = {
        timeDomainRef: frame.world.timeDomainRef,
        start: new Date(
          Math.max(
            cursor?.timeDomainRef === frame.world.timeDomainRef
              ? Date.parse(cursor.at)
              : Date.parse(frame.world.at) - 86400000,
            Date.parse(frame.world.at) - 31 * 86400000,
          ),
        ).toISOString(),
        end: frame.world.at,
      };
      const result =
        Date.parse(range.start) < Date.parse(range.end)
          ? await service.advanceRules(subjectId, worldId, range, world)
          : null;
      frame = await service.prepareAdvance(subjectId, worldId, world);
      const events = result?.events ?? [];
      const perceptibleEventRefs = events
        .filter((event) =>
          event.perceptions.some(
            (p) => p.actorRef === frame.state.definition.subjectActorRef,
          ),
        )
        .map((event) => `world-event:${worldId}:${event.eventId}:${event.revision}`);
      return {
        frame,
        interval: range,
        progress: {
          eventRefs: events.map(
            (event) => `world-event:${worldId}:${event.eventId}:${event.revision}`,
          ),
          actionRefs: completedActions.map((action) => action.actionRef),
        },
        perceptibleChanges: [
          ...perceptibleEventRefs,
          ...completedActions.flatMap((action) => action.eventRefs),
        ],
        nextOpportunity: frame.nextOpportunity,
      };
    },
    /** Produces the finite author frame; Subject inputs must use the filtered query instead. */
    async prepareAdvance(
      subjectId: string,
      worldId: string,
      capturedWorld?: { timeDomainRef: string; at: string },
    ) {
      const [state, world] = await Promise.all([
        service.read(subjectId, worldId),
        capturedWorld ?? options.worldNow(subjectId),
      ]);
      if (!state || state.definition.timeDomainRef !== world.timeDomainRef)
        conflict("World and current clock must share a declared domain");
      const adopted = await readRepositorySql<{ document: AdoptedWorldProfile }>(
        options.persistence,
        "SELECT document FROM heptalogos.world_profile WHERE subject_id=$1 AND world_id=$2",
        [subjectId, worldId],
      );
      const planning = adopted[0]?.document.profile.planning ?? {
        horizonHours: 24,
        detailHours: 2,
      };
      const upcoming = {
        timeDomainRef: world.timeDomainRef,
        start: new Date(
          Date.parse(world.at) - planning.detailHours * 3600000,
        ).toISOString(),
        end: new Date(
          Date.parse(world.at) + planning.horizonHours * 3600000,
        ).toISOString(),
      };
      const schedule = [
        ...state.schedule,
        ...expandWorldRoutines(state.definition, upcoming).map(
          (value) => value.schedule,
        ),
      ]
        .filter(
          (item) => item.status === "planned" && overlaps(item.interval, upcoming),
        )
        .sort((a, b) => a.interval.start.localeCompare(b.interval.start))
        .slice(0, 256);
      const future = schedule
        .flatMap((item) => [item.interval.start, item.interval.end])
        .filter((at) => Date.parse(at) > Date.parse(world.at))
        .sort();
      const recent = await service.query({
        subjectId,
        worldId,
        interval: { ...upcoming, end: world.at },
        view: "world_author",
        limit: 128,
      });
      const current = schedule.find(
        (item) =>
          item.actorRefs.includes(state.definition.subjectActorRef) &&
          Date.parse(item.interval.start) <= Date.parse(world.at) &&
          Date.parse(item.interval.end) > Date.parse(world.at),
      );
      const policy = current
        ? worldScheduleAttendancePolicy(state.definition, current)
        : null;
      const nextInterruptAt =
        current && policy
          ? new Date(
              Math.min(
                Date.parse(current.interval.end),
                Date.parse(current.interval.start) +
                  Math.max(
                    policy.minimumContinuationMinutes,
                    policy.interruptAfterMinutes ??
                      (Date.parse(current.interval.end) -
                        Date.parse(current.interval.start)) /
                        60000,
                  ) *
                    60000,
              ),
            ).toISOString()
          : null;
      return {
        state,
        world,
        schedule,
        recentEvents: recent.events,
        needsRefinement:
          !adopted[0] &&
          !current &&
          !recent.events.length &&
          !(await service.realizationCursor(subjectId, worldId)),
        currentPolicy:
          current && policy && nextInterruptAt
            ? {
                scheduleId: current.scheduleId,
                policy,
                nextInterruptAt: {
                  timeDomainRef: world.timeDomainRef,
                  at: nextInterruptAt,
                },
              }
            : null,
        nextOpportunity: {
          timeDomainRef: world.timeDomainRef,
          at:
            [future[0], nextInterruptAt]
              .filter((at): at is string =>
                Boolean(at && Date.parse(at) > Date.parse(world.at)),
              )
              .sort()[0] ?? upcoming.end,
        },
        role: "world.planner" as const,
        contactNature: "execution_only" as const,
      };
    },
    /** Paginates immutable author revisions without interpreting native transcripts. */
    async history(value: Static<typeof worldHistoryQuerySchema>) {
      const input = checked<Static<typeof worldHistoryQuerySchema>>(
        worldHistoryQuerySchema,
        value,
      );
      const rows = await readRepositorySql<{ document: WorldState }>(
        options.persistence,
        "SELECT document FROM heptalogos.world_life_history WHERE subject_id=$1 AND world_id=$2 AND revision>$3 ORDER BY revision LIMIT $4",
        [input.subjectId, input.worldId, input.afterRevision ?? 0, input.limit + 1],
      );
      const history = rows.slice(0, input.limit).map((row) => row.document);
      return {
        history,
        nextRevision: rows.length > input.limit ? history.at(-1)!.revision : null,
      };
    },
    /** Resolves actual same-Subject world, adopted entry and actor-visible event references in bounded owner reads. */
    async resolveSourceRefs(
      input: {
        subjectId: string;
        sourceRefs: readonly string[];
      },
      transaction?: PersistenceInternalTransaction,
    ) {
      if (input.sourceRefs.length > 128)
        conflict("World source resolution is bounded to 128 exact references");
      const uuid =
        "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
      const rootPattern = new RegExp(`^world:(${uuid})$`),
        eventPattern = new RegExp(`^world-event:(${uuid}):(${uuid}):([1-9][0-9]*)$`);
      const roots = input.sourceRefs.flatMap((ref) => {
        const match = rootPattern.exec(ref);
        return match ? [match[1]!] : [];
      });
      const entries = input.sourceRefs.filter((ref) =>
        new RegExp(`^world-profile:(${uuid}):1$`).test(ref),
      );
      const events = input.sourceRefs.flatMap((ref) => {
        const match = eventPattern.exec(ref);
        return match
          ? [{ ref, worldId: match[1]!, eventId: match[2]!, revision: match[3]! }]
          : [];
      });
      const read = createSubjectRowsReader(options.persistence, transaction);
      const actualRoots = roots.length
        ? await read<{ world_id: string }>(
            "SELECT world_id FROM heptalogos.world_life WHERE subject_id=$1 AND world_id=ANY($2::uuid[])",
            [input.subjectId, roots],
          )
        : [];
      const actualEvents = events.length
        ? await read<{
            world_id: string;
            event_id: string;
            revision: string;
          }>(
            `SELECT e.world_id,e.event_id,e.document->>'revision' AS revision FROM heptalogos.world_event e JOIN heptalogos.world_life w USING(subject_id,world_id)
WHERE e.subject_id=$1 AND e.event_id=ANY($2::uuid[]) AND (EXISTS(SELECT 1 FROM jsonb_array_elements(e.document->'perceptions') p WHERE p->>'actorRef'=w.document#>>'{definition,subjectActorRef}') OR EXISTS(SELECT 1 FROM heptalogos.world_contact_release r WHERE r.subject_id=e.subject_id AND r.world_id=e.world_id AND r.event_id=e.event_id AND r.state='released'))`,
            [input.subjectId, events.map((event) => event.eventId)],
          )
        : [];
      const actualEntries = entries.length
        ? await read<{ source_ref: string }>(
            "SELECT document->>'entrySourceRef' AS source_ref FROM heptalogos.world_profile WHERE subject_id=$1 AND document->>'entrySourceRef'=ANY($2::text[])",
            [input.subjectId, entries],
          )
        : [];
      const validEntries = new Set(actualEntries.map((row) => row.source_ref));
      const validRoots = new Set(actualRoots.map((row) => row.world_id.toLowerCase()));
      const validEvents = new Set(
        actualEvents.map((row) =>
          `${row.world_id}:${row.event_id}:${row.revision}`.toLowerCase(),
        ),
      );
      return [...new Set(input.sourceRefs)].filter((ref) => {
        if (validEntries.has(ref)) return true;
        const root = rootPattern.exec(ref);
        if (root) return validRoots.has(root[1]!.toLowerCase());
        const event = eventPattern.exec(ref);
        return Boolean(
          event && validEvents.has(`${event[1]}:${event[2]}:${event[3]}`.toLowerCase()),
        );
      });
    },
    /** Last attempted realization endpoint is scheduling progress, not a complete-coverage claim. */
    async realizationCursor(subjectId: string, worldId: string) {
      const rows = await readRepositorySql<{ at: string; domain: string }>(
        options.persistence,
        `SELECT document->'interval'->>'end' AS at,document->'interval'->>'timeDomainRef' AS domain FROM heptalogos.world_realization
WHERE subject_id=$1 AND world_id=$2 AND document->'interval' IS NOT NULL ORDER BY (document->'interval'->>'end')::timestamptz DESC LIMIT 1`,
        [subjectId, worldId],
      );
      return rows[0] ? { timeDomainRef: rows[0].domain, at: rows[0].at } : null;
    },
    /** Realizes fixed adopted calendar rules, while choices remain actual planner/Subject opportunities. */
    async advanceRules(
      subjectId: string,
      worldId: string,
      range: { timeDomainRef: string; start: string; end: string },
      capturedWorld?: { timeDomainRef: string; at: string },
    ) {
      if (!capturedWorld) await service.completeActions({ subjectId, worldId });
      const { state, world } = await service.prepareAdvance(
        subjectId,
        worldId,
        capturedWorld,
      );
      interval(range, state.definition.timeDomainRef);
      if (Date.parse(range.end) > Date.parse(world.at))
        conflict("Rules cannot realize future planned life");
      const expanded = expandWorldRoutines(state.definition, range);
      const prior = await readRepositorySql<{ document: RealizedWorldEvent }>(
        options.persistence,
        "SELECT document FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2 AND occurred_start<$4::timestamptz AND occurred_end>$3::timestamptz",
        [
          subjectId,
          worldId,
          expanded.reduce(
            (first, item) =>
              Date.parse(item.schedule.interval.start) < Date.parse(first)
                ? item.schedule.interval.start
                : first,
            range.start,
          ),
          range.end,
        ],
      );
      const due = expanded.filter(
        (value) =>
          (value.rule.attendancePolicy ? true : value.rule.mode === "fixed") &&
          value.schedule.status === "planned" &&
          Date.parse(value.schedule.interval.start) < Date.parse(range.end) &&
          Date.parse(value.schedule.interval.end) > Date.parse(range.start) &&
          !scheduleFullyRealized(
            value.schedule,
            prior.map((row) => row.document),
          ),
      );
      const batch = due.slice(0, 128);
      const presence = await readRepositorySql<{ place_ref: string }>(
        options.persistence,
        "SELECT document#>>'{profile,entry,placeRef}' AS place_ref FROM heptalogos.world_profile WHERE subject_id=$1 AND world_id=$2",
        [subjectId, worldId],
      );
      const events = realizeRuleSegments(
        state.definition,
        batch,
        prior.map((row) => row.document),
        range,
        presence[0]?.place_ref,
      );
      if (!events.length)
        return {
          revision: state.revision,
          events: [],
          interval: range,
          coverage: "limited" as const,
        };
      // Calendar rules define only their own slots. Unspecified intervals keep explicit limited coverage.
      const batchRange = {
        ...range,
        end: events.reduce(
          (last, event) =>
            Date.parse(event.interval.end) > Date.parse(last)
              ? event.interval.end
              : last,
          range.start,
        ),
      };
      const patch = {
        operationId: uuidv5(
          `advance:${state.revision}:${range.start}:${range.end}`,
          worldId,
        ),
        subjectId,
        worldId,
        expectedRevision: state.revision,
        interval: batchRange,
        events,
        coverage: "limited" as const,
      };
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, (tx) => realizeIn(tx, patch, world)),
      );
    },
    /** Computes complete coverage from adopted segments, retaining gaps instead of inferring life from a clock. */
    async coverage(
      subjectId: string,
      worldId: string,
      range: { timeDomainRef: string; start: string; end: string },
      asRecordedAt?: string,
    ) {
      const state = await service.read(subjectId, worldId);
      if (!state) conflict("World does not exist");
      interval(range, state.definition.timeDomainRef);
      const rows = await readRepositorySql<{
        document: { interval: typeof range; coverage: "complete" | "limited" };
        recorded_at: Date | string;
      }>(
        options.persistence,
        `SELECT document,recorded_at FROM heptalogos.world_realization WHERE subject_id=$1 AND world_id=$2
AND document->'interval'->>'timeDomainRef'=$3 AND (document->'interval'->>'start')::timestamptz<$5::timestamptz AND (document->'interval'->>'end')::timestamptz>$4::timestamptz
AND ($6::timestamptz IS NULL OR recorded_at<=$6::timestamptz) ORDER BY document->'interval'->>'start' LIMIT 4096`,
        [
          subjectId,
          worldId,
          range.timeDomainRef,
          range.start,
          range.end,
          asRecordedAt ?? null,
        ],
      );
      let cursor = Date.parse(range.start);
      for (const { document } of rows)
        if (
          document.coverage === "complete" &&
          Date.parse(document.interval.start) <= cursor
        )
          cursor = Math.max(cursor, Date.parse(document.interval.end));
      return {
        interval: range,
        coverage:
          cursor >= Date.parse(range.end)
            ? ("complete" as const)
            : rows.length
              ? ("limited" as const)
              : ("gap" as const),
        segments: rows.map((row) => ({
          interval: row.document.interval,
          coverage: row.document.coverage,
          recordedAt: new Date(row.recorded_at).toISOString(),
        })),
      };
    },
    /** Exact structural scene facts for an already authorized narrative consumer. */
    async sceneEvents(
      subjectId: string,
      worldId: string,
      selected: readonly { eventId: string; revision: number }[],
    ) {
      if (selected.length > 128)
        conflict("Scene reads are bounded to 128 exact known events");
      const rows = await readRepositorySql<{ document: RealizedWorldEvent }>(
        options.persistence,
        "SELECT document FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2 AND event_id=ANY($3::uuid[])",
        [subjectId, worldId, selected.map((event) => event.eventId)],
      );
      return rows
        .map((row) => row.document)
        .filter((event) =>
          selected.some(
            (known) =>
              known.eventId === event.eventId && known.revision === event.revision,
          ),
        );
    },
    /** Filters world-author truth before it can enter a Subject's context or retrieval. */
    async query(value: Static<typeof queryWorldSchema>) {
      const input = checked<Static<typeof queryWorldSchema>>(queryWorldSchema, value);
      const history = input.asRecordedAt
        ? await readRepositorySql<{ document: WorldState }>(
            options.persistence,
            "SELECT document FROM heptalogos.world_life_history WHERE subject_id=$1 AND world_id=$2 AND recorded_at<=$3 ORDER BY revision DESC LIMIT 1",
            [input.subjectId, input.worldId, input.asRecordedAt],
          )
        : null;
      const state = history
        ? history[0]?.document
        : await service.read(input.subjectId, input.worldId);
      if (!state) conflict("World does not exist");
      interval(input.interval, state.definition.timeDomainRef);
      if (
        input.knowledgeAtWorldTime &&
        input.knowledgeAtWorldTime.timeDomainRef !== state.definition.timeDomainRef
      )
        conflict("A world knowledge cutoff requires this world's clock domain");
      const rows = await readRepositorySql<{ document: RealizedWorldEvent }>(
        options.persistence,
        `SELECT document FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2
AND occurred_start<$4::timestamptz AND occurred_end>$3::timestamptz
AND ($5::timestamptz IS NULL OR recorded_at<=$5::timestamptz)
AND ($6::uuid IS NULL OR event_id>$6::uuid) ORDER BY event_id LIMIT $7`,
        [
          input.subjectId,
          input.worldId,
          input.interval.start,
          input.interval.end,
          input.asRecordedAt ?? null,
          input.afterEventId ?? null,
          input.limit + 1,
        ],
      );
      const events = rows
        .slice(0, input.limit)
        .map((row) =>
          checked<RealizedWorldEvent>(realizedWorldEventSchema, row.document),
        );
      const actor = state.definition.subjectActorRef;
      const visible = events.flatMap((event) =>
        event.perceptions
          .filter(
            (perception) =>
              perception.actorRef === actor &&
              (!input.knowledgeAtWorldTime ||
                Date.parse(perception.at.at) <=
                  Date.parse(input.knowledgeAtWorldTime.at)),
          )
          .map((perception) => ({
            eventId: event.eventId,
            eventRevision: event.revision,
            worldId: input.worldId,
            interval: event.interval,
            recordedAt: event.recordedAt,
            ...perception,
          })),
      );
      return {
        revision: state.revision,
        view: input.view,
        events: input.view === "world_author" ? events : visible,
        nextEventId:
          rows.length > input.limit ? (events.at(-1)?.eventId ?? null) : null,
      };
    },
  };
  return service;
}
