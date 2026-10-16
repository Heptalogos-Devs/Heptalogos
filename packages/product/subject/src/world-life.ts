// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Owns world truth, finite realization and actor-visible projections. @module world-life */
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import {
  executeRepositorySql,
  readRepositorySql,
  useRepositoryMutationTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import {
  acknowledgeWorldContactSchema,
  configureWorldSchema,
  queryWorldSchema,
  realizeWorldSchema,
  realizedWorldEventSchema,
  type WorldLifeOptions,
  type WorldState,
  type RealizedWorldEvent,
} from "./world-contracts.js";
import { subjectProblem } from "./problems.js";
import { expandWorldRoutines, validateWorldRoutines } from "./world-calendar.js";
import { v5 as uuidv5 } from "uuid";

function conflict(detail: string): never {
  throw subjectProblem("world.conflict", "World patch is not admissible", detail);
}
function checked<T>(schema: Parameters<typeof compileSchema<T>>[0], value: unknown): T {
  const result = compileSchema<T>(schema).validate(value);
  if (!result.ok)
    throw subjectProblem(
      "world.invalid_input",
      "Invalid world request",
      "Read the world operation schema",
      "validation",
    );
  return result.value;
}
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
    const result = {
      revision: next.revision,
      events,
      interval: input.interval,
      coverage: input.coverage,
    };
    await saveOperation(tx, input, input, result, at);
    return result;
  };
  const service = {
    /** Same transaction owner operation for atomic narrative adoption. */
    realizeIn,
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
    async configure(value: Static<typeof configureWorldSchema>) {
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
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
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
          if (
            current &&
            current.definition.timeDomainRef !== input.definition.timeDomainRef
          )
            conflict("Existing world history cannot be moved to another clock domain");
          if (input.definition.revision !== (current?.definition.revision ?? 0) + 1)
            conflict("Adopt the next explicit definition revision");
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
        }),
      );
    },
    /** Realization does not infer that planned events actually occurred. */
    async realize(value: Static<typeof realizeWorldSchema>) {
      const world = await options.worldNow(value.subjectId);
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, (tx) => realizeIn(tx, value, world)),
      );
    },
    /** Produces the finite author frame; Subject inputs must use the filtered query instead. */
    async prepareAdvance(subjectId: string, worldId: string) {
      const [state, world] = await Promise.all([
        service.read(subjectId, worldId),
        options.worldNow(subjectId),
      ]);
      if (!state || state.definition.timeDomainRef !== world.timeDomainRef)
        conflict("World and current clock must share a declared domain");
      const upcoming = {
        timeDomainRef: world.timeDomainRef,
        start: new Date(Date.parse(world.at) - 2 * 3600000).toISOString(),
        end: new Date(Date.parse(world.at) + 24 * 3600000).toISOString(),
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
      return {
        state,
        world,
        schedule,
        recentEvents: recent.events,
        nextOpportunity: future[0]
          ? { timeDomainRef: world.timeDomainRef, at: future[0] }
          : null,
        role: "world.planner" as const,
        contactNature: "execution_only" as const,
      };
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
    ) {
      const { state, world } = await service.prepareAdvance(subjectId, worldId);
      interval(range, state.definition.timeDomainRef);
      if (Date.parse(range.end) > Date.parse(world.at))
        conflict("Rules cannot realize future planned life");
      const expanded = expandWorldRoutines(state.definition, range);
      const prior = await readRepositorySql<{ document: RealizedWorldEvent }>(
        options.persistence,
        "SELECT document FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2 AND occurred_start<$4::timestamptz AND occurred_end>$3::timestamptz",
        [subjectId, worldId, range.start, range.end],
      );
      const done = new Set(
        prior.flatMap((row) =>
          row.document.scheduleId ? [row.document.scheduleId] : [],
        ),
      );
      const due = expanded.filter(
        (value) =>
          value.rule.mode === "fixed" &&
          Date.parse(value.schedule.interval.start) >= Date.parse(range.start) &&
          Date.parse(value.schedule.interval.end) <= Date.parse(range.end) &&
          !done.has(value.schedule.scheduleId),
      );
      const batch = due.slice(0, 128);
      if (!batch.length)
        return {
          revision: state.revision,
          events: [],
          interval: range,
          coverage: "limited" as const,
        };
      const events = batch.map(({ rule, schedule }) => ({
        eventId: uuidv5(`event:${schedule.scheduleId}`, worldId),
        interval: schedule.interval,
        title: rule.title,
        content: rule.content,
        actorRefs: rule.actorRefs,
        placeRef: rule.placeRef,
        scheduleId: schedule.scheduleId,
        parentEventId: null,
        causalEventRefs: [],
        overlap: "exclusive" as const,
        source: {
          kind: "rule" as const,
          producerRef: `world-rule:${worldId}:${rule.ruleId}`,
          sourceRefs: schedule.sourceRefs,
        },
        perceptions:
          rule.subjectPerception &&
          rule.actorRefs.includes(state.definition.subjectActorRef)
            ? [
                {
                  actorRef: state.definition.subjectActorRef,
                  kind: "seen" as const,
                  at: {
                    timeDomainRef: range.timeDomainRef,
                    at: schedule.interval.start,
                  },
                  content: rule.subjectPerception,
                },
              ]
            : [],
      }));
      // Calendar rules define only their own slots. Unspecified intervals keep explicit limited coverage.
      const batchRange =
        due.length > 128
          ? {
              ...range,
              end: batch.reduce(
                (latest, item) =>
                  Date.parse(item.schedule.interval.end) > Date.parse(latest)
                    ? item.schedule.interval.end
                    : latest,
                range.start,
              ),
            }
          : range;
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
    /** Filters recent visible state against actual accepted releases in one owner read. */
    async releasedEventIds(
      subjectId: string,
      worldId: string,
      eventIds: readonly string[],
    ) {
      if (eventIds.length > 128)
        conflict("Release lookups are bounded to the current 128-event view");
      const rows = await readRepositorySql<{ event_id: string }>(
        options.persistence,
        "SELECT event_id FROM heptalogos.world_contact_release WHERE subject_id=$1 AND world_id=$2 AND event_id=ANY($3::uuid[])",
        [subjectId, worldId, eventIds],
      );
      return rows.map((row) => row.event_id);
    },
    /** Retries only contact handoff, never realization or external effects. */
    async pendingContacts(subjectId: string, worldId: string, limit = 64) {
      const state = await service.read(subjectId, worldId);
      if (!state) conflict("World does not exist");
      const rows = await readRepositorySql<{ document: RealizedWorldEvent }>(
        options.persistence,
        `SELECT e.document FROM heptalogos.world_event e LEFT JOIN heptalogos.world_contact_release r USING(subject_id,world_id,event_id)
WHERE e.subject_id=$1 AND e.world_id=$2 AND r.event_id IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(e.document->'perceptions') p WHERE p->>'actorRef'=$3) ORDER BY e.event_id LIMIT $4`,
        [
          subjectId,
          worldId,
          state.definition.subjectActorRef,
          Math.max(1, Math.min(limit, 128)),
        ],
      );
      return rows.map((row) => ({
        sourceRef: `world-event:${worldId}:${row.document.eventId}:${row.document.revision}`,
        eventId: row.document.eventId,
        eventRevision: row.document.revision,
        worldId,
        interval: row.document.interval,
        recordedAt: row.document.recordedAt,
        source: row.document.source,
        perceptions: row.document.perceptions.filter(
          (p) => p.actorRef === state.definition.subjectActorRef,
        ),
      }));
    },
    /** Records the actual official contact receipt, preserving one event identity on retry. */
    async acknowledgeContact(value: Static<typeof acknowledgeWorldContactSchema>) {
      const input = checked<Static<typeof acknowledgeWorldContactSchema>>(
        acknowledgeWorldContactSchema,
        value,
      );
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await lockSubjectNarrative(tx, input.subjectId);
          const state = await readIn(tx, input.subjectId, input.worldId);
          const events = await executeRepositorySql<{ document: RealizedWorldEvent }>(
            tx,
            "SELECT document FROM heptalogos.world_event WHERE subject_id=$1 AND world_id=$2 AND event_id=$3",
            [input.subjectId, input.worldId, input.eventId],
          );
          if (
            !state ||
            !events[0]?.document.perceptions.some(
              (p) => p.actorRef === state.definition.subjectActorRef,
            )
          )
            conflict(
              "Only a realized Subject-visible event can become a Subject contact",
            );
          await executeRepositorySql(
            tx,
            "INSERT INTO heptalogos.world_contact_release(subject_id,world_id,event_id,contact_ref,recorded_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
            [
              input.subjectId,
              input.worldId,
              input.eventId,
              input.contactRef,
              options.now(),
            ],
          );
          const rows = await executeRepositorySql<{ contact_ref: string }>(
            tx,
            "SELECT contact_ref FROM heptalogos.world_contact_release WHERE subject_id=$1 AND world_id=$2 AND event_id=$3",
            [input.subjectId, input.worldId, input.eventId],
          );
          if (rows[0]?.contact_ref !== input.contactRef)
            conflict(
              "This event is already released through another canonical contact",
            );
          return { contactRef: input.contactRef };
        }),
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
