// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  createLifeService,
  createPursuitService,
  type PursuitMotivation,
  type PursuitEvaluation,
} from "@heptalogos/subject";
import { readRepositorySql } from "@heptalogos/persistence/repository";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real(
  "Pursuit uses real fenced PostgreSQL and preserves the external evaluator boundary",
  () => {
    it("explicitly adopts exact refs, retains Achieve/Maintain/unknown evidence and pauses revised/withdrawn sources without erasing history", async () => {
      const c = await composeProductPersistence();
      try {
        const subjectId = randomUUID(),
          workContextId = randomUUID(),
          actor = "entity:heptalogos:" + randomUUID();
        const now = () => new Date().toISOString();
        const desire = { kind: "desire_revision" as const, value: randomUUID() },
          condition = {
            kind: "desired_condition_revision" as const,
            value: randomUUID(),
          };
        const scope = {
          conversations: [
            {
              conversationRef: "conversation:heptalogos:" + randomUUID(),
              operations: ["observe" as const],
            },
          ],
          tools: [],
          sourceRefs: ["occurrence:actual-tool-result"],
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
            purpose: "Actual bounded useful work",
            mode: "work",
            window: { notBefore: null, notAfter: null },
            proposedBy: actor,
            sourceRefs: [],
            workContextId,
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
            reason: "Explicit bounded work",
          }),
        );
        let sourceEpoch = "1";
        let sourceCurrent = true,
          sourceDomain = "time:real";
        let evaluatorAnswer: Pick<
          PursuitEvaluation,
          "verdict" | "coverage" | "finalConclusion" | "applicable"
        > = {
          verdict: "unknown",
          coverage: "limited",
          finalConclusion: false,
          applicable: true,
        };
        // These are external owner responses, not a second implementation of the Nous evaluator.
        const evaluate = vi.fn<PursuitMotivation["evaluate"]>(
          async ({ pursuit, evidenceRefs }) => ({
            evaluationId: randomUUID(),
            conditionRevision: pursuit.conditionRevision,
            ...evaluatorAnswer,
            timeDomainRef: sourceDomain,
            evaluatedInterval: {
              kind: "interval",
              from: "2026-10-16T00:00:00.000Z",
              until: now(),
            },
            evidenceRefs,
            recordedAt: now(),
          }),
        );
        const motivation: PursuitMotivation = {
          inspect: async () => ({
            current: sourceCurrent,
            desireEpoch: sourceEpoch,
            conditionEpoch: sourceEpoch,
            reason: sourceCurrent ? "" : "Actual Desire withdrawn or condition revised",
            timeDomainRef: sourceDomain,
          }),
          workContextOpen: async (s, w) => s === subjectId && w === workContextId,
          evaluate,
        };
        const service = createPursuitService({
          persistence: c.persistence,
          life,
          motivation,
          now,
          authorize: async (a, who) => {
            expect(a.subjectId).toBe(subjectId);
            expect(who).toBe(actor);
          },
        });
        const adoption = {
          operationId: randomUUID(),
          subjectId,
          activityId: activity.activityId,
          desireRevision: desire,
          conditionRevision: condition,
          adoptedBy: actor,
          reason: "Invest actual bounded Activity in this exact DesiredCondition",
        };
        const [first, duplicate] = await Promise.all([
          c.run(() => service.adopt(adoption)),
          c.run(() => service.adopt(adoption)),
        ]);
        expect(first.pursuitId).toBe(duplicate.pursuitId);
        expect(first.workContextId).toBe(workContextId);
        const absent = {
          ...adoption,
          operationId: randomUUID(),
          activityId: randomUUID(),
        };
        await expect(c.run(() => service.adopt(absent))).rejects.toBeDefined();
        const evaluateInput = () => ({
          subjectId,
          pursuitId: first.pursuitId,
          operationId: randomUUID(),
          expectedRevision: 0,
          evidenceRefs: [] as { kind: string; value: string }[],
        });
        let input = evaluateInput();
        input.expectedRevision = first.revision;
        const unknown = await c.run(() => service.evaluate(input));
        expect(unknown.verdict).toBe("unknown");
        expect(unknown.coverage).toBe("limited");
        expect(unknown.finalConclusion).toBe(false);
        expect((await service.get(subjectId, first.pursuitId))!.state).toBe("active");
        expect(evaluate).toHaveBeenCalledTimes(1);
        expect(await c.run(() => service.evaluate(input))).toEqual(unknown);
        expect(evaluate).toHaveBeenCalledTimes(1);
        const callsBeforeForgedTruth = evaluate.mock.calls.length;
        await expect(
          c.run(() =>
            service.evaluate({ ...input, verdict: "satisfied" } as typeof input),
          ),
        ).rejects.toBeDefined();
        expect(evaluate).toHaveBeenCalledTimes(callsBeforeForgedTruth);
        // An actual positive witness can be satisfied even with only partial coverage (Achieve).
        evaluatorAnswer = {
          verdict: "satisfied",
          coverage: "limited",
          finalConclusion: true,
          applicable: true,
        };
        let current = (await service.get(subjectId, first.pursuitId))!;
        input = {
          ...evaluateInput(),
          expectedRevision: current.revision,
          evidenceRefs: [{ kind: "occurrence", value: "actual-tool-result" }],
        };
        const achieved = await c.run(() => service.evaluate(input));
        expect(achieved.verdict).toBe("satisfied");
        expect(achieved.evidenceRefs).toEqual(input.evidenceRefs);
        expect((await service.get(subjectId, first.pursuitId))!.state).toBe("active");
        // Maintain only receives its full-window conclusion from the official owner, never from task completion.
        evaluatorAnswer = {
          verdict: "satisfied",
          coverage: "complete",
          finalConclusion: true,
          applicable: true,
        };
        current = (await service.get(subjectId, first.pursuitId))!;
        const maintained = await c.run(() =>
          service.evaluate({
            ...evaluateInput(),
            expectedRevision: current.revision,
            evidenceRefs: [{ kind: "occurrence", value: "complete-owner-timeline" }],
          }),
        );
        expect(maintained.coverage).toBe("complete");
        expect(maintained.finalConclusion).toBe(true);
        // A window with a gap stays unknown and is never upgraded by the Product owner.
        evaluatorAnswer = {
          verdict: "unknown",
          coverage: "gap",
          finalConclusion: false,
          applicable: null,
        };
        current = (await service.get(subjectId, first.pursuitId))!;
        const gap = await c.run(() =>
          service.evaluate({ ...evaluateInput(), expectedRevision: current.revision }),
        );
        expect(gap.verdict).toBe("unknown");
        expect(gap.applicable).toBeNull();
        const beforeDomain = evaluate.mock.calls.length;
        sourceDomain = "time:virtual";
        current = (await service.get(subjectId, first.pursuitId))!;
        await expect(
          c.run(() =>
            service.evaluate({
              ...evaluateInput(),
              expectedRevision: current.revision,
            }),
          ),
        ).rejects.toBeDefined();
        expect(evaluate).toHaveBeenCalledTimes(beforeDomain);
        expect((await service.get(subjectId, first.pursuitId))!.reviewRequired).toBe(
          true,
        );
        expect((await life.get(subjectId, activity.activityId))!.state).toBe("paused");
        sourceDomain = "time:real";
        sourceCurrent = false;
        await expect(
          c.run(() => service.guardActivity(subjectId, activity.activityId)),
        ).rejects.toBeDefined();
        current = (await service.get(subjectId, first.pursuitId))!;
        await expect(
          c.run(() =>
            service.transition({
              subjectId,
              pursuitId: first.pursuitId,
              expectedRevision: current.revision,
              action: "resume",
              reason: "Cannot silently continue withdrawn desire",
            }),
          ),
        ).rejects.toBeDefined();
        // A changed condition is only adopted by an explicit review decision; the same identity retains its old history.
        sourceCurrent = true;
        const newCondition = {
          kind: "desired_condition_revision" as const,
          value: randomUUID(),
        };
        current = (await service.get(subjectId, first.pursuitId))!;
        const reviewed = await c.run(() =>
          service.reconsider({
            subjectId,
            pursuitId: first.pursuitId,
            expectedRevision: current.revision,
            desireRevision: desire,
            conditionRevision: newCondition,
            reason: "Explicitly adopt actual revised condition after source review",
          }),
        );
        expect(reviewed.conditionRevision).toEqual(newCondition);
        expect(reviewed.state).toBe("paused");
        expect(reviewed.reviewRequired).toBe(false);
        expect(reviewed.lastEvaluation).toBeNull();
        expect((await life.get(subjectId, activity.activityId))!.state).toBe("paused");
        sourceEpoch = "2"; // Same revision after a real lifecycle epoch change still requires explicit review.
        const epochChanged = await c.run(() =>
          service.recheck(subjectId, first.pursuitId),
        );
        expect(epochChanged.reviewRequired).toBe(true);
        await c.run(() =>
          service.reconsider({
            subjectId,
            pursuitId: first.pursuitId,
            expectedRevision: epochChanged.revision,
            desireRevision: desire,
            conditionRevision: newCondition,
            reason: "Explicitly review same revision after lifecycle epoch change",
          }),
        );
        sourceCurrent = false;
        const withdrawn = await c.run(() =>
          service.recheck(subjectId, first.pursuitId),
        );
        expect(withdrawn.reviewRequired).toBe(true);
        const listed = await service.list({ subjectId, states: [], limit: 1 });
        expect(listed.pursuits.map((p) => p.pursuitId)).toEqual([first.pursuitId]);
        expect(listed.nextId).toBeNull();
        expect(
          (await service.list({ subjectId: randomUUID(), states: [], limit: 1 }))
            .pursuits,
        ).toEqual([]);
        const page = await service.history({
          subjectId,
          pursuitId: first.pursuitId,
          limit: 2,
        });
        expect(page.history.map((p) => p.revision)).toEqual([1, 2]);
        expect(page.nextRevision).toBe(2);
        const following = await service.history({
          subjectId,
          pursuitId: first.pursuitId,
          afterRevision: page.nextRevision!,
          limit: 128,
        });
        expect(following.history.every((p) => p.revision > 2)).toBe(true);
        expect(following.nextRevision).toBeNull();
        await expect(
          service.history({
            subjectId: randomUUID(),
            pursuitId: first.pursuitId,
            limit: 1,
          }),
        ).rejects.toBeDefined();
        const history = await readRepositorySql<{ count: number }>(
          c.persistence,
          "SELECT count(*)::integer AS count FROM heptalogos.pursuit_history WHERE pursuit_id=$1",
          [first.pursuitId],
        );
        expect(history[0]!.count).toBeGreaterThan(4);
        const evaluations = await readRepositorySql<{ count: number }>(
          c.persistence,
          "SELECT count(*)::integer AS count FROM heptalogos.pursuit_evaluation WHERE pursuit_id=$1",
          [first.pursuitId],
        );
        expect(evaluations[0]!.count).toBe(4);
      } finally {
        await c.close();
      }
    }, 120000);
  },
);
