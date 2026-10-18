// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createWorldLifeService, type WorldDefinition } from "@heptalogos/subject";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);

async function calendar() {
  const current = await composeProductPersistence();
  const subjectId = randomUUID(),
    worldId = randomUUID(),
    ruleId = randomUUID();
  let at = "2026-03-06T12:00:00.000Z";
  const worlds = createWorldLifeService({
    persistence: current.persistence,
    now: () => new Date().toISOString(),
    worldNow: async () => ({ timeDomainRef: "school", at }),
  });
  const definition: WorldDefinition = {
    subjectId,
    worldId,
    revision: 1,
    name: "Configured virtual school",
    timeDomainRef: "school",
    timezone: "America/New_York",
    offlinePolicy: "simulate_elapsed",
    subjectActorRef: "self",
    actors: [
      { entityRef: "self", name: "Student", description: "Existing virtual role" },
    ],
    places: [{ placeRef: "class", name: "Class", description: "Configured room" }],
    rules: "Configured courses",
    creationScope: "Virtual course",
    informationSourceRefs: [],
    routineRules: [
      {
        ruleId,
        revision: 1,
        title: "Math",
        content: "Math",
        subjectPerception: "Math",
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
        durationMinutes: 40,
        actorRefs: ["self"],
        placeRef: "class",
        activityId: null,
        kind: "study",
        visibility: "subject",
        adjustable: false,
        mode: "fixed",
      },
    ],
  };
  await current.run(() =>
    worlds.configure({
      operationId: randomUUID(),
      expectedRevision: 0,
      definition,
      schedule: [],
    }),
  );
  const read = () =>
    worlds.readCalendar({
      subjectId,
      worldId,
      interval: {
        timeDomainRef: "school",
        start: "2026-03-01T00:00:00Z",
        end: "2026-04-01T00:00:00Z",
      },
      view: "combined",
      perspective: "world_author",
      displayTimezone: "America/New_York",
      limit: 128,
    });
  const change = {
    operationId: randomUUID(),
    subjectId,
    worldId,
    expectedRevision: 1,
    ruleId,
    recurrenceId: "2026-03-06T08:00:00",
    scope: "this" as const,
    change: { startLocal: "2026-03-06T09:00:00", status: "planned" as const },
    reason: "Operator revision",
  };
  return {
    current,
    worlds,
    definition,
    read,
    change,
    setAt: (value: string) => {
      at = value;
    },
  };
}

real("calendar time ownership", () => {
  it("keeps elapsed plans immutable without requiring a realization row", async () => {
    const c = await calendar();
    try {
      const original = await c.read();
      c.setAt("2026-03-07T12:00:00Z");
      await expect(
        c.current.run(() => c.worlds.changeCalendar(c.change)),
      ).rejects.toMatchObject({ problem: { problemCode: "world.calendar_conflict" } });
      await expect(
        c.current.run(() =>
          c.worlds.configure({
            operationId: randomUUID(),
            expectedRevision: 1,
            definition: { ...c.definition, revision: 2, routineRules: [] },
            schedule: [],
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "world.calendar_conflict" } });
      expect(await c.read()).toEqual(original);
      expect(original.items[0]?.lived).toEqual([]);
    } finally {
      await c.current.close();
    }
  });

  it("revises future recurrences across DST and only changes an ongoing future tail", async () => {
    const c = await calendar();
    try {
      const before = await c.read();
      expect(before.items[0]?.interval.start).toBe("2026-03-06T13:00:00.000Z");
      expect(before.items[1]?.interval.start).toBe("2026-03-08T12:00:00.000Z");
      expect(
        before.items.some((item) => item.localStart.startsWith("2026-03-09")),
      ).toBe(false);
      const change = {
        ...c.change,
        recurrenceId: "2026-03-13T08:00:00",
        scope: "future" as const,
        change: { startLocal: "2026-03-13T08:30:00", status: "planned" as const },
      };
      await c.current.run(() => c.worlds.changeCalendar(change));
      const revised = await c.read();
      expect(revised.items[0]).toEqual(
        expect.objectContaining({
          instanceId: before.items[0]!.instanceId,
          interval: before.items[0]!.interval,
        }),
      );
      const course = revised.items.find((item) =>
        item.localStart.startsWith("2026-03-13"),
      )!;
      expect(course.localStart).toMatch(/^2026-03-13T08:30:00/);
      c.setAt("2026-03-13T12:45:00Z");
      await c.current.run(() =>
        c.worlds.changeCalendar({
          ...change,
          operationId: randomUUID(),
          expectedRevision: 2,
          scope: "this",
          change: { durationMinutes: 60, status: "planned" },
        }),
      );
      const tail = (await c.read()).items.find(
        (item) => item.instanceId === course.instanceId,
      )!;
      expect(tail.interval.start).toBe(course.interval.start);
      expect(tail.interval.end).toBe("2026-03-13T13:30:00.000Z");
    } finally {
      await c.current.close();
    }
  });
});
