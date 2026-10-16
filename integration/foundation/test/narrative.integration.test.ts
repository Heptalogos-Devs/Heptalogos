// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLifeService,
  createAgencyService,
  createWorldLifeService,
  createNarrativeService,
  createDeliberationService,
  type AdoptDeliberation,
  type NarrativeReview,
} from "@heptalogos/subject";
import {
  executeRepositorySql as sql,
  readRepositorySql,
  type PersistenceInternalTransaction,
  useRepositoryMutationTransaction,
} from "@heptalogos/persistence/repository";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("Narrative adoption on real fenced PostgreSQL", () => {
  it("commits exact claims and one native delivery, preserves deliberate truth and derives expressed history from actual receipts", async () => {
    const c = await composeProductPersistence();
    const subjectId = randomUUID(),
      actor = "entity:heptalogos:" + randomUUID();
    const now = () => new Date().toISOString();
    const scope = {
      conversations: [
        {
          conversationRef: "conversation:accepted",
          operations: ["observe" as const, "send" as const],
        },
      ],
      tools: [],
      sourceRefs: ["source:actual-game"],
      maxRunMs: 60000,
    };
    const life = createLifeService({
      persistence: c.persistence,
      now,
      worldNow: async () => ({ timeDomainRef: "time:real", at: now() }),
      scopeAuthority: async () => scope,
    });
    let activity = await c.run(() =>
      life.propose({
        operationId: randomUUID(),
        subjectId,
        purpose: "Talk with a friend",
        mode: "work",
        window: { notBefore: null, notAfter: null },
        proposedBy: actor,
        sourceRefs: scope.sourceRefs,
        workContextId: null,
        world: { timeDomainRef: "time:real", at: now() },
        nextOpportunity: null,
        interruptOn: ["manual"],
      }),
    );
    activity = await c.run(() =>
      life.adopt({
        subjectId,
        activityId: activity.activityId,
        expectedRevision: activity.revision,
        adoptedBy: actor,
        scope,
      }),
    );
    activity = await c.run(() =>
      life.transition({
        subjectId,
        activityId: activity.activityId,
        expectedRevision: activity.revision,
        action: "start",
        reason: "Chosen interaction",
      }),
    );
    const retainRun = async (
      id: string,
      role: "subject.render" | "subject.deliberation",
    ) =>
      c.run(() =>
        c.persistence.mutate((ctx) =>
          useRepositoryMutationTransaction(ctx, (tx) =>
            sql(
              tx,
              "INSERT INTO heptalogos.life_native_run(run_id,subject_id,activity_id,session_key,role,state,document,recorded_at,updated_at) VALUES($1,$2,$3,$4,'main','running',$5::jsonb,now(),now())",
              [
                id,
                subjectId,
                activity.activityId,
                role,
                JSON.stringify({
                  registration: { roleScope: { role } },
                  consumerId: "consumer:fixture:" + id,
                }),
              ],
            ),
          ),
        ),
      );
    const assertSourceRun = async (
      input: AdoptDeliberation,
      tx?: PersistenceInternalTransaction,
    ) => {
      const statement =
        "SELECT subject_id,activity_id,document FROM heptalogos.life_native_run WHERE run_id=$1 AND state='running'";
      const rows = tx
        ? await sql<{
            subject_id: string;
            activity_id: string;
            document: {
              registration: { roleScope: { role: string } };
              consumerId: string;
            };
          }>(tx, statement, [input.sourceRunId])
        : await readRepositorySql<{
            subject_id: string;
            activity_id: string;
            document: {
              registration: { roleScope: { role: string } };
              consumerId: string;
            };
          }>(c.persistence, statement, [input.sourceRunId]);
      expect(rows[0]).toMatchObject({
        subject_id: input.subjectId,
        activity_id: input.activityId,
        document: { registration: { roleScope: { role: "subject.deliberation" } } },
      });
      expect(rows[0]?.document.consumerId).toBeTruthy();
    };
    const decisions = createDeliberationService({
      persistence: c.persistence,
      life,
      now,
      worldNow: async () => ({ timeDomainRef: "time:real", at: now() }),
      validateSourceRun: async (input) => {
        await assertSourceRun(input);
        return { sourceRefs: scope.sourceRefs, tools: scope.tools };
      },
      assertSourceRunIn: async (tx, input) => assertSourceRun(input, tx),
    });
    const intent = {
      intent: "Keep the game private for now",
      stance: "familiar",
      qualifications: [],
      deception: "conceal" as const,
      eventRefs: [],
      cognitionRefs: [],
      priorClaimRefs: [],
    };
    const adoptIntent = async (
      deception: "none" | "conceal",
      eventRefs: string[] = [],
    ) => {
      const sourceRunId = randomUUID();
      await retainRun(sourceRunId, "subject.deliberation");
      const current = (await life.get(subjectId, activity.activityId))!;
      const adopted = await c.run(() =>
        decisions.adopt({
          operationId: randomUUID(),
          subjectId,
          activityId: activity.activityId,
          sourceRunId,
          expectedActivityRevision: current.revision,
          decision: {
            action: "communicate",
            reason: "An actual adopted communication intention",
            expressionIntent: { ...intent, deception, eventRefs },
          },
        }),
      );
      expect(await decisions.read(subjectId, adopted.decisionRef)).toEqual(adopted);
      activity = (await life.get(subjectId, activity.activityId))!;
      return adopted;
    };
    const decision = await adoptIntent("conceal");
    const runId = randomUUID();
    await retainRun(runId, "subject.render");
    const authority = {
      activity,
      role: "subject.render" as const,
      actorEntityRef: actor,
      conversationRef: "conversation:accepted",
      sourceRefs: scope.sourceRefs,
      messageSources: [],
    };
    const agency = createAgencyService({
      persistence: c.persistence,
      now,
      authority: async (id, _recipient, tx) => {
        const statement =
          "SELECT document#>>'{registration,roleScope,role}' AS role FROM heptalogos.life_native_run WHERE run_id=$1";
        const roles = tx
          ? await sql<{ role: string }>(tx, statement, [id])
          : await readRepositorySql<{ role: string }>(c.persistence, statement, [id]);
        return {
          ...authority,
          activity: (await life.get(subjectId, activity.activityId, tx))!,
          role: roles[0]?.role ?? "unregistered",
        };
      },
      checkSources: async () => {},
    });
    const worlds = createWorldLifeService({
      persistence: c.persistence,
      now,
      worldNow: async () => ({ timeDomainRef: "time:real", at: now() }),
    });
    let calls = 0;
    const review: NarrativeReview = {
      claims: [
        {
          sourceIndex: 4,
          start: 0,
          end: 4,
          quote: "我在复习",
          content: "I am reviewing lessons",
          entityRefs: [actor],
          kind: "life",
          stance: "deliberate",
          polarity: "affirm",
          about: null,
          basis: "deliberate",
          sourceRefs: scope.sourceRefs,
          eventRefs: [],
          cognitionRefs: [],
          priorClaimRefs: [],
        },
      ],
      conflicts: [],
      commitments: [],
      worldPatch: null,
    };
    const narrative = createNarrativeService({
      persistence: c.persistence,
      decisions,
      life,
      now,
      worldNow: async () => ({ timeDomainRef: "time:real", at: now() }),
      worlds,
      agency,
      review: async () => {
        calls++;
        return { reviewerRunId: "actual-review-run", review };
      },
    });
    const brief = {
      briefId: randomUUID(),
      decisionRef: decision.decisionRef,
      subjectId,
      activityId: activity.activityId,
      expectedActivityRevision: activity.revision,
      actorEntityRef: actor,
      audience: {
        conversationRef: "conversation:accepted",
        channel: "qq",
        accountId: "test",
        to: "direct:friend",
      },
      intent: "Keep the game private for now",
      stance: "familiar",
      sourceRefs: scope.sourceRefs,
      cognitionRefs: [],
      eventRefs: [],
      priorClaimRefs: [],
      epistemicView: { actualActivity: "gaming" },
      qualifications: [],
      deception: "conceal" as const,
      worldDetailScope: null,
      createdAt: now(),
      validUntil: new Date(Date.now() + 60000).toISOString(),
    };
    const prepared = {
      channel: "qq",
      accountId: "test",
      to: "direct:friend",
      nativeIntentId: randomUUID(),
      runId,
      preparedBatch: {
        schemaVersion: 1,
        runId,
        entries: [
          { sourceIndex: 4, status: "accepted", payload: { text: "我在复习" } },
        ],
      },
    };
    try {
      await c.run(() => narrative.saveBrief(brief, runId));
      const adopted = await c.run(() => narrative.adoptDelivery(prepared));
      expect(await c.run(() => narrative.adoptDelivery(prepared))).toEqual(adopted);
      expect(calls).toBe(1);
      const q = {
        subjectId,
        conversationRef: brief.audience.conversationRef,
        limit: 20,
      };
      const initial = await narrative.claimsTo(q);
      expect(initial.claims).toHaveLength(1);
      expect(initial.claims[0]?.status).toBe("adopted");
      expect(initial.claims[0]?.stance).toBe("deliberate");
      const part = {
        reference: adopted.reference,
        channel: "qq",
        accountId: "test",
        to: "direct:friend",
        deliveryQueueId: "native:only",
        payload: { sourceIndex: 4, kind: "text" as const, text: "我在复习" },
      };
      const attempt = await c.run(() => agency.beginDelivery(part));
      if (attempt.action !== "send") throw Error("expected first send");
      await c.run(() =>
        agency.recordDelivery({
          reference: adopted.reference,
          sourceIndex: 4,
          partIndex: 0,
          attemptId: attempt.attemptId,
          outcome: {
            state: "accepted",
            platformMessageId: "platform:actual",
            acceptedAt: now(),
          },
        }),
      );
      const expressed = await narrative.explainStatement(subjectId, "platform:actual");
      expect(expressed.claims[0]?.status).toBe("expressed");
      expect(expressed.claims[0]?.platformMessageIds).toEqual(["platform:actual"]);
      expect((await narrative.briefForRun(runId))?.epistemicView).toEqual({
        actualActivity: "gaming",
      });
      await expect(
        c.run(() => narrative.adoptDelivery({ ...prepared, to: "direct:other" })),
      ).rejects.toMatchObject({ problem: { problemCode: "narrative.conflict" } });
      const otherRun = randomUUID();
      await retainRun(otherRun, "subject.render");
      await expect(
        c.run(() =>
          narrative.saveBrief(
            { ...brief, briefId: randomUUID(), deception: "none" },
            otherRun,
          ),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "narrative.conflict" } });
      const withoutDeception = await adoptIntent("none");
      await c.run(() =>
        narrative.saveBrief(
          {
            ...brief,
            briefId: randomUUID(),
            decisionRef: withoutDeception.decisionRef,
            expectedActivityRevision: activity.revision,
            deception: "none",
          },
          otherRun,
        ),
      );
      await expect(
        c.run(() =>
          narrative.adoptDelivery({
            ...prepared,
            runId: otherRun,
            nativeIntentId: randomUUID(),
            preparedBatch: { ...prepared.preparedBatch, runId: otherRun },
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "narrative.conflict" } });
      expect((await narrative.claimsTo(q)).claims).toHaveLength(1);
      const worldId = randomUUID();
      const interval = {
        timeDomainRef: "time:real",
        start: new Date(Date.now() - 1200000).toISOString(),
        end: new Date(Date.now() - 600000).toISOString(),
      };
      await c.run(() =>
        worlds.configure({
          operationId: randomUUID(),
          expectedRevision: 0,
          definition: {
            worldId,
            subjectId,
            revision: 1,
            name: "Independent world",
            timeDomainRef: "time:real",
            timezone: "Asia/Shanghai",
            offlinePolicy: "simulate_elapsed",
            places: [
              { placeRef: "class", name: "Classroom", description: "A classroom" },
            ],
            actors: [
              { entityRef: actor, name: "Subject", description: "Current actor" },
            ],
            subjectActorRef: actor,
            rules: "Established life stays continuous",
            creationScope: "Classroom details",
            informationSourceRefs: [],
          },
          schedule: [],
        }),
      );
      const parentEventId = randomUUID();
      await c.run(() =>
        worlds.realize({
          operationId: randomUUID(),
          subjectId,
          worldId,
          expectedRevision: 1,
          interval,
          coverage: "limited",
          events: [
            {
              eventId: parentEventId,
              interval,
              title: "Established classroom scene",
              content: "An actual same-world scene",
              actorRefs: [actor],
              placeRef: "class",
              scheduleId: null,
              parentEventId: null,
              causalEventRefs: [],
              overlap: "concurrent",
              source: {
                kind: "rule",
                producerRef: "fixture:established-scene",
                sourceRefs: [],
              },
              perceptions: [
                {
                  actorRef: actor,
                  kind: "seen",
                  at: { timeDomainRef: "time:real", at: interval.start },
                  content: "I was in the classroom",
                },
              ],
            },
          ],
        }),
      );
      const parentSource = `world-event:${worldId}:${parentEventId}:1`;
      const sceneDecision = await adoptIntent("conceal", [parentSource]);
      const eventId = randomUUID();
      const patch = {
        operationId: randomUUID(),
        subjectId,
        worldId,
        expectedRevision: 2,
        interval,
        events: [
          {
            eventId,
            interval,
            title: "Get water",
            content: "A compatible newly realized detail",
            actorRefs: [actor],
            placeRef: "class",
            scheduleId: null,
            parentEventId,
            causalEventRefs: [],
            overlap: "concurrent" as const,
            source: {
              kind: "world_planner" as const,
              producerRef: "review:actual",
              sourceRefs: [],
            },
            perceptions: [
              {
                actorRef: actor,
                kind: "seen" as const,
                at: { timeDomainRef: "time:real", at: interval.end },
                content: "Got water",
              },
            ],
          },
        ],
        coverage: "limited" as const,
      };
      const nextRun = randomUUID();
      await retainRun(nextRun, "subject.render");
      const nextBrief = {
        ...brief,
        decisionRef: sceneDecision.decisionRef,
        eventRefs: [parentSource],
        briefId: randomUUID(),
        expectedActivityRevision: activity.revision + 1,
        worldDetailScope: {
          worldId,
          interval,
          actorRefs: [actor],
          placeRefs: ["class"],
          description: "May refine this classroom interval",
        },
      };
      await c.run(() => narrative.saveBrief(nextBrief, nextRun));
      review.worldPatch = patch;
      review.claims = [
        {
          ...review.claims[0]!,
          quote: "我去接水",
          content: "Got water",
          basis: "new_virtual_detail",
          stance: "asserted",
          eventRefs: [eventId],
        },
      ];
      await expect(
        c.run(() =>
          narrative.adoptDelivery({
            ...prepared,
            runId: nextRun,
            nativeIntentId: randomUUID(),
            preparedBatch: {
              ...prepared.preparedBatch,
              runId: nextRun,
              entries: [
                { sourceIndex: 4, status: "accepted", payload: { text: "我去接水" } },
              ],
            },
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "narrative.conflict" } });
      expect(
        (
          await worlds.query({
            subjectId,
            worldId,
            interval,
            view: "world_author",
            limit: 20,
          })
        ).events,
      ).toHaveLength(1);
      expect((await worlds.read(subjectId, worldId))?.revision).toBe(2);
      expect((await narrative.claimsTo(q)).claims).toHaveLength(1);
      const due = {
        timeDomainRef: "time:real",
        at: new Date(Date.now() + 86400000).toISOString(),
      };
      const waterClaim = review.claims[0]!;
      review.claims.push({
        ...waterClaim,
        start: 5,
        end: 10,
        quote: "明天告诉你",
        content: "I will tell you tomorrow",
        kind: "commitment",
        basis: "commitment",
        eventRefs: [],
      });
      review.commitments = [
        {
          claimIndex: 1,
          purpose: "Tell the friend tomorrow",
          due,
          sourceRefs: scope.sourceRefs,
        },
      ];
      const successfulRun = randomUUID();
      await retainRun(successfulRun, "subject.render");
      await c.run(() =>
        narrative.saveBrief(
          {
            ...nextBrief,
            briefId: randomUUID(),
            expectedActivityRevision: activity.revision,
          },
          successfulRun,
        ),
      );
      const successfulPrepared = {
        ...prepared,
        runId: successfulRun,
        nativeIntentId: randomUUID(),
        preparedBatch: {
          ...prepared.preparedBatch,
          runId: successfulRun,
          entries: [
            {
              sourceIndex: 4,
              status: "accepted",
              payload: { text: "我去接水，明天告诉你" },
            },
          ],
        },
      };
      const committedWorld = await c.run(() =>
        narrative.adoptDelivery(successfulPrepared),
      );
      expect((await life.get(subjectId, activity.activityId))?.nextOpportunity).toEqual(
        due,
      );
      const afterCommitRevision = (await life.get(subjectId, activity.activityId))!
        .revision;
      expect(await c.run(() => narrative.adoptDelivery(successfulPrepared))).toEqual(
        committedWorld,
      );
      expect((await life.get(subjectId, activity.activityId))!.revision).toBe(
        afterCommitRevision,
      );
      expect((await worlds.read(subjectId, worldId))?.revision).toBe(3);
      expect(
        (
          await worlds.query({
            subjectId,
            worldId,
            interval,
            view: "world_author",
            limit: 20,
          })
        ).events.find((event) => event.eventId === eventId),
      ).toMatchObject({
        source: {
          kind: "narrative",
          producerRef: successfulRun,
          sourceRefs: expect.arrayContaining([successfulRun, "actual-review-run"]),
        },
      });
      expect(
        (
          await worlds.query({
            subjectId,
            worldId,
            interval,
            view: "world_author",
            limit: 20,
          })
        ).events,
      ).toHaveLength(2);
      const newest = await narrative.claimsTo({ ...q, order: "newest", limit: 1 });
      expect(newest.more).toBe(true);
      expect(newest.claims[0]).toMatchObject({
        content: "I will tell you tomorrow",
        status: "adopted",
      });
      const older = await narrative.claimsTo({
        ...q,
        order: "newest",
        limit: 1,
        afterClaimId: newest.claims[0]!.claimId,
      });
      expect(older.more).toBe(true);
      expect(older.claims[0]?.content).toBe("Got water");
      const oldest = await narrative.claimsTo({
        ...q,
        order: "newest",
        limit: 1,
        afterClaimId: older.claims[0]!.claimId,
      });
      expect(oldest.more).toBe(false);
      expect(oldest.claims[0]?.claimId).toBe(initial.claims[0]?.claimId);
      const failedPart = {
        ...part,
        reference: committedWorld.reference,
        deliveryQueueId: "native:world",
        payload: { ...part.payload, text: "我去接水，明天告诉你" },
      };
      const failedAttempt = await c.run(() => agency.beginDelivery(failedPart));
      if (failedAttempt.action !== "send")
        throw Error("Expected the new exact adopted delivery");
      await c.run(() =>
        agency.recordDelivery({
          reference: committedWorld.reference,
          sourceIndex: 4,
          partIndex: 0,
          attemptId: failedAttempt.attemptId,
          outcome: { state: "not_sent", code: "actual_pre_send_rejection" },
        }),
      );
      expect(
        (
          await narrative.claimsTo({ ...q, order: "newest", status: "not_sent" })
        ).claims.map((claim) => claim.claimId),
      ).toEqual([newest.claims[0]!.claimId, older.claims[0]!.claimId]);
    } finally {
      await c.close();
    }
  });
});
