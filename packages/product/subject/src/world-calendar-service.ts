// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reads the canonical calendar and applies local series changes without model execution.
 * @module world-calendar-service
 */
import { Temporal } from "@js-temporal/polyfill";
import { createSubjectSchemaReader } from "./checked-schema.js";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { readRepositorySql } from "@heptalogos/persistence/repository";
import type { PersistenceService } from "@heptalogos/persistence";
import {
  worldStateSchema,
  realizedWorldEventSchema,
  type WorldState,
  type WorldDefinition,
  type RealizedWorldEvent,
} from "./world-contracts.js";
import {
  readCalendarSchema,
  type CalendarResult,
  type ReadCalendar,
  type ChangeCalendar,
} from "./world-calendar-contracts.js";
import {
  expandWorldRoutines,
  worldOccurrenceId,
  isWorldRecurrence,
} from "./world-calendar.js";
import { subjectProblem } from "./problems.js";
function invalid(detail: string): never {
  throw subjectProblem(
    "world.calendar_conflict",
    "Calendar operation is unavailable",
    detail,
    "conflict",
  );
}
const parse = createSubjectSchemaReader(() =>
  invalid("Read the canonical calendar contract"),
);
/** The default display window follows the world's clock and IANA timezone. */
export function worldCalendarWindow(
  instant: string,
  timezone: string,
  period: "today" | "week",
) {
  const now = Temporal.Instant.from(instant).toZonedDateTimeISO(timezone);
  const day = now.startOfDay();
  const start = period === "week" ? day.subtract({ days: day.dayOfWeek - 1 }) : day;
  return {
    start: start.toInstant().toString(),
    end: start
      .add({ days: period === "week" ? 7 : 1 })
      .toInstant()
      .toString(),
  };
}
/** Reads a stable time/key page from any finite world interval without writing future instances. */
export async function readWorldCalendar(
  options: { persistence: PersistenceService },
  value: ReadCalendar,
): Promise<CalendarResult> {
  const input = parse<ReadCalendar>(readCalendarSchema, value);
  const worldRows = await readRepositorySql<{ document: unknown }>(
    options.persistence,
    input.asRecordedAt
      ? "SELECT document FROM heptalogos.world_life_history WHERE subject_id=$1 AND world_id=$2 AND recorded_at<=$3 ORDER BY revision DESC LIMIT 1"
      : "SELECT document FROM heptalogos.world_life WHERE subject_id=$1 AND world_id=$2",
    input.asRecordedAt
      ? [input.subjectId, input.worldId, input.asRecordedAt]
      : [input.subjectId, input.worldId],
  );
  if (!worldRows[0])
    invalid("The adopted world is unavailable at this recording cutoff");
  const state = parse<WorldState>(worldStateSchema, worldRows[0].document);
  if (
    state.definition.timeDomainRef !== input.interval.timeDomainRef ||
    Date.parse(input.interval.start) >= Date.parse(input.interval.end)
  )
    invalid("Use an increasing range in this world's actual domain");
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.displayTimezone }).format();
  } catch {
    invalid("Use an actual display timezone");
  }
  const { continuation, ...basis } = input;
  const queryDigest = digestCanonicalJson(
    "world.calendar-query.v1",
    basis as unknown as CanonicalJsonValue,
  ).hex;
  let after: { at: string; id: string } | undefined;
  if (continuation) {
    let saved: unknown;
    try {
      saved = JSON.parse(Buffer.from(continuation, "base64url").toString("utf8"));
    } catch {
      invalid("Invalid calendar continuation");
    }
    if (
      !saved ||
      typeof saved !== "object" ||
      !("revision" in saved) ||
      saved.revision !== state.revision ||
      !("queryDigest" in saved) ||
      saved.queryDigest !== queryDigest ||
      !("at" in saved) ||
      typeof saved.at !== "string" ||
      !Number.isFinite(Date.parse(saved.at)) ||
      !("id" in saved) ||
      typeof saved.id !== "string"
    )
      invalid("The query or calendar revision changed; read the range again");
    after = { at: saved.at, id: saved.id };
  }
  if (input.perspective === "public") {
    const visibility = await readRepositorySql<{ public_calendar: string }>(
      options.persistence,
      "SELECT document#>>'{profile,publicCalendar}' AS public_calendar FROM heptalogos.world_profile WHERE subject_id=$1 AND world_id=$2",
      [input.subjectId, input.worldId],
    );
    if (visibility[0]?.public_calendar === "none")
      return {
        worldId: input.worldId,
        revision: state.revision,
        interval: input.interval,
        displayTimezone: input.displayTimezone,
        items: [],
        continuation: null,
      };
  }
  const eligible = (plan: WorldState["schedule"][number]) =>
    (!input.actorRef || plan.actorRefs.includes(input.actorRef)) &&
    (!input.activityId || plan.activityId === input.activityId);
  const plans =
    input.view === "lived"
      ? []
      : [
          ...expandWorldRoutines(
            state.definition,
            input.interval,
            input.limit + 1,
            after,
          )
            .filter(
              ({ rule }) =>
                input.perspective === "world_author" ||
                (input.perspective === "public"
                  ? rule.visibility === "public"
                  : rule.visibility !== "world_author" &&
                    rule.actorRefs.includes(state.definition.subjectActorRef)),
            )
            .map((item) => item.schedule),
          ...state.schedule.filter(
            (plan) =>
              input.perspective === "world_author" ||
              (input.perspective === "subject" &&
                plan.actorRefs.includes(state.definition.subjectActorRef)),
          ),
        ].filter(
          (plan) =>
            eligible(plan) &&
            Date.parse(plan.interval.start) < Date.parse(input.interval.end) &&
            Date.parse(plan.interval.end) > Date.parse(input.interval.start),
        );
  const items = new Map<string, CalendarResult["items"][number]>();
  for (const plan of plans) {
    if (
      after &&
      (Date.parse(plan.interval.start) < Date.parse(after.at) ||
        (Date.parse(plan.interval.start) === Date.parse(after.at) &&
          plan.scheduleId <= after.id))
    )
      continue;
    const visible =
      input.perspective === "public"
        ? {
            ...plan,
            title: "Busy",
            description: "",
            actorRefs: [],
            placeRef: "undisclosed",
            activityId: null,
            sourceRefs: [],
            ruleRef: undefined,
          }
        : plan;
    items.set(plan.scheduleId, {
      instanceId: plan.scheduleId,
      interval: plan.interval,
      localStart: "",
      localEnd: "",
      status: plan.status,
      planned: visible,
      lived: [],
      recordedAt: state.updatedAt,
      sourceRefs: visible.sourceRefs,
    });
  }
  if (input.view !== "planned" && input.perspective !== "public") {
    const rows = await readRepositorySql<{ instance_id: string; documents: unknown[] }>(
      options.persistence,
      `SELECT COALESCE(e.document->>'scheduleId',e.event_id::text) AS instance_id,jsonb_agg(e.document ORDER BY e.occurred_start,e.event_id) AS documents
      FROM heptalogos.world_event e WHERE e.subject_id=$1 AND e.world_id=$2 AND e.time_domain_ref=$3 AND e.occurred_start<$5::timestamptz AND e.occurred_end>$4::timestamptz
      AND ($6::text IS NULL OR e.document->'actorRefs' ? $6) AND ($7::text IS NULL OR e.document->>'activityId'=$7)
      AND ($8::timestamptz IS NULL OR e.recorded_at<=$8) AND ($9::text='world_author' OR EXISTS(SELECT 1 FROM heptalogos.world_contact_release r WHERE r.subject_id=e.subject_id AND r.world_id=e.world_id AND r.event_id=e.event_id AND r.state='released'))
      GROUP BY COALESCE(e.document->>'scheduleId',e.event_id::text)
      HAVING ($10::timestamptz IS NULL OR (min(e.occurred_start),COALESCE(e.document->>'scheduleId',e.event_id::text))>($10::timestamptz,$11::text))
      ORDER BY min(e.occurred_start),instance_id LIMIT $12`,
      [
        input.subjectId,
        input.worldId,
        input.interval.timeDomainRef,
        input.interval.start,
        input.interval.end,
        input.actorRef ?? null,
        input.activityId ?? null,
        input.asRecordedAt ?? null,
        input.perspective,
        after?.at ?? null,
        after?.id ?? null,
        input.limit + 1,
      ],
    );
    for (const row of rows) {
      const events = row.documents.map((document) =>
        parse<RealizedWorldEvent>(realizedWorldEventSchema, document),
      );
      const first = events[0]!;
      const lived =
        input.perspective === "world_author"
          ? events
          : events.flatMap((event) =>
              event.perceptions
                .filter((p) => p.actorRef === state.definition.subjectActorRef)
                .map((p) => ({
                  eventId: event.eventId,
                  eventRevision: event.revision,
                  worldId: input.worldId,
                  interval: event.interval,
                  recordedAt: event.recordedAt,
                  ...p,
                })),
            );
      if (!lived.length) continue;
      const existing = items.get(row.instance_id);
      items.set(row.instance_id, {
        instanceId: row.instance_id,
        interval: first.interval,
        localStart: "",
        localEnd: "",
        status: existing ? "realized" : "unplanned",
        planned: existing?.planned ?? null,
        lived,
        recordedAt: first.recordedAt,
        sourceRefs: events.map(
          (event) => `world-event:${input.worldId}:${event.eventId}:${event.revision}`,
        ),
      });
    }
  }
  const ordered = [...items.values()].sort(
    (a, b) =>
      Date.parse(a.interval.start) - Date.parse(b.interval.start) ||
      a.instanceId.localeCompare(b.instanceId),
  );
  const page = ordered.slice(0, input.limit).map((item) => ({
    ...item,
    localStart: Temporal.Instant.from(item.interval.start)
      .toZonedDateTimeISO(input.displayTimezone)
      .toString(),
    localEnd: Temporal.Instant.from(item.interval.end)
      .toZonedDateTimeISO(input.displayTimezone)
      .toString(),
  }));
  const tail = page.at(-1);
  return {
    worldId: input.worldId,
    revision: state.revision,
    interval: input.interval,
    displayTimezone: input.displayTimezone,
    items: page,
    continuation:
      ordered.length > input.limit && tail
        ? Buffer.from(
            JSON.stringify({
              revision: state.revision,
              queryDigest,
              at: tail.interval.start,
              id: tail.instanceId,
            }),
          ).toString("base64url")
        : null,
  };
}
/** Preserves original recurrence identities while revising a future effective range or one instance. */
export function applyCalendarChange(
  definition: WorldDefinition,
  input: ChangeCalendar,
  realizedScheduleIds: ReadonlySet<string>,
  realizedEvents: readonly RealizedWorldEvent[] = [],
  worldAt?: string,
): WorldDefinition {
  const rules = definition.routineRules ?? [];
  const current = rules.find(
    (rule) =>
      rule.ruleId === input.ruleId &&
      !rule.archived &&
      (!rule.effectiveFrom || input.recurrenceId >= rule.effectiveFrom) &&
      (!rule.effectiveUntil || input.recurrenceId < rule.effectiveUntil),
  );
  if (!current)
    invalid("The original recurrence identity has no effective adopted rule");
  const instanceId = worldOccurrenceId(
    definition.worldId,
    input.ruleId,
    input.recurrenceId,
  );
  if (!isWorldRecurrence(current, input.recurrenceId))
    invalid("The recurrence identity is not in this adopted RFC set");
  const existingException = definition.calendarExceptions?.find(
    (value) =>
      value.ruleId === input.ruleId && value.recurrenceId === input.recurrenceId,
  );
  const originalAt = Temporal.PlainDateTime.from(
    existingException?.startLocal ?? input.recurrenceId,
  )
    .add({ seconds: existingException?.startLocal ? 0 : current.startShiftSeconds })
    .toZonedDateTime(current.timezone, { disambiguation: current.disambiguation })
    .toInstant();
  const occurrence = expandWorldRoutines(definition, {
    timeDomainRef: definition.timeDomainRef,
    start: originalAt.subtract({ hours: 24 * 8 }).toString(),
    end: originalAt.add({ hours: 24 * 8 }).toString(),
  }).find((item) => item.schedule.scheduleId === instanceId)?.schedule;
  if (worldAt && occurrence) {
    const now = Date.parse(worldAt),
      start = Date.parse(occurrence.interval.start),
      end = Date.parse(occurrence.interval.end);
    if (end <= now || (input.scope !== "this" && start < now))
      invalid(
        "Elapsed arrangements remain fixed even when their realization is missing; choose a future recurrence",
      );
    if (start < now) {
      const changed = input.change;
      const unchangedStart =
        !changed.startLocal ||
        Temporal.PlainDateTime.from(changed.startLocal).toZonedDateTime(
          current.timezone,
          { disambiguation: current.disambiguation },
        ).epochMilliseconds === start;
      if (
        !unchangedStart ||
        changed.placeRef ||
        changed.actorRefs ||
        changed.status === "cancelled" ||
        !changed.durationMinutes ||
        start + changed.durationMinutes * 60000 < now
      )
        invalid(
          "An ongoing arrangement can change only its unelapsed duration; its elapsed prefix stays fixed",
        );
    }
    if (
      input.change.startLocal &&
      Temporal.PlainDateTime.from(input.change.startLocal).toZonedDateTime(
        current.timezone,
        { disambiguation: current.disambiguation },
      ).epochMilliseconds < now &&
      start >= now
    )
      invalid("A future arrangement cannot be moved into elapsed world time");
  }
  if (
    input.scope === "this" &&
    realizedScheduleIds.has(instanceId) &&
    (!worldAt ||
      !occurrence ||
      Date.parse(occurrence.interval.start) >= Date.parse(worldAt))
  )
    invalid("An already realized instance cannot be moved or cancelled");
  const original = Temporal.PlainDateTime.from(input.recurrenceId),
    changed = input.change;
  if (
    occurrence &&
    changed.durationMinutes &&
    realizedEvents.some(
      (event) =>
        event.scheduleId === instanceId &&
        Date.parse(event.interval.end) >
          Date.parse(occurrence.interval.start) + changed.durationMinutes! * 60000,
    )
  )
    invalid("A changed tail cannot remove an already recorded interval");
  if (input.scope === "this")
    return {
      ...definition,
      revision: definition.revision + 1,
      calendarExceptions: [
        ...(definition.calendarExceptions ?? []).filter(
          (value) =>
            !(
              value.ruleId === input.ruleId && value.recurrenceId === input.recurrenceId
            ),
        ),
        {
          exceptionId: input.operationId,
          ruleId: input.ruleId,
          recurrenceId: input.recurrenceId,
          ...changed,
          reason: input.reason,
        },
      ],
    };
  const protectedInstances = new Map(
    (definition.calendarExceptions ?? []).map((value) => [
      `${value.ruleId}:${value.recurrenceId}`,
      value,
    ]),
  );
  for (const event of realizedEvents) {
    if (!event.scheduleId) continue;
    const candidate = expandWorldRoutines(definition, event.interval).find(
      (item) =>
        item.schedule.scheduleId === event.scheduleId &&
        item.rule.ruleId === input.ruleId,
    );
    const reference = candidate?.schedule.ruleRef;
    if (!candidate || !reference || reference.recurrenceId < input.recurrenceId)
      continue;
    const key = `${input.ruleId}:${reference.recurrenceId}`;
    protectedInstances.set(key, {
      ...protectedInstances.get(key),
      exceptionId: protectedInstances.get(key)?.exceptionId ?? event.eventId,
      ruleId: input.ruleId,
      recurrenceId: reference.recurrenceId,
      preserveRuleRevision: candidate.rule.revision,
      status: candidate.schedule.status,
      reason: "Preserve the adopted arrangement of the already realized instance",
    });
  }
  const shift = changed.startLocal
    ? Temporal.PlainDateTime.from(changed.startLocal)
        .since(original)
        .total({ unit: "seconds" })
    : current.startShiftSeconds;
  let nextRevision = Math.max(
    ...rules
      .filter((rule) => rule.ruleId === input.ruleId)
      .map((rule) => rule.revision),
  );
  const revised: typeof rules = [];
  for (const rule of rules) {
    if (
      rule.ruleId !== input.ruleId ||
      rule.archived ||
      (rule.effectiveUntil && rule.effectiveUntil <= input.recurrenceId)
    ) {
      revised.push(rule);
      continue;
    }
    if (!rule.effectiveFrom || rule.effectiveFrom < input.recurrenceId)
      revised.push({ ...rule, effectiveUntil: input.recurrenceId });
    else revised.push({ ...rule, archived: true });
    revised.push({
      ...rule,
      archived: false,
      revision: ++nextRevision,
      effectiveFrom:
        rule.effectiveFrom && rule.effectiveFrom > input.recurrenceId
          ? rule.effectiveFrom
          : input.recurrenceId,
      cancelled: changed.status === "cancelled",
      startShiftSeconds: changed.startLocal ? shift : rule.startShiftSeconds,
      ...(changed.durationMinutes ? { durationMinutes: changed.durationMinutes } : {}),
      ...(changed.placeRef ? { placeRef: changed.placeRef } : {}),
      ...(changed.actorRefs ? { actorRefs: changed.actorRefs } : {}),
    });
  }
  return {
    ...definition,
    revision: definition.revision + 1,
    calendarExceptions: [...protectedInstances.values()],
    routineRules: revised,
  };
}

