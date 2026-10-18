// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Expands RFC 5545 sets with rrule; Temporal owns explicit IANA/DST conversion.
 * @module world-calendar
 */
import { Temporal } from "@js-temporal/polyfill";
import recurrence = require("rrule");
import { v5 as uuidv5 } from "uuid";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import { worldAttendancePolicy } from "./world-contracts.js";
import type {
  worldIntervalSchema,
  worldScheduleItemSchema,
  worldRoutineRuleSchema,
  WorldDefinition,
} from "./world-contracts.js";
import { subjectProblem } from "./problems.js";
const { RRule, RRuleSet } = recurrence;
const namespace = "91cc1ac6-7055-4f26-9e42-9815eac2da85";
type Rule = Static<typeof worldRoutineRuleSchema>;
function invalid(detail: string): never {
  throw subjectProblem(
    "world.invalid_rule",
    "Invalid world calendar rule",
    detail,
    "validation",
  );
}
const local = (value: string) =>
  Temporal.PlainDateTime.from(value, { overflow: "reject" });
const identity = (value: Temporal.PlainDateTime) =>
  value.toString({ smallestUnit: "second" });
// rrule's documented floating UTC representation is a local recurrence coordinate, never a real UTC stamp.
const floating = (value: Temporal.PlainDateTime) =>
  new Date(
    Date.UTC(
      value.year,
      value.month - 1,
      value.day,
      value.hour,
      value.minute,
      value.second,
    ),
  );
const fromFloating = (value: Date) =>
  Temporal.PlainDateTime.from(value.toISOString().slice(0, 19));
