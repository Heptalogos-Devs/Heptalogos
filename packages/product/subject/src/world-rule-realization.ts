// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Realizes adopted attendance against actual competing activity and autonomous presence.
 * @module world-rule-realization
 */
import { v5 as uuidv5 } from "uuid";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import { worldAttendancePolicy } from "./world-contracts.js";
import type {
  WorldDefinition,
  RealizedWorldEvent,
  worldScheduleItemSchema,
  worldEventInputSchema,
} from "./world-contracts.js";
import type { expandWorldRoutines } from "./world-calendar.js";
import { worldIntervalBoundaries } from "./world-interval-boundaries.js";
type Plan = Static<typeof worldScheduleItemSchema>;
/** A partial participation record does not close the unrecorded remainder of a course. */
export function scheduleFullyRealized(
  plan: Plan,
  events: readonly RealizedWorldEvent[],
): boolean {
  let cursor = Date.parse(plan.interval.start);
  for (const event of events
    .filter((event) => event.scheduleId === plan.scheduleId)
    .sort((a, b) => Date.parse(a.interval.start) - Date.parse(b.interval.start))) {
    if (Date.parse(event.interval.start) > cursor) return false;
    cursor = Math.max(cursor, Date.parse(event.interval.end));
  }
  return cursor >= Date.parse(plan.interval.end);
}
/** Uses only realized physical activity; a skipped course remains a rule and gets an honest missed segment. */
export function realizeRuleSegments(
  definition: WorldDefinition,
  entries: ReturnType<typeof expandWorldRoutines>,
  prior: readonly RealizedWorldEvent[],
  range: { start: string; end: string },
  initialPlaceRef?: string,
): Static<typeof worldEventInputSchema>[] {
  const result: Static<typeof worldEventInputSchema>[] = [];
  for (const { rule, schedule } of entries) {
    const start = Math.max(
        Date.parse(schedule.interval.start),
        Date.parse(range.start),
      ),
      end = Math.min(Date.parse(schedule.interval.end), Date.parse(range.end));
    if (start >= end) continue;
    const related = prior.filter(
      (event) =>
        Date.parse(event.interval.start) < end &&
        Date.parse(event.interval.end) > start,
    );
    const boundaries = worldIntervalBoundaries(start, end, related);
    for (let index = 1; index < boundaries.length; index++) {
      const left = boundaries[index - 1]!,
        right = boundaries[index]!;
      const existing = related.filter(
        (event) =>
          Date.parse(event.interval.start) < right &&
          Date.parse(event.interval.end) > left,
      );
      if (existing.some((event) => event.scheduleId === schedule.scheduleId)) continue;
      const blocking = existing.filter(
        (event) =>
          event.actorRefs.includes(definition.subjectActorRef) &&
          event.scheduleId !== schedule.scheduleId &&
          !event.parentEventId &&
          (event.energy?.participation === "primary" || event.overlap === "exclusive"),
      );
      const previous = prior
        .filter(
          (event) =>
            event.actorRefs.includes(definition.subjectActorRef) &&
            !event.parentEventId &&
            (event.energy?.participation === "primary" ||
              event.overlap === "exclusive") &&
            Date.parse(event.interval.end) <= left,
        )
        .sort(
          (a, b) =>
            Date.parse(b.interval.end) - Date.parse(a.interval.end) ||
            b.eventId.localeCompare(a.eventId),
        )[0];
      const place = previous?.placeRef ?? initialPlaceRef;
      const attended =
        !rule.actorRefs.includes(definition.subjectActorRef) ||
        (blocking.length === 0 &&
          (worldAttendancePolicy(rule).mode !== "autonomous" ||
            !place ||
            place === rule.placeRef));
      const actors = attended
        ? rule.actorRefs
        : rule.actorRefs.filter((actor) => actor !== definition.subjectActorRef);
      const interval = {
        timeDomainRef: schedule.interval.timeDomainRef,
        start: new Date(left).toISOString(),
        end: new Date(right).toISOString(),
      };
      result.push({
        eventId: uuidv5(
          `event:${schedule.scheduleId}:${left}:${right}:${attended}`,
          definition.worldId,
        ),
        interval,
        title: attended ? rule.title : `${rule.title}: Subject absent`,
        content: attended
          ? rule.content
          : "The Subject did not attend this scheduled segment; this does not infer unobserved teaching content or other participants' actions",
        actorRefs: actors,
        placeRef: rule.placeRef,
        scheduleId: schedule.scheduleId,
        scheduleOutcome: attended ? "completed" : "missed",
        parentEventId: null,
        causalEventRefs: blocking.map((event) => event.eventId),
        overlap: "concurrent",
        source: {
          kind: "rule",
          producerRef: `world-rule:${definition.worldId}:${rule.ruleId}:${rule.revision}`,
          sourceRefs: schedule.sourceRefs,
        },
        ...(actors.includes(definition.subjectActorRef)
          ? {
              energy: {
                kind: rule.kind,
                participation: "primary",
                delta: 0,
                reason: "",
              },
            }
          : {}),
        perceptions:
          attended &&
          rule.subjectPerception &&
          actors.includes(definition.subjectActorRef)
            ? [
                {
                  actorRef: definition.subjectActorRef,
                  kind: "seen",
                  at: { timeDomainRef: interval.timeDomainRef, at: interval.start },
                  content: rule.subjectPerception,
                },
              ]
            : [],
      });
      if (result.length >= 128) return result;
    }
  }
  return result;
}
