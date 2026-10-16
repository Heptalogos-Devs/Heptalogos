// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Calendar expansion uses Temporal's IANA/DST rules; the owner decides realization. @module world-calendar */
import { Temporal } from "@js-temporal/polyfill";
import { v5 as uuidv5 } from "uuid";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import type {
  worldIntervalSchema,
  worldScheduleItemSchema,
  worldRoutineRuleSchema,
  WorldDefinition,
} from "./world-contracts.js";
import { subjectProblem } from "./problems.js";
const namespace = "91cc1ac6-7055-4f26-9e42-9815eac2da85";
/** Stable occurrence identity changes when a rule's local date changes, never on restart. */
export function worldOccurrenceId(worldId: string, ruleId: string, date: string) {
  return uuidv5(`${worldId}:${ruleId}:${date}`, namespace);
}
/** Validates adopted calendar semantics before persistence rather than accepting normalized impossible dates. */
export function validateWorldRoutines(definition: WorldDefinition): void {
  for (const rule of definition.routineRules ?? []) {
    const first = Temporal.PlainDate.from(rule.validFrom),
      last = Temporal.PlainDate.from(rule.validUntil);
    if (
      Temporal.PlainDate.compare(first, last) > 0 ||
      !definition.places.some((place) => place.placeRef === rule.placeRef) ||
      rule.actorRefs.some(
        (actor) => !definition.actors.some((known) => known.entityRef === actor),
      )
    )
      throw subjectProblem(
        "world.invalid_rule",
        "Invalid world calendar rule",
        "Use ordered actual dates and adopted world entities",
        "validation",
      );
  }
  if (
    new Set((definition.routineRules ?? []).map((rule) => rule.ruleId)).size !==
    (definition.routineRules ?? []).length
  )
    throw subjectProblem(
      "world.invalid_rule",
      "Duplicate world calendar rule",
      "Use stable distinct rule identities",
      "validation",
    );
}
/** Finite calendar projection preserves local daily meaning across offset transitions. */
export function expandWorldRoutines(
  definition: WorldDefinition,
  interval: Static<typeof worldIntervalSchema>,
): {
  schedule: Static<typeof worldScheduleItemSchema>;
  rule: Static<typeof worldRoutineRuleSchema>;
}[] {
  const start = Temporal.Instant.from(interval.start),
    end = Temporal.Instant.from(interval.end);
  if (
    interval.timeDomainRef !== definition.timeDomainRef ||
    Temporal.Instant.compare(start, end) >= 0 ||
    end.epochMilliseconds - start.epochMilliseconds > 32 * 86400000
  )
    throw subjectProblem(
      "world.invalid_interval",
      "Calendar range is unavailable",
      "Use at most 32 increasing days in the adopted world domain",
      "validation",
    );
  let date = start
    .toZonedDateTimeISO(definition.timezone)
    .toPlainDate()
    .subtract({ days: 1 });
  const last = end.toZonedDateTimeISO(definition.timezone).toPlainDate();
  const result: ReturnType<typeof expandWorldRoutines> = [];
  for (; Temporal.PlainDate.compare(date, last) <= 0; date = date.add({ days: 1 }))
    for (const rule of definition.routineRules ?? []) {
      if (
        !rule.weekdays.includes(date.dayOfWeek) ||
        Temporal.PlainDate.compare(date, rule.validFrom) < 0 ||
        Temporal.PlainDate.compare(date, rule.validUntil) > 0
      )
        continue;
      const local = date.toPlainDateTime(Temporal.PlainTime.from(rule.localStart));
      // Explicit policy: shift a skipped local time forward and choose the earlier repeated time.
      const begin = local
        .toZonedDateTime(definition.timezone, { disambiguation: "compatible" })
        .toInstant();
      const finish = begin.add({ minutes: rule.durationMinutes });
      if (
        Temporal.Instant.compare(begin, end) >= 0 ||
        Temporal.Instant.compare(finish, start) <= 0
      )
        continue;
      result.push({
        rule,
        schedule: {
          scheduleId: worldOccurrenceId(
            definition.worldId,
            rule.ruleId,
            date.toString(),
          ),
          interval: {
            timeDomainRef: definition.timeDomainRef,
            start: begin.toString({ fractionalSecondDigits: 3 }),
            end: finish.toString({ fractionalSecondDigits: 3 }),
          },
          title: rule.title,
          description: rule.content,
          actorRefs: rule.actorRefs,
          placeRef: rule.placeRef,
          activityId: rule.activityId,
          sourceRefs: [`world-rule:${definition.worldId}:${rule.ruleId}`],
          status: "planned",
          overlap: "exclusive",
        },
      });
    }
  return result.sort((a, b) =>
    a.schedule.interval.start.localeCompare(b.schedule.interval.start),
  );
}