function setFor(rule: Rule) {
  const set = new RRuleSet();
  if (rule.rrule) {
    const options = RRule.parseString(rule.rrule);
    if (options.dtstart || options.tzid)
      invalid("DTSTART and timezone are supplied by the formal rule fields");
    // RFC UNTIL ending in Z is an actual instant; compare it in the series' local coordinate.
    if (options.until && /UNTIL=\d{8}T\d{6}Z(?:;|$)/.test(rule.rrule))
      options.until = floating(
        Temporal.Instant.from(options.until.toISOString())
          .toZonedDateTimeISO(rule.timezone)
          .toPlainDateTime(),
      );
    set.rrule(new RRule({ ...options, dtstart: floating(local(rule.startsAtLocal)) }));
  } else set.rdate(floating(local(rule.startsAtLocal)));
  for (const value of rule.rdates) set.rdate(floating(local(value)));
  for (const value of rule.exdates) set.exdate(floating(local(value)));
  return set;
}
/** Checks an exact original instance against its adopted RFC set, without materializing a range. */
export function isWorldRecurrence(rule: Rule, recurrenceId: string): boolean {
  const point = floating(local(recurrenceId));
  return (
    (!rule.validThrough || recurrenceId.slice(0, 10) <= rule.validThrough) &&
    setFor(rule).between(point, point, true).length === 1
  );
}
/** Stable instance ID uses the original RECURRENCE-ID, independent of revisions and new start time. */
export function worldOccurrenceId(
  worldId: string,
  ruleId: string,
  recurrenceId: string,
) {
  return uuidv5(`${worldId}:${ruleId}:${recurrenceId}`, namespace);
}
/** Validates rule sets and nonoverlapping revision ranges before adoption. */
export function validateWorldRoutines(definition: WorldDefinition): void {
  const versions = new Set<string>();
  for (const rule of definition.routineRules ?? []) {
    try {
      setFor(rule);
      const policy = worldAttendancePolicy(rule);
      if (
        policy.mode === "strict" &&
        (policy.startToleranceMinutes ||
          policy.earlyMinutes ||
          policy.lateMinutes ||
          policy.interruptEvents.some(
            (kind) => kind === "social" || kind === "important",
          ))
      )
        invalid(
          "Strict attendance uses zero start offsets and only explicit exceptions or official changes",
        );
      const start = local(rule.startsAtLocal);
      start.toZonedDateTime(rule.timezone, { disambiguation: rule.disambiguation });
      if (
        rule.validThrough &&
        Temporal.PlainDate.compare(
          start.toPlainDate(),
          Temporal.PlainDate.from(rule.validThrough),
        ) > 0
      )
        invalid("The recurrence end precedes its start");
      if (
        rule.effectiveFrom &&
        rule.effectiveUntil &&
        Temporal.PlainDateTime.compare(
          local(rule.effectiveFrom),
          local(rule.effectiveUntil),
        ) >= 0
      )
        invalid("Use an increasing recurrence identity revision range");
    } catch (error) {
      if (error instanceof Error && "problem" in error) throw error;
      invalid("Use a valid RFC 5545 rule and IANA local date/time policy");
    }
    if (
      !definition.places.some((p) => p.placeRef === rule.placeRef) ||
      rule.actorRefs.some(
        (actor) => !definition.actors.some((p) => p.entityRef === actor),
      )
    )
      invalid("Use adopted world entities and places");
    const key = `${rule.ruleId}:${rule.revision}`;
    if (versions.has(key)) invalid("A rule revision is duplicated");
    versions.add(key);
    for (const other of definition.routineRules ?? []) {
      if (
        other === rule ||
        other.ruleId !== rule.ruleId ||
        other.archived ||
        rule.archived
      )
        continue;
      if (
        (!rule.effectiveUntil ||
          !other.effectiveFrom ||
          rule.effectiveUntil > other.effectiveFrom) &&
        (!other.effectiveUntil ||
          !rule.effectiveFrom ||
          other.effectiveUntil > rule.effectiveFrom)
      )
        invalid("Effective revisions of one series cannot overlap");
    }
  }
  for (const exception of definition.calendarExceptions ?? []) {
    local(exception.recurrenceId);
    if (exception.startLocal) local(exception.startLocal);
    if (
      !(definition.routineRules ?? []).some((rule) => rule.ruleId === exception.ruleId)
    )
      invalid("An exception must name an adopted series");
    if (
      exception.placeRef &&
      !definition.places.some((place) => place.placeRef === exception.placeRef)
    )
      invalid("An exception names an unknown place");
    if (
      exception.actorRefs?.some(
        (actor) => !definition.actors.some((known) => known.entityRef === actor),
      )
    )
      invalid("An exception names an unknown actor");
  }
  if (
    new Set(
      (definition.calendarExceptions ?? []).map(
        (value) => `${value.ruleId}:${value.recurrenceId}`,
      ),
    ).size !== (definition.calendarExceptions ?? []).length
  )
    invalid("Only one current exception may own a recurrence identity");
}
/** Read-only bounded expansion accepts any finite range; it never materializes future instances. */
export function expandWorldRoutines(
  definition: WorldDefinition,
  range: Static<typeof worldIntervalSchema>,
  limit = 4096,
  after?: { at: string; id: string },
): { schedule: Static<typeof worldScheduleItemSchema>; rule: Rule }[] {
  const start = Temporal.Instant.from(range.start),
    end = Temporal.Instant.from(range.end);
  if (
    range.timeDomainRef !== definition.timeDomainRef ||
    Temporal.Instant.compare(start, end) >= 0
  )
    invalid("Use an increasing range in the adopted world domain");
  const result = new Map<string, ReturnType<typeof expandWorldRoutines>[number]>();
  for (const rule of definition.routineRules ?? []) {
    const set = setFor(rule);
    const from = (after ? Temporal.Instant.from(after.at) : start)
      .toZonedDateTimeISO(rule.timezone)
      .toPlainDateTime()
      .subtract({
        seconds: rule.startShiftSeconds + (after ? 0 : rule.durationMinutes * 60),
      });
    const to = end
      .toZonedDateTimeISO(rule.timezone)
      .toPlainDateTime()
      .subtract({ seconds: rule.startShiftSeconds });
    const occurrences = set.between(
      floating(from),
      floating(to),
      true,
      (_date, index) => index <= limit,
    );
    for (const exception of definition.calendarExceptions ?? [])
      if (
        exception.ruleId === rule.ruleId &&
        exception.startLocal &&
        set.between(
          floating(local(exception.recurrenceId)),
          floating(local(exception.recurrenceId)),
          true,
        ).length
      )
        occurrences.push(floating(local(exception.recurrenceId)));
    for (const occurrence of occurrences) {
      const original = fromFloating(occurrence),
        recurrenceId = identity(original);
      const exception = (definition.calendarExceptions ?? []).find(
        (value) => value.ruleId === rule.ruleId && value.recurrenceId === recurrenceId,
      );
      if (rule.archived && exception?.preserveRuleRevision !== rule.revision) continue;
      if (
        exception?.preserveRuleRevision &&
        exception.preserveRuleRevision !== rule.revision
      )
        continue;
      if (
        !exception?.preserveRuleRevision &&
        ((rule.effectiveFrom && recurrenceId < rule.effectiveFrom) ||
          (rule.effectiveUntil && recurrenceId >= rule.effectiveUntil))
      )
        continue;
      if (rule.validThrough && original.toPlainDate().toString() > rule.validThrough)
        continue;
      const desired = exception?.startLocal
        ? local(exception.startLocal)
        : original.add({ seconds: rule.startShiftSeconds });
      const zoned = desired.toZonedDateTime(rule.timezone, {
        disambiguation: rule.disambiguation,
      });
      const begin = zoned.toInstant(),
        finish = begin.add({
          minutes: exception?.durationMinutes ?? rule.durationMinutes,
        });
      if (
        Temporal.Instant.compare(begin, end) >= 0 ||
        Temporal.Instant.compare(finish, start) <= 0
      )
        continue;
      const originalBegin = original
        .toZonedDateTime(rule.timezone, { disambiguation: rule.disambiguation })
        .toInstant();
      const scheduleId = worldOccurrenceId(
        definition.worldId,
        rule.ruleId,
        recurrenceId,
      );
      if (
        after &&
        (begin.epochMilliseconds < Date.parse(after.at) ||
          (begin.epochMilliseconds === Date.parse(after.at) && scheduleId <= after.id))
      )
        continue;
      result.set(scheduleId, {
        rule,
        schedule: {
          scheduleId,
          ruleRef: {
            ruleId: rule.ruleId,
            revision: rule.revision,
            recurrenceId,
            originalInterval: {
              timeDomainRef: definition.timeDomainRef,
              start: originalBegin.toString(),
              end: originalBegin.add({ minutes: rule.durationMinutes }).toString(),
            },
            timezoneAdjusted: !desired.equals(zoned.toPlainDateTime()),
            exceptionId: exception?.exceptionId ?? null,
          },
          interval: {
            timeDomainRef: definition.timeDomainRef,
            start: begin.toString({ fractionalSecondDigits: 3 }),
            end: finish.toString({ fractionalSecondDigits: 3 }),
          },
          attendancePolicy: worldAttendancePolicy(rule),
          title: rule.title,
          description: rule.content,
          actorRefs: exception?.actorRefs ?? rule.actorRefs,
          placeRef: exception?.placeRef ?? rule.placeRef,
          activityId: rule.activityId,
          sourceRefs: [
            `world-rule:${definition.worldId}:${rule.ruleId}:${rule.revision}`,
          ],
          status: exception?.status ?? (rule.cancelled ? "cancelled" : "planned"),
          overlap: "exclusive",
        },
      });
    }
  }
  return [...result.values()].sort(
    (a, b) =>
      a.schedule.interval.start.localeCompare(b.schedule.interval.start) ||
      a.schedule.scheduleId.localeCompare(b.schedule.scheduleId),
  );
}
