// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from "vitest";
import { createIdentityService } from "@heptalogos/identity";
import { randomUUID } from "node:crypto";
import { createWorldLifeService, createLifeService } from "@heptalogos/subject";
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
      const hidden = {
        ...event,
        eventId: randomUUID(),
        actorRefs: [teacher],
        parentEventId: event.eventId,
        overlap: "concurrent" as const,
        perceptions: [
          {
            actorRef: teacher,
            kind: "seen" as const,
            at: { timeDomainRef: domain, at: range.start },
            content: "A private teacher thought",
          },
        ],
      };
      const patch = {
        operationId: randomUUID(),
        subjectId,
        worldId,
        expectedRevision: 1,
        interval: range,
        events: [event, hidden],
        coverage: "complete" as const,
      };
      const copies = await current.run(() =>
        Promise.all([life.realize(patch), life.realize(patch)]),
      );
      expect(copies[0]).toEqual(copies[1]);
      const exactSource = `world-event:${worldId}:${event.eventId}:1`;
      expect(
        await life.resolveSourceRefs({
          subjectId,
          sourceRefs: [
            `world:${worldId}`,
            exactSource,
            `world-event:${worldId}:${event.eventId}:99`,
            `world-event:${worldId}:${hidden.eventId}:1`,
            `world:${randomUUID()}`,
          ],
        }),
      ).toEqual([`world:${worldId}`, exactSource]);
      expect(
        await life.resolveSourceRefs({
          subjectId: randomUUID(),
          sourceRefs: [`world:${worldId}`, exactSource],
        }),
      ).toEqual([]);

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
      const activityScope = {
        conversations: [],
        sourceRefs: [`world:${worldId}`],
        tools: [],
        maxRunMs: 60000,
      };
      const activities = createLifeService({
        persistence: current.persistence,
        now: () => at,
        worldNow: async () => ({
          timeDomainRef: domain,
          at: "2026-10-16T03:00:00.000Z",
        }),
        scopeAuthority: async () => activityScope,
      });
      const activityIds = await Promise.all(
        [1, 2].map(async (number) => {
          let activity = await current.run(() =>
            activities.propose({
              operationId: randomUUID(),
              subjectId,
              purpose: `Independent activity ${number}`,
              mode: "work",
              window: { notBefore: null, notAfter: null },
              proposedBy: actor,
              sourceRefs: activityScope.sourceRefs,
              workContextId: null,
              world: { timeDomainRef: domain, at: "2026-10-16T03:00:00.000Z" },
              nextOpportunity: null,
              interruptOn: [],
            }),
          );
          activity = await current.run(() =>
            activities.adopt({
              subjectId,
              activityId: activity.activityId,
              expectedRevision: activity.revision,
              adoptedBy: actor,
              scope: activityScope,
            }),
          );
          return activity.activityId;
        }),
      );
      const runIds = activityIds.map((activityId) => "native:activity:" + activityId);
      const selections = await Promise.all(
        runIds.map((runId) =>
          current.run(() =>
            life.selectContact({ subjectId, worldId, eventId: event.eventId, runId }),
          ),
        ),
      );
      expect(selections.filter((value) => value.selected)).toHaveLength(1);
      const winningRun = selections[0]!.selected ? runIds[0]! : runIds[1]!;
      const losingRun = winningRun === runIds[0] ? runIds[1]! : runIds[0]!;
      expect(
        (await life.pendingContacts(subjectId, worldId)).find(
          (value) => value.eventId === event.eventId,
        )?.selectedRunId,
      ).toBe(winningRun);
      expect(await life.releasedEventIds(subjectId, worldId, [event.eventId])).toEqual(
        [],
      );
      expect(
        (
          await current.run(() =>
            life.selectContact({
              subjectId,
              worldId,
              eventId: event.eventId,
              runId: winningRun,
            }),
          )
        ).selected,
      ).toBe(true);
      expect(
        (
          await current.run(() =>
            life.selectContact({
              subjectId,
              worldId,
              eventId: event.eventId,
              runId: losingRun,
            }),
          )
        ).selected,
      ).toBe(false);
      const contactRef = `world-event:${worldId}:${event.eventId}:1`;
      await expect(
        current.run(() =>
          life.acknowledgeContact({
            subjectId,
            worldId,
            eventId: event.eventId,
            contactRef,
            runId: losingRun,
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "world.conflict" } });
      await current.run(() =>
        life.acknowledgeContact({
          subjectId,
          worldId,
          eventId: event.eventId,
          contactRef,
          runId: winningRun,
        }),
      );
      expect(await life.pendingContacts(subjectId, worldId)).toHaveLength(1);
      expect(await life.releasedEventIds(subjectId, worldId, [event.eventId])).toEqual([
        event.eventId,
      ]);
      await current.run(() =>
        life.acknowledgeContact({
          subjectId,
          worldId,
          eventId: event.eventId,
          contactRef,
          runId: winningRun,
        }),
      );
      await expect(
        current.run(() =>
          life.acknowledgeContact({
            subjectId,
            worldId,
            eventId: event.eventId,
            contactRef: "contact:different",
            runId: winningRun,
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "world.conflict" } });
      const revisions = await life.history({ subjectId, worldId, limit: 2 });
      expect(revisions.history.map((row) => row.revision)).toEqual([1, 2]);
      expect(revisions.nextRevision).toBe(2);
      expect(
        (
          await life.history({ subjectId, worldId, afterRevision: 2, limit: 2 })
        ).history.map((row) => row.revision),
      ).toEqual([3]);
    } finally {
      await current.close();
    }
  });
});
