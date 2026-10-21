// Ported from Hept master 21f00804 world-calendar.ts; RFC set and original recurrence identity retained.
// Copyright 2026 Aravine Zhu; SPDX-License-Identifier: AGPL-3.0-only
import { createRequire } from "node:module";
import { Temporal } from "@js-temporal/polyfill";
import { v5 as uuidv5 } from "uuid";
import { calendarRule } from "@heptalogos/contracts";
import {
  addMicros,
  parseInstant,
  scaleMicros,
  normalizeRate,
} from "@nous-wave/platform/time";
import { problem } from "@nous-wave/platform/errors";
import type { Json } from "../platform/database.js";
const { RRule, RRuleSet } = createRequire(import.meta.url)(
  "rrule",
) as typeof import("rrule");
const namespace = "91cc1ac6-7055-4f26-9e42-9815eac2da85";
const local = (value: string) =>
  Temporal.PlainDateTime.from(value, { overflow: "reject" });
const identity = (value: Temporal.PlainDateTime) =>
  value.toString({ smallestUnit: "second" });
function floating(value: Temporal.PlainDateTime) {
  if (value.millisecond || value.microsecond || value.nanosecond)
    throw problem(
      "world.invalid_rule",
      "validation",
      "RFC5545当地复发身份使用整秒",
    );
  const date = new Date(0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  date.setUTCHours(value.hour, value.minute, value.second, 0);
  return date;
}
const fromFloating = (value: Date) =>
  Temporal.PlainDateTime.from(value.toISOString().slice(0, 19));
export const worldOccurrenceId = (
  worldId: string,
  ruleId: string,
  recurrenceId: string,
) => uuidv5(`${worldId}:${ruleId}:${recurrenceId}`, namespace);
export const addMinutes = (at: string, minutes: number) =>
  addMicros(at, scaleMicros(60_000_000n, normalizeRate(String(minutes))));
function setFor(rule: ReturnType<typeof calendarRule.parse>) {
  const set = new RRuleSet();
  if (rule.rrule) {
    const options = RRule.parseString(rule.rrule);
    if (options.dtstart || options.tzid)
      throw problem(
        "world.invalid_rule",
        "validation",
        "DTSTART与TZID由正式字段提供",
      );
    if (options.until && /UNTIL=\d{8}T\d{6}Z(?:;|$)/.test(rule.rrule))
      options.until = floating(
        Temporal.Instant.from(options.until.toISOString())
          .toZonedDateTimeISO(rule.timezone)
          .toPlainDateTime(),
      );
    set.rrule(new RRule({ ...options, dtstart: floating(local(rule.start)) }));
  } else set.rdate(floating(local(rule.start)));
  for (const value of rule.rdates) set.rdate(floating(local(value)));
  for (const value of rule.exdates) set.exdate(floating(local(value)));
  return set;
}
export function validateCalendarRule(input: unknown) {
  const rule = calendarRule.parse(input);
  try {
    setFor(rule);
    local(rule.start).toZonedDateTime(rule.timezone, {
      disambiguation: rule.disambiguation,
    });
  } catch (error) {
    throw problem(
      "world.invalid_rule",
      "validation",
      "日历需要有效RFC5545与IANA当地时间政策",
    );
  }
  return rule;
}
/** Read-only bounded expansion; moved instances keep their original local recurrence ID. */
export function expandCalendar(
  rules: Json[],
  exceptions: Json[],
  worldId: string,
  from: string,
  to: string,
  limit = 4096,
): Json[] {
  const start = Temporal.Instant.from(parseInstant(from)),
    end = Temporal.Instant.from(parseInstant(to));
  if (Temporal.Instant.compare(start, end) >= 0) return [];
  const result = new Map<string, Json>();
  for (const row of rules) {
    const seriesId = String(row.seriesId ?? row.id),
      rule = validateCalendarRule(row),
      set = setFor(rule),
      before = start
        .toZonedDateTimeISO(rule.timezone)
        .toPlainDateTime()
        .subtract({
          seconds:
            Math.ceil(rule.durationMinutes * 60) + rule.startShiftSeconds,
        }),
      after = end
        .toZonedDateTimeISO(rule.timezone)
        .toPlainDateTime()
        .subtract({ seconds: rule.startShiftSeconds });
    const occurrences = set.between(
      floating(before.round({ smallestUnit: "second", roundingMode: "floor" })),
      floating(after.round({ smallestUnit: "second", roundingMode: "ceil" })),
      true,
      (_date, index) => index <= limit,
    );
    for (const exception of exceptions)
      if (
        exception.ruleId === seriesId &&
        exception.start &&
        typeof exception.recurrenceId === "string" &&
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
      if (
        (row.untilRecurrenceId &&
          recurrenceId >= String(row.untilRecurrenceId)) ||
        (row.effectiveFromRecurrenceId &&
          recurrenceId < String(row.effectiveFromRecurrenceId))
      )
        continue;
      const exception = exceptions.find(
        (value) =>
          value.ruleId === seriesId && value.recurrenceId === recurrenceId,
      );
      if (exception?.cancelled) continue;
      const desired = exception?.start
          ? local(String(exception.start))
          : original.add({ seconds: rule.startShiftSeconds }),
        zoned = desired.toZonedDateTime(rule.timezone, {
          disambiguation: rule.disambiguation,
        }),
        at = parseInstant(zoned.toInstant().toString()),
        finish = exception?.end
          ? parseInstant(
              local(String(exception.end))
                .toZonedDateTime(rule.timezone, {
                  disambiguation: rule.disambiguation,
                })
                .toInstant()
                .toString(),
            )
          : addMinutes(at, rule.durationMinutes);
      if (finish <= from || at >= to) continue;
      const occurrenceId = worldOccurrenceId(worldId, seriesId, recurrenceId);
      result.set(occurrenceId, {
        ...rule,
        ruleId: seriesId,
        ruleVersionId: row.id,
        occurrenceId,
        recurrenceId,
        start: at,
        end: finish,
        offset: zoned.offset,
        timezoneAdjusted: !desired.equals(zoned.toPlainDateTime()),
        ruleRevision: row.version ?? row.revision,
        originalStart: parseInstant(
          original
            .toZonedDateTime(rule.timezone, {
              disambiguation: rule.disambiguation,
            })
            .toInstant()
            .toString(),
        ),
      });
      if (result.size > limit)
        throw problem(
          "world.calendar_limit",
          "resource_pressure",
          "日历展开超过本次上限",
        );
    }
  }
  return [...result.values()].sort(
    (a, b) =>
      String(a.start).localeCompare(String(b.start)) ||
      String(a.occurrenceId).localeCompare(String(b.occurrenceId)),
  );
}
