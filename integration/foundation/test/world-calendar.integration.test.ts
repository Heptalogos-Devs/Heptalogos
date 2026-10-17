// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createWorldLifeService,
  worldOccurrenceId,
  type WorldDefinition,
} from "@heptalogos/subject";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("RFC calendar instance and revision ownership", () => {
  it("merges RRULE/RDATE/EXDATE, pages a long read-only range, and preserves original identities through single/future edits", async () => {
    const current = await composeProductPersistence(),
      subjectId = randomUUID(),
      worldId = randomUUID(),
      ruleId = randomUUID();
    const actor = "entity:heptalogos:" + randomUUID();
    const worlds = createWorldLifeService({
      persistence: current.persistence,
      now: () => new Date().toISOString(),
      worldNow: async () => ({
        timeDomainRef: "school",
        at: "2026-04-20T00:00:00.000Z",
      }),
    });
    const definition: WorldDefinition = {
      worldId,
      subjectId,
      revision: 1,
      name: "School",
      timeDomainRef: "school",
      timezone: "America/New_York",
      offlinePolicy: "simulate_elapsed",
      places: [{ placeRef: "class", name: "Class", description: "Classroom" }],
      actors: [{ entityRef: actor, name: "Student", description: "Current student" }],
      subjectActorRef: actor,
      rules: "Study",
      creationScope: "School",
      informationSourceRefs: [],
      routineRules: [
        {
          ruleId,
          revision: 1,
          title: "Math",
          content: "Math lesson",
          subjectPerception: "I attended math",
          startsAtLocal: "2026-03-06T08:00:00",
          timezone: "America/New_York",
          rrule: "FREQ=WEEKLY;BYDAY=MO,FR",
          rdates: ["2026-03-08T08:00:00"],
          exdates: ["2026-03-09T08:00:00"],
          validThrough: "2026-03-30",
          effectiveFrom: null,
          effectiveUntil: null,
          startShiftSeconds: 0,
          disambiguation: "compatible",
          durationMinutes: 45,
          actorRefs: [actor],
          placeRef: "class",
          activityId: null,
          kind: "study",
          visibility: "subject",
          adjustable: false,
          mode: "choice",
        },
      ],
    };
    try {
      await current.run(() =>
        worlds.configure({
          operationId: randomUUID(),
          expectedRevision: 0,
          definition,
          schedule: [],
        }),
      );
      const read = {
        subjectId,
        worldId,
        interval: {
          timeDomainRef: "school",
          start: "2026-03-01T00:00:00.000Z",
          end: "2026-04-20T00:00:00.000Z",
        },
        view: "planned" as const,
        perspective: "subject" as const,
        displayTimezone: "America/New_York",
        limit: 2,
      };
      let page = await worlds.readCalendar(read);
      const items = [...page.items];
      while (page.continuation) {
        page = await worlds.readCalendar({ ...read, continuation: page.continuation });
        items.push(...page.items);
      }
      expect(new Set(items.map((item) => item.instanceId)).size).toBe(items.length);
      expect(items[0]?.interval.start).toBe("2026-03-06T13:00:00.000Z");
      expect(items[1]?.interval.start).toBe("2026-03-08T12:00:00.000Z");
      expect(items.some((item) => item.localStart.startsWith("2026-03-09"))).toBe(
        false,
      );
      expect((await worlds.read(subjectId, worldId))?.revision).toBe(1);
      const movedId = worldOccurrenceId(worldId, ruleId, "2026-03-08T08:00:00");
      const change = {
        operationId: randomUUID(),
        subjectId,
        worldId,
        expectedRevision: 1,
        ruleId,
        recurrenceId: "2026-03-08T08:00:00",
        scope: "this" as const,
        change: { startLocal: "2026-03-09T09:00:00", status: "planned" as const },
        reason: "Make-up lesson",
      };
      await current.run(() => worlds.changeCalendar(change));
      expect(await current.run(() => worlds.changeCalendar(change))).toEqual(
        await worlds.read(subjectId, worldId),
      );
      const after = await worlds.readCalendar({ ...read, limit: 128 });
      expect(
        after.items.find((item) => item.instanceId === movedId)?.localStart,
      ).toMatch(/^2026-03-09T09:00:00/);
      await current.run(() =>
        worlds.changeCalendar({
          ...change,
          operationId: randomUUID(),
          expectedRevision: 2,
          scope: "future",
          recurrenceId: "2026-03-13T08:00:00",
          change: { startLocal: "2026-03-13T08:30:00", status: "planned" },
        }),
      );
      const future = await worlds.readCalendar({ ...read, limit: 128 });
      expect(
        future.items.find(
          (item) =>
            item.instanceId ===
            worldOccurrenceId(worldId, ruleId, "2026-03-16T08:00:00"),
        )?.localStart,
      ).toMatch(/^2026-03-16T08:30:00/);
      expect(
        future.items.find((item) => item.instanceId === movedId)?.localStart,
      ).toMatch(/^2026-03-09T09:00:00/);
      expect(future.items.map((item) => item.instanceId)).toHaveLength(
        new Set(future.items.map((item) => item.instanceId)).size,
      );
      const first = items[0]!;
      const event = {
        eventId: randomUUID(),
        interval: first.interval,
        title: "Actual math",
        content: "The actual lesson content",
        actorRefs: [actor],
        placeRef: "class",
        scheduleId: first.instanceId,
        parentEventId: null,
        causalEventRefs: [],
        overlap: "exclusive" as const,
        source: {
          kind: "rule" as const,
          producerRef: "actual:math-rule",
          sourceRefs: [],
        },
        perceptions: [
          {
            actorRef: actor,
            kind: "seen" as const,
            at: { timeDomainRef: "school", at: first.interval.start },
            content: "I attended this class",
          },
        ],
      };
      await current.run(() =>
        worlds.realize({
          operationId: randomUUID(),
          subjectId,
          worldId,
          expectedRevision: 3,
          interval: first.interval,
          events: [event],
          coverage: "complete",
        }),
      );
      const author = await worlds.readCalendar({
        ...read,
        view: "combined",
        perspective: "world_author",
        limit: 128,
      });
      expect(
        author.items.find((item) => item.instanceId === first.instanceId)?.status,
      ).toBe("realized");
      const unseen = await worlds.readCalendar({ ...read, view: "lived", limit: 128 });
      expect(unseen.items).toHaveLength(0);
      const runId = "native:actual-calendar-reader";
      const selected = await current.run(() =>
        worlds.selectContact({ subjectId, worldId, eventId: event.eventId, runId }),
      );
      await current.run(() =>
        worlds.acknowledgeContact({
          subjectId,
          worldId,
          eventId: event.eventId,
          runId,
          contactRef: selected.contactRef,
        }),
      );
      expect(
        (await worlds.readCalendar({ ...read, view: "lived", limit: 128 })).items[0]
          ?.lived,
      ).toEqual([expect.objectContaining({ content: "I attended this class" })]);
      await current.run(() =>
        worlds.changeCalendar({
          ...change,
          operationId: randomUUID(),
          expectedRevision: 4,
          scope: "unrealized",
          recurrenceId: "2026-03-06T08:00:00",
          change: { startLocal: "2026-03-06T07:30:00", status: "planned" },
        }),
      );
      const preserved = await worlds.readCalendar({ ...read, limit: 128 });
      expect(
        preserved.items.find((item) => item.instanceId === first.instanceId)?.interval
          .start,
      ).toBe(first.interval.start);
      expect(
        preserved.items.find(
          (item) =>
            item.instanceId ===
            worldOccurrenceId(worldId, ruleId, "2026-03-16T08:00:00"),
        )?.localStart,
      ).toMatch(/^2026-03-16T07:30:00/);
      await expect(
        current.run(() =>
          worlds.changeCalendar({
            ...change,
            operationId: randomUUID(),
            expectedRevision: 5,
            recurrenceId: "2026-03-06T08:00:00",
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "world.calendar_conflict" } });
    } finally {
      await current.close();
    }
  });
});
