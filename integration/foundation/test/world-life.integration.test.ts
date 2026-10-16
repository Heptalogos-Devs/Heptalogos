// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { createIdentityService } from "@heptalogos/identity";
import { randomUUID } from "node:crypto";
import { createWorldLifeService, expandWorldRoutines } from "@heptalogos/subject";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("WorldLife canonical realization on real fenced PostgreSQL", () => {
  it("keeps concurrent adoption unique, rejects conflicting places, filters hidden scenes and respects real recording cutoffs without QQ", async () => {
    const current = await composeProductPersistence();
    const subjectId = randomUUID(),
      worldId = randomUUID(),
      scheduleId = randomUUID();
    let at = "2026-10-16T00:50:00.000Z";
    const domain = "domain:school";
    const identity = createIdentityService({ persistence: current.persistence });
    const actor = (await current.run(() => identity.ensureSubjectEntity({ subjectId })))
      .entityRef;
    const teacher = (
      await current.run(() =>
        identity.resolveWorldActor({ worldId, actorKey: "teacher" }),
      )
    ).entityRef;
    expect(
      (
        await current.run(() =>
          identity.resolveWorldActor({ worldId, actorKey: "teacher" }),
        )
      ).entityRef,
    ).toBe(teacher);
    expect(
      (
        await current.run(() =>
          identity.resolveWorldActor({ worldId: randomUUID(), actorKey: "teacher" }),
        )
      ).entityRef,
    ).not.toBe(teacher);
    await expect(
      current.run(() =>
        identity.linkAccount({
          platform: "qq",
          accountId: "not-a-real-account",
          entityRef: teacher,
        }),
      ),
    ).rejects.toMatchObject({ problem: { problemCode: "identity.link_conflict" } });
    const life = createWorldLifeService({
      persistence: current.persistence,
      now: () => at,
      worldNow: async () => ({ timeDomainRef: domain, at: "2026-10-16T03:00:00.000Z" }),
    });
    const range = {
      timeDomainRef: domain,
      start: "2026-10-16T00:00:00.000Z",
      end: "2026-10-16T00:45:00.000Z",
    };
    const definition = {
      subjectId,
      worldId,
      revision: 1,
      name: "School",
      timeDomainRef: domain,
      timezone: "Asia/Shanghai",
      offlinePolicy: "simulate_elapsed" as const,
      places: [
        { placeRef: "class", name: "Classroom", description: "A classroom" },
        { placeRef: "home", name: "Home", description: "A home" },
      ],
      actors: [
        { entityRef: actor, name: "Student", description: "The current subject role" },
        { entityRef: teacher, name: "Teacher", description: "A virtual teacher" },
      ],
      subjectActorRef: actor,
      rules: "Lessons follow the adopted schedule",
      creationScope: "Virtual school events only",
      informationSourceRefs: [],
    };
    try {
      const state = await current.run(() =>
        life.configure({
          operationId: randomUUID(),
          expectedRevision: 0,
          definition,
          schedule: [
            {
              scheduleId,
              interval: range,
              title: "Math",
              description: "A planned math lesson",
              actorRefs: [actor, teacher],
              placeRef: "class",
              activityId: null,
              sourceRefs: [],
              status: "planned",
              overlap: "exclusive",
            },
          ],
        }),
      );
      expect((await life.prepareAdvance(subjectId, worldId)).state.revision).toBe(
        state.revision,
      );
      expect(
        (
          await life.query({
            subjectId,
            worldId,
            interval: range,
            view: "world_author",
            limit: 20,
          })
        ).events,
      ).toHaveLength(0);
      at = "2026-10-16T01:00:00.000Z";
      const event = {
        eventId: randomUUID(),
        interval: range,
        title: "Math lesson",
        content: "Hidden teacher plan: surprise quiz tomorrow",
        actorRefs: [actor, teacher],
        placeRef: "class",
        scheduleId,
        parentEventId: null,
        causalEventRefs: [],
        overlap: "exclusive" as const,
        source: {
          kind: "rule" as const,
          producerRef: "world:school-rule",
          sourceRefs: [],
        },
        perceptions: [
          {
            actorRef: actor,
            kind: "seen" as const,
            at: { timeDomainRef: domain, at: range.start },
            content: "I attended the math lesson",
          },
        ],
      };
      const patch = {
        operationId: randomUUID(),
        subjectId,
        worldId,
        expectedRevision: 1,
        interval: range,
        events: [event],
        coverage: "complete" as const,
      };
      const copies = await current.run(() =>
        Promise.all([life.realize(patch), life.realize(patch)]),
      );
      expect(copies[0]).toEqual(copies[1]);
      expect((await life.coverage(subjectId, worldId, range)).coverage).toBe(
        "complete",
      );
      expect(
        (await life.coverage(subjectId, worldId, range, "2026-10-16T00:59:00.000Z"))
          .coverage,
      ).toBe("gap");
      const subject = await life.query({
        subjectId,
        worldId,
        interval: range,
        view: "subject",
        limit: 20,
      });
      expect(JSON.stringify(subject)).toContain("I attended");
      expect(JSON.stringify(subject)).not.toContain("surprise quiz");
      expect(
        (
          await life.query({
            subjectId,
            worldId,
            interval: range,
            view: "subject",
            asRecordedAt: "2026-10-16T00:59:00.000Z",
            limit: 20,
          })
        ).events,
      ).toHaveLength(0);
      await expect(
        current.run(() =>
          life.realize({
            ...patch,
            operationId: randomUUID(),
            expectedRevision: 2,
            events: [{ ...event, eventId: randomUUID(), placeRef: "home" }],
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "world.conflict" } });
      at = "2026-10-16T02:00:00.000Z";
      const detail = {
        ...event,
        eventId: randomUUID(),
        parentEventId: event.eventId,
        interval: {
          ...range,
          start: "2026-10-16T00:20:00.000Z",
          end: "2026-10-16T00:21:00.000Z",
        },
        title: "Question",
        content: "The teacher asked a question",
        perceptions: [
          {
            actorRef: actor,
            kind: "seen" as const,
            at: { timeDomainRef: domain, at: "2026-10-16T00:20:00.000Z" },
            content: "I answered a question",
          },
        ],
      };
      await current.run(() =>
        life.realize({
          ...patch,
          operationId: randomUUID(),
          expectedRevision: 2,
          events: [detail],
        }),
      );
      expect(
        (
          await life.query({
            subjectId,
            worldId,
            interval: range,
            view: "subject",
            knowledgeAtWorldTime: { timeDomainRef: domain, at: range.end },
            limit: 20,
          })
        ).events,
      ).toHaveLength(2);
      expect(
        (
          await life.query({
            subjectId,
            worldId,
            interval: range,
            view: "subject",
            asRecordedAt: "2026-10-16T01:30:00.000Z",
            limit: 20,
          })
        ).events,
      ).toHaveLength(1);
      expect(await life.pendingContacts(subjectId, worldId)).toHaveLength(2);
      await current.run(() =>
        life.acknowledgeContact({
          subjectId,
          worldId,
          eventId: event.eventId,
          contactRef: "contact:actual",
        }),
      );
      expect(await life.pendingContacts(subjectId, worldId)).toHaveLength(1);
      await expect(
        current.run(() =>
          life.acknowledgeContact({
            subjectId,
            worldId,
            eventId: event.eventId,
            contactRef: "contact:different",
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "world.conflict" } });
      const routine = {
        ruleId: randomUUID(),
        title: "Break",
        content: "A fixed break in the courtyard",
        subjectPerception: "I rested in the courtyard",
        localStart: "10:00",
        durationMinutes: 15,
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        validFrom: "2026-10-16",
        validUntil: "2026-10-17",
        actorRefs: [actor],
        placeRef: "home",
        activityId: null,
        mode: "fixed" as const,
      };
      await current.run(() =>
        life.configure({
          operationId: randomUUID(),
          expectedRevision: 3,
          definition: { ...definition, revision: 2, routineRules: [routine] },
          schedule: [],
        }),
      );
      const ruleRange = {
        timeDomainRef: domain,
        start: "2026-10-16T01:30:00.000Z",
        end: "2026-10-16T03:00:00.000Z",
      };
      const firstRules = await current.run(() =>
        life.advanceRules(subjectId, worldId, ruleRange),
      );
      expect(firstRules.events).toHaveLength(1);
      expect(firstRules.events[0]?.interval.start).toBe("2026-10-16T02:00:00.000Z");
      expect(
        (await current.run(() => life.advanceRules(subjectId, worldId, ruleRange)))
          .events,
      ).toHaveLength(0);
      expect((await life.prepareAdvance(subjectId, worldId)).nextOpportunity?.at).toBe(
        "2026-10-17T02:00:00.000Z",
      );
      const dst = expandWorldRoutines(
        {
          ...definition,
          timezone: "America/New_York",
          routineRules: [
            {
              ...routine,
              localStart: "08:00",
              validFrom: "2026-03-07",
              validUntil: "2026-03-09",
            },
          ],
        },
        {
          timeDomainRef: domain,
          start: "2026-03-07T00:00:00.000Z",
          end: "2026-03-09T23:59:59.000Z",
        },
      );
      expect(dst.map((item) => item.schedule.interval.start)).toEqual([
        "2026-03-07T13:00:00.000Z",
        "2026-03-08T12:00:00.000Z",
        "2026-03-09T12:00:00.000Z",
      ]);
    } finally {
      await current.close();
    }
  });
});
