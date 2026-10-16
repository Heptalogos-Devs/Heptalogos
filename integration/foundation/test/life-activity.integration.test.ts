// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createLifeService } from "@heptalogos/subject";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";

const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("adopted Product activities on real fenced PostgreSQL", () => {
  it("keeps idempotent proposals, scoped adoption, CAS progress and actual continuation across boot", async () => {
    let current = await composeProductPersistence();
    const subjectId = randomUUID();
    const actor = "entity:heptalogos:" + randomUUID();
    const scope = {
      conversations: [{ conversationRef: "qq:test", operations: ["observe" as const] }],
      tools: ["read"],
      sourceRefs: ["occurrence:known"],
      maxRunMs: 60_000,
    };
    let currentDomain = "real";
    const options = () => ({
      persistence: current.persistence,
      now: () => new Date().toISOString(),
      worldNow: async () => ({
        timeDomainRef: currentDomain,
        at: new Date().toISOString(),
      }),
      scopeAuthority: async () => scope,
    });
    let life = createLifeService(options());
    const proposal = {
      operationId: randomUUID(),
      subjectId,
      purpose: "Read a public document and keep the real result",
      mode: "work" as const,
      window: { notBefore: null, notAfter: null },
      proposedBy: actor,
      sourceRefs: [],
      workContextId: null,
      world: { timeDomainRef: "real", at: new Date().toISOString() },
      nextOpportunity: null,
      interruptOn: ["direct" as const],
    };
    try {
      const copies = await current.run(() =>
        Promise.all(Array.from({ length: 8 }, () => life.propose(proposal))),
      );
      expect(new Set(copies.map((value) => value.activityId)).size).toBe(1);
      let activity = copies[0]!;
      await expect(
        current.run(() =>
          life.transition({
            subjectId,
            activityId: activity.activityId,
            expectedRevision: activity.revision,
            action: "start",
            reason: "Unadopted work must not start",
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "life.conflict" } });
      await expect(
        current.run(() =>
          life.adopt({
            subjectId,
            activityId: activity.activityId,
            expectedRevision: activity.revision,
            adoptedBy: actor,
            scope: {
              ...scope,
              conversations: [{ conversationRef: "qq:test", operations: ["send"] }],
            },
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "life.scope_denied" } });
      activity = await current.run(() =>
        life.adopt({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          adoptedBy: actor,
          scope,
        }),
      );
      currentDomain = "time:unmapped-world";
      await expect(
        current.run(() =>
          life.transition({
            subjectId,
            activityId: activity.activityId,
            expectedRevision: activity.revision,
            action: "start",
            reason: "No implicit mapping for a different world",
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "life.time_domain_unavailable" },
      });
      currentDomain = "real";
      activity = await current.run(() =>
        life.transition({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          action: "start",
          reason: "Adopted work started",
        }),
      );
      const revision = activity.revision;
      activity = await current.run(() =>
        life.progress({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: revision,
          progress: {
            note: "Read the first source; actual artifact is retained",
            sourceRefs: ["occurrence:known"],
            artifactRefs: ["artifact:written"],
            resultRefs: ["tool:read-result"],
          },
          nextOpportunity: null,
        }),
      );
      await expect(
        current.run(() =>
          life.transition({
            subjectId,
            activityId: activity.activityId,
            expectedRevision: revision,
            action: "pause",
            reason: "Stale actor",
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "life.conflict" } });
      const fixture = current.fixture;
      await current.close();
      current = await composeProductPersistence(fixture);
      life = createLifeService(options());
      const recovered = await current.run(() => life.recover(subjectId));
      expect(recovered.changed).toBe(1);
      activity = (await life.get(subjectId, activity.activityId))!;
      expect(activity.continuationRequired).toBe(true);
      expect(activity.progress.artifactRefs).toEqual(["artifact:written"]);
      activity = await current.run(() =>
        life.transition({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          action: "resume",
          reason: "Reconsider actual saved results before continuing",
        }),
      );
      expect(activity.continuationRequired).toBe(false);
      activity = await current.run(() =>
        life.transition({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          action: "cancel",
          reason: "Explicit cancellation",
        }),
      );
      expect(activity.progress.artifactRefs).toEqual(["artifact:written"]);
      expect(
        (await life.schedule({ subjectId, states: ["cancelled"], limit: 8 }))
          .activities,
      ).toHaveLength(1);
      await expect(
        current.run(() =>
          life.transition({
            subjectId,
            activityId: activity.activityId,
            expectedRevision: activity.revision,
            action: "resume",
            reason: "Do not resurrect a terminal task",
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "life.conflict" } });
    } finally {
      await current.close();
    }
  });
});
