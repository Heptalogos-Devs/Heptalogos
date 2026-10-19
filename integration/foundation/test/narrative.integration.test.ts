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
  it("sends the retained original without a reviewer and indexes its exact history after an actual receipt", async () => {
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
      authorizedDerivedSourceRefs: [],
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
      expect(calls).toBe(0);
      expect(
        await narrative.unindexedTo(subjectId, brief.audience.conversationRef),
      ).toMatchObject([{ prepared }]);
      expect(await narrative.pendingSemanticWork(subjectId)).toMatchObject([
        { briefId: brief.briefId, state: "pending" },
      ]);
      const q = {
        subjectId,
        conversationRef: brief.audience.conversationRef,
        limit: 20,
      };
      expect((await narrative.claimsTo(q)).claims).toEqual([]);
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
      expect(calls).toBe(0);
      await c.run(() => narrative.indexPending(brief.briefId));
      await c.run(() => narrative.indexPending(brief.briefId));
      expect(calls).toBe(1);
      expect(
        await narrative.unindexedTo(subjectId, brief.audience.conversationRef),
      ).toEqual([]);
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
    } finally {
      await c.close();
    }
  });
});