/** A replacement schedule may revise a future tail, never erase an elapsed arrangement. */
export function preserveElapsedSchedule(
  current: WorldState["schedule"],
  next: WorldState["schedule"],
  worldAt: string,
): void {
  const now = Date.parse(worldAt);
  for (const old of current) {
    if (Date.parse(old.interval.start) >= now) continue;
    const replacement = next.find((item) => item.scheduleId === old.scheduleId);
    if (!replacement)
      invalid("Keep elapsed arrangements, including plans with no realization");
    const prefix = (item: typeof old) => ({
      ...item,
      interval: {
        ...item.interval,
        end: new Date(Math.min(Date.parse(item.interval.end), now)).toISOString(),
      },
    });
    if (
      digestCanonicalJson(
        "world.schedule-prefix.v1",
        prefix(old) as unknown as CanonicalJsonValue,
      ).hex !==
      digestCanonicalJson(
        "world.schedule-prefix.v1",
        prefix(replacement) as unknown as CanonicalJsonValue,
      ).hex
    )
      invalid("Only the future tail of an ongoing arrangement can change");
  }
  for (const item of next)
    if (
      !current.some((old) => old.scheduleId === item.scheduleId) &&
      Date.parse(item.interval.start) < now
    )
      invalid(
        "New arrangements start in the future; append late facts through realization",
      );
}
/** Existing rules retain historical content; new versions become effective in the future. */
export function preserveElapsedRules(
  current: WorldDefinition,
  next: WorldDefinition,
  worldAt: string,
): void {
  const now = Temporal.Instant.from(worldAt);
  const at = (
    value: string,
    rule: NonNullable<WorldDefinition["routineRules"]>[number],
  ) =>
    Temporal.PlainDateTime.from(value)
      .toZonedDateTime(rule.timezone, { disambiguation: rule.disambiguation })
      .toInstant();
  for (const rule of current.routineRules ?? []) {
    const replacement = next.routineRules?.find(
      (item) => item.ruleId === rule.ruleId && item.revision === rule.revision,
    );
    if (
      Temporal.Instant.compare(
        at(rule.effectiveFrom ?? rule.startsAtLocal, rule).add({
          seconds: rule.startShiftSeconds,
        }),
        now,
      ) >= 0
    )
      continue;
    if (!replacement)
      invalid("Keep historical rule revisions; revise a future effective range");
    const historical = (item: typeof rule) => ({ ...item, effectiveUntil: null });
    if (
      digestCanonicalJson(
        "world.rule-history.v1",
        historical(rule) as unknown as CanonicalJsonValue,
      ).hex !==
        digestCanonicalJson(
          "world.rule-history.v1",
          historical(replacement) as unknown as CanonicalJsonValue,
        ).hex ||
      (replacement.effectiveUntil !== rule.effectiveUntil &&
        (!replacement.effectiveUntil ||
          Temporal.Instant.compare(
            at(replacement.effectiveUntil, rule).add({
              seconds: rule.startShiftSeconds,
            }),
            now,
          ) < 0))
    )
      invalid("Existing rule content is historical; adopt a new future revision");
  }
  for (const rule of next.routineRules ?? [])
    if (
      !current.routineRules?.some(
        (old) => old.ruleId === rule.ruleId && old.revision === rule.revision,
      ) &&
      Temporal.Instant.compare(
        at(rule.effectiveFrom ?? rule.startsAtLocal, rule).add({
          seconds: rule.startShiftSeconds,
        }),
        now,
      ) < 0
    )
      invalid("New rule revisions cannot start in elapsed world time");
  for (const exception of current.calendarExceptions ?? []) {
    const rule = current.routineRules?.find((item) => item.ruleId === exception.ruleId);
    if (
      rule &&
      Temporal.Instant.compare(
        at(exception.startLocal ?? exception.recurrenceId, rule),
        now,
      ) < 0 &&
      digestCanonicalJson(
        "world.exception-history.v1",
        exception as unknown as CanonicalJsonValue,
      ).hex !==
        digestCanonicalJson(
          "world.exception-history.v1",
          (next.calendarExceptions?.find(
            (item) => item.exceptionId === exception.exceptionId,
          ) ?? null) as unknown as CanonicalJsonValue,
        ).hex
    )
      invalid("Keep elapsed calendar exceptions and their sources");
  }
  for (const exception of next.calendarExceptions ?? []) {
    const rule = next.routineRules?.find((item) => item.ruleId === exception.ruleId);
    if (
      rule &&
      !current.calendarExceptions?.some(
        (old) => old.exceptionId === exception.exceptionId,
      ) &&
      Temporal.Instant.compare(
        at(exception.startLocal ?? exception.recurrenceId, rule),
        now,
      ) < 0
    )
      invalid("New calendar exceptions cannot rewrite elapsed arrangements");
  }
}
