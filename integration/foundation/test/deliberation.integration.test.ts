// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createLifeService,
  createDeliberationService,
  subjectProblem,
  type AdoptDeliberation,
} from "@heptalogos/subject";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("Subject DecisionCommit under real fenced PostgreSQL", () => {
  it("adopts one exact choice under CAS, retains explicit communication intent and replays canonical decisions without live dependencies", async () => {
    const current = await composeProductPersistence();
    const subjectId = randomUUID(),
      sourceRunId = "native:subject:deliberation:" + randomUUID(),
      world = { timeDomainRef: "school", at: "2026-10-16T12:00:00.000Z" };
    const authority = {
      conversations: [],
      sourceRefs: ["world:school"],
      tools: ["read"],
      maxRunMs: 60000,
    };
    const life = createLifeService({
      persistence: current.persistence,
      now: () => new Date().toISOString(),
      worldNow: async () => world,
      scopeAuthority: async () => authority,
    });
    let allowed = true,
      clockAvailable = true,
      authorityChecks = 0,
      revokeOnValidate = false;
    const decisions = createDeliberationService({
      persistence: current.persistence,
      life,
      now: () => new Date().toISOString(),
      worldNow: async () => {
        if (!clockAvailable) throw Error("clock unavailable");
        return world;
      },
      validateSourceRun: async (input) => {
        if (input.sourceRunId !== sourceRunId || !allowed)
          throw subjectProblem(
            "deliberation.scope_denied",
            "Run denied",
            "Use the actual admitted deliberation run",
            "authorization",
          );
        if (revokeOnValidate) allowed = false;
        return { sourceRefs: authority.sourceRefs, tools: authority.tools };
      },
      assertSourceRunIn: async () => {
        authorityChecks++;
        if (!allowed)
          throw subjectProblem(
            "deliberation.scope_denied",
            "Run revoked",
            "The actual authority changed",
            "authorization",
          );
      },
    });
    const start = async () => {
      let activity = await current.run(() =>
        life.propose({
          operationId: randomUUID(),
          subjectId,
          purpose: "Continue an independent school life",
          mode: "work",
          window: { notBefore: null, notAfter: null },
          proposedBy: "subject:self",
          sourceRefs: authority.sourceRefs,
          workContextId: null,
          world,
          nextOpportunity: world,
          interruptOn: [],
        }),
      );
      activity = await current.run(() =>
        life.adopt({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          adoptedBy: "subject:self",
          scope: authority,
        }),
      );
      return current.run(() =>
        life.transition({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          action: "start",
          reason: "Explicit Subject activity",
        }),
      );
    };
    try {
      const activity = await start();
      const input: AdoptDeliberation = {
        operationId: randomUUID(),
        subjectId,
        activityId: activity.activityId,
        sourceRunId,
        expectedActivityRevision: activity.revision,
        decision: {
          action: "communicate",
          reason: "I choose to say goodnight before a separate rest action",
          expressionIntent: {
            intent: "Say goodnight before resting",
            stance: "Brief and warm",
            qualifications: [],
            deception: "conceal",
            eventRefs: [],
            cognitionRefs: [],
            priorClaimRefs: [],
          },
        },
      };
      const adopted = await current.run(() =>
        Promise.all(Array.from({ length: 6 }, () => decisions.adopt(input))),
      );
      expect(new Set(adopted.map((value) => value.decisionRef)).size).toBe(1);
      const result = adopted[0]!;
      expect(result.decision.expressionIntent?.deception).toBe("conceal");
      expect(result.mode).toBe("work");
      expect(result.nextOpportunity).toBeNull();
      expect((await life.get(subjectId, activity.activityId))?.revision).toBe(
        activity.revision + 1,
      );
      expect((await life.get(subjectId, activity.activityId))?.progress.note).toBe("");
      expect(await decisions.read(subjectId, result.decisionRef)).toEqual(result);
      expect(await decisions.readOperation(subjectId, input.operationId)).toEqual(
        result,
      );
      expect(await decisions.read(randomUUID(), result.decisionRef)).toBeUndefined();
      expect(
        await decisions.read(subjectId, "subject-decision:malformed"),
      ).toBeUndefined();
      await expect(
        current.run(() =>
          decisions.adopt({
            ...input,
            decision: {
              ...input.decision,
              reason: "Different content under the same operation",
            },
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "deliberation.conflict" } });
      await current.run(() =>
        life.transition({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: result.activityRevision,
          action: "cancel",
          reason: "Stop this actual activity",
        }),
      );
      allowed = false;
      clockAvailable = false;
      const checksBefore = authorityChecks;
      expect(await current.run(() => decisions.adopt(input))).toEqual(result);
      expect(authorityChecks).toBe(checksBefore);
      allowed = true;
      clockAvailable = true;
      const racing = await start();
      const choice: AdoptDeliberation = {
        operationId: randomUUID(),
        subjectId,
        activityId: racing.activityId,
        sourceRunId,
        expectedActivityRevision: racing.revision,
        decision: { action: "continue", reason: "Continue my own activity" },
      };
      const races = await current.run(() =>
        Promise.allSettled([
          decisions.adopt(choice),
          decisions.adopt({
            ...choice,
            operationId: randomUUID(),
            decision: { action: "wait", reason: "Defer this opportunity" },
          }),
        ]),
      );
      expect(races.filter((value) => value.status === "fulfilled")).toHaveLength(1);
      expect(races.filter((value) => value.status === "rejected")).toHaveLength(1);
      const actual = (await life.get(subjectId, racing.activityId))!;
      await expect(
        current.run(() =>
          decisions.adopt({
            ...choice,
            operationId: randomUUID(),
            expectedActivityRevision: actual.revision,
            decision: {
              action: "search",
              reason: "Try a task outside real authority",
              delegation: {
                goal: "Read an unrelated source",
                sourceRefs: ["private:unselected"],
                tools: ["read"],
              },
            },
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "deliberation.scope_denied" },
      });
      expect((await life.get(subjectId, racing.activityId))?.revision).toBe(
        actual.revision,
      );
      revokeOnValidate = true;
      await expect(
        current.run(() =>
          decisions.adopt({
            ...choice,
            operationId: randomUUID(),
            expectedActivityRevision: actual.revision,
            decision: {
              action: "rest",
              reason: "Authority was revoked after provider read",
            },
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "deliberation.scope_denied" },
      });
      expect((await life.get(subjectId, racing.activityId))?.revision).toBe(
        actual.revision,
      );
    } finally {
      await current.close();
    }
  });
  it("rolls back an already updated Life mode when the same decision transaction fails", async () => {
    const current = await composeProductPersistence();
    const subjectId = randomUUID(),
      sourceRunId = "native:subject:deliberation:" + randomUUID(),
      world = { timeDomainRef: "school", at: "2026-10-16T12:00:00.000Z" },
      scope = { conversations: [], sourceRefs: [], tools: [], maxRunMs: 60000 };
    const life = createLifeService({
      persistence: current.persistence,
      now: () => new Date().toISOString(),
      worldNow: async () => world,
      scopeAuthority: async () => scope,
    });
    try {
      let activity = await current.run(() =>
        life.propose({
          operationId: randomUUID(),
          subjectId,
          purpose: "Own quiet activity",
          mode: "work",
          window: { notBefore: null, notAfter: null },
          proposedBy: "self",
          sourceRefs: [],
          workContextId: null,
          world,
          nextOpportunity: null,
          interruptOn: [],
        }),
      );
      activity = await current.run(() =>
        life.adopt({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          adoptedBy: "self",
          scope,
        }),
      );
      activity = await current.run(() =>
        life.transition({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          action: "start",
          reason: "Adopted work",
        }),
      );
      let fail = true;
      const decisions = createDeliberationService({
        persistence: current.persistence,
        life: {
          progressIn: async (...args) => {
            const updated = await life.progressIn(...args);
            if (fail) throw Error("actual transaction interruption");
            return updated;
          },
        },
        now: () => new Date().toISOString(),
        worldNow: async () => world,
        validateSourceRun: async () => ({ sourceRefs: [], tools: [] }),
        assertSourceRunIn: async () => {},
      });
      const input: AdoptDeliberation = {
        operationId: randomUUID(),
        subjectId,
        activityId: activity.activityId,
        sourceRunId,
        expectedActivityRevision: activity.revision,
        decision: {
          action: "rest",
          reason: "Choose rest",
          nextOpportunity: { ...world, at: "2026-10-16T12:30:00.000Z" },
        },
      };
      await expect(current.run(() => decisions.adopt(input))).rejects.toThrow();
      expect(await life.get(subjectId, activity.activityId)).toEqual(activity);
      fail = false;
      const committed = await current.run(() => decisions.adopt(input));
      expect(committed.activityRevision).toBe(activity.revision + 1);
      expect(committed.mode).toBe("rest");
    } finally {
      await current.close();
    }
  });
});
