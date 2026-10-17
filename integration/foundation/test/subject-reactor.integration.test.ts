// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { readFile } from "node:fs/promises";
import { createNativeCognitionBridge } from "../../../packages/application/product-host/dist/native-cognition.js";
import { createSubjectSourceContacts } from "../../../packages/application/product-host/dist/subject-source-contact.js";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureActivityOpportunity,
  createLifeService,
  createWorldLifeService,
  createWorldProfileService,
  createSubjectAttentionService,
  createSubjectReactorService,
} from "@heptalogos/subject";
import { useRepositoryMutationTransaction } from "@heptalogos/persistence/repository";
import {
  cleanupCanonicalPostgresFixtures,
  qualifiedPgBin,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const metadataUrl = new URL(
  "../../../packages/application/product-host/node_modules/@nous-wave/client/package.json",
  import.meta.url,
);
const sdkMetadata = JSON.parse(await readFile(metadataUrl, "utf8"));
const sdk = await import(
  new URL(sdkMetadata.exports["./host-bridge"].import, metadataUrl).href
);
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("One Subject foreground on real PostgreSQL", () => {
  it("claims once, counts actual actions, switches at a safe node and retains late results without adoption", async () => {
    const c = await composeProductPersistence(undefined, 1);
    try {
      const worldId = randomUUID();
      const subjectId = randomUUID(),
        actor = "entity:heptalogos:" + randomUUID();
      let clock = Date.now();
      const now = () => new Date(clock).toISOString();
      const scope = {
        conversations: [],
        tools: [],
        sourceRefs: ["world:" + worldId],
        maxRunMs: 180000,
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
          purpose: "An ordinary lived day",
          mode: "work",
          window: { notBefore: null, notAfter: null },
          proposedBy: actor,
          sourceRefs: [],
          workContextId: randomUUID(),
          world: { timeDomainRef: "time:real", at: now() },
          nextOpportunity: null,
          interruptOn: [],
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
          reason: "Actual foreground proof",
        }),
      );
      const worlds = createWorldLifeService({
        persistence: c.persistence,
        now,
        worldNow: life.worldNow,
      });
      await c.run(() =>
        worlds.configure({
          operationId: randomUUID(),
          expectedRevision: 0,
          definition: {
            subjectId,
            worldId,
            revision: 1,
            name: "Selection fixture",
            timeDomainRef: "time:real",
            timezone: "UTC",
            offlinePolicy: "pause_with_host",
            places: [{ placeRef: "room", name: "Room", description: "Current room" }],
            actors: [
              { entityRef: actor, name: "Self", description: "The actual Subject" },
            ],
            subjectActorRef: actor,
            rules: "Virtual fixture only",
            creationScope: "No external effects",
            informationSourceRefs: [],
          },
          schedule: [],
        }),
      );
      const eventId = randomUUID(),
        interval = {
          timeDomainRef: "time:real",
          start: new Date(clock - 60000).toISOString(),
          end: new Date(clock - 1000).toISOString(),
        };
      await c.run(() =>
        worlds.realize({
          operationId: randomUUID(),
          subjectId,
          worldId,
          expectedRevision: 1,
          interval,
          coverage: "complete",
          events: [
            {
              eventId,
              interval,
              title: "Two known moments",
              content: "Author-only content must not enter the Subject",
              actorRefs: [actor],
              placeRef: "room",
              scheduleId: null,
              parentEventId: null,
              causalEventRefs: [],
              overlap: "exclusive",
              source: { kind: "rule", producerRef: "rule:fixture", sourceRefs: [] },
              perceptions: [
                {
                  actorRef: actor,
                  kind: "seen",
                  at: { timeDomainRef: "time:real", at: interval.start },
                  content: "First observed moment",
                },
                {
                  actorRef: actor,
                  kind: "heard",
                  at: { timeDomainRef: "time:real", at: interval.end },
                  content: "Second observed moment",
                },
              ],
            },
          ],
        }),
      );
      let revision = "1";
      const attention = createSubjectAttentionService({
        persistence: c.persistence,
        now,
        policy: async () => ({
          candidateLimit: 32,
          perSourceLimit: 4,
          messageBatchLimit: 8,
          coalesceMs: 0,
          reconsiderMs: 120000,
        }),
        candidates: async () => ({
          more: false,
          candidates: [
            {
              subjectId,
              activityId: activity.activityId,
              candidateRef: "notice:" + revision,
              sourceOwner: "life",
              sourceKey: "activity:" + activity.activityId,
              sourceRef: activity.activityId,
              sourceRevision: revision,
              kind: "explicit_subject_intent",
              priorityClass: "direct",
              availableAt: now(),
              related: true,
              metadata: { label: "Continue adopted activity" },
            },
          ],
        }),
      });
      const reactor = createSubjectReactorService({
        life,
        persistence: c.persistence,
        now,
        policy: async () => ({
          maxInteractionSteps: 2,
          reactionDeadlineMs: 180000,
          workerConcurrency: 2,
        }),
        attention,
        assertActivityIn: async (tx, s, a) => {
          const actual = await life.get(s, a, tx);
          if (actual?.state !== "active") throw Error("activity_not_active");
        },
      });
      activity = await c.run(() =>
        life.progress({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          progress: activity.progress,
          nextOpportunity: { timeDomainRef: "time:real", at: now() },
        }),
      );
      const due = captureActivityOpportunity(activity, {
        timeDomainRef: "time:real",
        at: now(),
      })!;
      expect(due).toBeDefined();
      const selected = await c.run(() =>
        attention.select({ subjectId, naturalOpportunity: true }),
      );
      const input = {
        subjectId,
        activityId: activity.activityId,
        reactionId: randomUUID(),
        candidateRef: selected.selected!.candidateRef,
        explanationRef: selected.explanationRef,
        opportunity: due,
      };
      const claims = await Promise.all([
        c.run(() => reactor.claim(input)),
        c.run(() => reactor.claim(input)),
      ]);
      expect(claims.filter((x) => x.claimed)).toHaveLength(1);
      expect(
        (await life.get(subjectId, activity.activityId))!.nextOpportunity,
      ).toBeNull();
      expect((await life.get(subjectId, activity.activityId))!.revision).toBe(
        due.expectedRevision + 1,
      );
      const first = claims[0]!.reaction,
        focus = { reactionId: first.reactionId, focusRevision: first.focusRevision };
      const considered = await attention.positions(subjectId);
      expect(considered[0]?.reactionId).toBe(first.reactionId);
      clock += 1000;
      await c.run(() => reactor.claim(input));
      expect((await attention.positions(subjectId))[0]?.consideredAt).toBe(
        considered[0]?.consideredAt,
      );
      const actionId = randomUUID();
      const started = await c.run(() =>
        reactor.beginAction({
          subjectId,
          activityId: activity.activityId,
          focus,
          actionId,
          action: { action: "inspect" },
        }),
      );
      expect(started.claimed).toBe(true);
      expect(
        (
          await c.run(() =>
            reactor.beginAction({
              subjectId,
              activityId: activity.activityId,
              focus,
              actionId,
              action: { action: "inspect" },
            }),
          )
        ).claimed,
      ).toBe(false);
      await expect(
        c.run(() =>
          reactor.beginAction({
            subjectId,
            activityId: activity.activityId,
            focus,
            actionId: randomUUID(),
            action: { action: "read", target: "object:unread" },
          }),
        ),
      ).rejects.toThrow();
      await c.run(() =>
        reactor.finishAction({
          subjectId,
          actionId,
          state: "completed",
          resultRefs: ["directory:actual"],
        }),
      );
      const secondAction = randomUUID();
      await c.run(() =>
        reactor.beginAction({
          subjectId,
          activityId: activity.activityId,
          focus,
          actionId: secondAction,
          action: { action: "continue" },
        }),
      );
      const rejected = {
        subjectId,
        actionId: secondAction,
        state: "rejected" as const,
        resultRefs: [],
        problem: {
          code: "subject.expression_source_denied",
          detail: "Use exact admitted references.",
          availableCognitionRefs: ["work_context:actual"],
        },
      };
      await c.run(() => reactor.finishAction(rejected));
      expect((await reactor.readAction(subjectId, secondAction))?.problem).toEqual(
        rejected.problem,
      );
      expect(await c.run(() => reactor.finishAction(rejected))).toEqual(
        await reactor.readAction(subjectId, secondAction),
      );
      await expect(
        c.run(() =>
          reactor.finishAction({
            ...rejected,
            problem: { ...rejected.problem, detail: "Changed problem" },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        c.run(() =>
          reactor.beginAction({
            subjectId,
            activityId: activity.activityId,
            focus,
            actionId: randomUUID(),
            action: { action: "inspect" },
          }),
        ),
      ).rejects.toThrow();
      const runId = randomUUID();
      await c.run(() =>
        reactor.bindRun({ subjectId, activityId: activity.activityId, focus, runId }),
      );
      revision = "2";
      const next = await c.run(() =>
        attention.select({
          subjectId,
          naturalOpportunity: true,
          currentFocus: {
            ...focus,
            activityId: activity.activityId,
            candidateRef: first.candidate.candidateRef,
            priorityClass: first.candidate.priorityClass,
          },
        }),
      );
      const nextInput = {
        subjectId,
        activityId: activity.activityId,
        reactionId: randomUUID(),
        candidateRef: next.selected!.candidateRef,
        explanationRef: next.explanationRef,
        replace: { ...focus, continuationRef: "work-context:actual" },
      };
      await expect(c.run(() => reactor.claim(nextInput))).rejects.toThrow();
      await c.run(() =>
        reactor.settleRun({ subjectId, activityId: activity.activityId, focus, runId }),
      );
      const switched = await c.run(() => reactor.claim(nextInput));
      expect(switched.reaction.focusRevision).toBeGreaterThan(first.focusRevision);
      await expect(
        c.run(() =>
          c.persistence.mutate((context) =>
            useRepositoryMutationTransaction(context, (tx) =>
              reactor.assertCurrentIn(tx, subjectId, activity.activityId, focus),
            ),
          ),
        ),
      ).rejects.toThrow();
      expect(
        (await reactor.readReaction(subjectId, first.reactionId))?.continuationRef,
      ).toBe("work-context:actual");
      // A cancelled qualification does not erase an already completed action or original model output.
      expect((await reactor.readAction(subjectId, actionId))?.resultRefs).toEqual([
        "directory:actual",
      ]);
      const newFocus = {
        reactionId: switched.reaction.reactionId,
        focusRevision: switched.reaction.focusRevision,
      };
      const lateAction = randomUUID();
      await c.run(() =>
        reactor.beginAction({
          subjectId,
          activityId: activity.activityId,
          focus: newFocus,
          actionId: lateAction,
          action: { action: "search", target: "task:current" },
        }),
      );
      await c.run(() =>
        reactor.yield({
          subjectId,
          activityId: activity.activityId,
          focus: newFocus,
          continuationRef: "work-context:task",
          reason: "explicit_cancellation",
          revoke: true,
        }),
      );
      await c.run(() =>
        reactor.finishAction({
          subjectId,
          actionId: lateAction,
          state: "pending",
          resultRefs: ["native-run:retained"],
        }),
      );
      expect((await reactor.readAction(subjectId, lateAction))?.state).toBe("pending");
      revision = "3";
      clock += 1;
      const lastSelection = await c.run(() =>
        attention.select({ subjectId, naturalOpportunity: true }),
      );
      const last = await c.run(() =>
        reactor.claim({
          subjectId,
          activityId: activity.activityId,
          reactionId: randomUUID(),
          candidateRef: lastSelection.selected!.candidateRef,
          explanationRef: lastSelection.explanationRef,
        }),
      );
      expect(await reactor.history({ subjectId: randomUUID(), limit: 3 })).toEqual({
        reactions: [],
        more: false,
        nextReactionId: null,
      });
      const history = await reactor.history({ subjectId, limit: 1 });
      expect(history.reactions[0]!.reactionId).toBe(last.reaction.reactionId);
      const older = await reactor.history({
        subjectId,
        limit: 128,
        afterReactionId: history.nextReactionId!,
      });
      expect(older.reactions).toHaveLength(2);
      expect(older.more).toBe(false);
      expect(older.nextReactionId).toBeNull();
      expect(
        new Set(
          [...history.reactions, ...older.reactions].map((value) => value.reactionId),
        ).size,
      ).toBe(3);
      const native = createNativeCognitionBridge({
        persistence: c.persistence,
        life,
        now,
        captureObservedStamp: async () => {
          throw Error("World contacts must not invent a current mapping");
        },
        authorizeInput: async () => {},
        assertForegroundIn: async (tx, reg) => {
          if (reg.foreground)
            await reactor.assertCurrentIn(
              tx,
              reg.subjectId,
              reg.activityId,
              reg.foreground,
            );
        },
        recordContact: async () => {},
        nous: async () => {
          throw Error(
            "This recovery proof must not call a provider or cognition service",
          );
        },
      });
      const profiles = createWorldProfileService({
        persistence: c.persistence,
        now,
        worldNow: life.worldNow,
        worlds,
        resolveActor: async () => actor,
      });
      const source = createSubjectSourceContacts({
        persistence: c.persistence,
        life,
        worlds,
        foreground: reactor,
        native,
        profiles,
        now,
      });
      const sourceRef = `world-event:${worldId}:${eventId}:1`;
      const object = {
        handle: "object:canonical-event",
        owner: "world" as const,
        kind: "world_event" as const,
        sourceRef,
        sourceRevision: "1",
        label: "An unread event",
        state: "unread" as const,
        actions: ["read" as const],
      };
      const originalPlannedRun = randomUUID();
      const selectedRead = await c.run(() =>
        source.readWorld(last.reaction, object, originalPlannedRun),
      );
      expect(selectedRead.contacts).toHaveLength(2);
      const seenAt = selectedRead.contacts.map(
        (entry) =>
          sdk.decodeObservationInput(entry.observation).worldRealized!.worldObserved!
            .at,
      );
      expect(seenAt[0]!.seconds).not.toBe(seenAt[1]!.seconds);
      expect(JSON.stringify(selectedRead)).not.toContain("Author-only content");
      const register = async (
        reaction: typeof last.reaction,
        runId: string,
        selected: typeof selectedRead,
      ) =>
        c.run(() =>
          native.registerInput({
            subjectId,
            activityId: activity.activityId,
            sessionKey: "native:selection:" + runId,
            nativeAgentId: "main",
            nativeRunId: runId,
            prompt: "Read the exact selected world source",
            foreground: {
              reactionId: reaction.reactionId,
              focusRevision: reaction.focusRevision,
            },
            role: "main",
            roleScope: {
              role: "subject.deliberation",
              purpose: "subject_deliberation",
              view: "subject",
              contactNature: "subject_experience",
            },
            tokenBudget: { inputTokens: 4096, outputTokens: 512 },
            allowedToolNames: [],
            actorEntityRef: actor,
            workContextId: activity.workContextId!,
            usage: sdk.decodeCognitionUsage({
              purpose: "subject_deliberation",
              intent: "Read a known world source",
              audience: { visibility: "internal" },
              worldId,
              sourceRead: { subjectId, sourceRefs: [] },
            }),
            sourceRefs: ["world:" + worldId, sourceRef],
            messageRefs: [],
            contacts: selected.contacts,
          }),
        );
      const originalRegistration = await register(
        last.reaction,
        originalPlannedRun,
        selectedRead,
      );
      const request = (registration: typeof originalRegistration, runId: string) => ({
        version: 1 as const,
        subjectId,
        nousSessionId: randomUUID(),
        contactRequestId: randomUUID(),
        invocationId: "selection:actual",
        promptDigest: registration.promptDigest,
        native: {
          sessionKey: registration.sessionKey,
          sessionId: randomUUID(),
          runId,
          agentId: "main",
          historyGeneration: randomUUID(),
        },
      });
      clock += 180001;
      await expect(
        c.run(() =>
          reactor.beginAction({
            subjectId,
            activityId: activity.activityId,
            focus: last.reaction,
            actionId: randomUUID(),
            action: { action: "inspect" },
          }),
        ),
      ).rejects.toThrow();
      expect(
        (await reactor.readReaction(subjectId, last.reaction.reactionId))?.deadlineAt,
      ).toBe(last.reaction.deadlineAt);
      await c.run(() =>
        reactor.yield({
          subjectId,
          activityId: activity.activityId,
          focus: last.reaction,
          continuationRef: "activity:" + activity.activityId,
          reason: "reaction_deadline",
          revoke: true,
        }),
      );
      await expect(
        c.run(() => native.prepare(request(originalRegistration, originalPlannedRun))),
      ).rejects.toMatchObject({
        problem: { problemCode: "reactor.foreground_changed" },
      });
      expect(await native.readRun(originalPlannedRun)).toBeUndefined();
      revision = "4";
      const recoveryChoice = await c.run(() =>
        attention.select({ subjectId, naturalOpportunity: true }),
      );
      const recovery = await c.run(() =>
        reactor.claim({
          subjectId,
          activityId: activity.activityId,
          reactionId: randomUUID(),
          candidateRef: recoveryChoice.selected!.candidateRef,
          explanationRef: recoveryChoice.explanationRef,
        }),
      );
      const replacementRun = randomUUID();
      const replacementRead = await c.run(() =>
        source.readWorld(recovery.reaction, object, replacementRun),
      );
      expect(replacementRead.contacts.map((value) => value.contactRef)).toEqual(
        selectedRead.contacts.map((value) => value.contactRef),
      );
      expect(
        (await worlds.pendingContact({ subjectId, worldId, eventId }))!.selectedRunId,
      ).toBe(replacementRun);
      const replacementRegistration = await register(
        recovery.reaction,
        replacementRun,
        replacementRead,
      );
      await c.run(() =>
        native.prepare(request(replacementRegistration, replacementRun)),
      );
      // Once Host prepare has crossed the possible observation boundary, unknown stays on its original exact run.
      await c.run(() =>
        reactor.yield({
          subjectId,
          activityId: activity.activityId,
          focus: recovery.reaction,
          continuationRef: "activity:" + activity.activityId,
          reason: "explicit_cancellation",
          revoke: true,
        }),
      );
      revision = "5";
      const unknownChoice = await c.run(() =>
        attention.select({ subjectId, naturalOpportunity: true }),
      );
      const unknown = await c.run(() =>
        reactor.claim({
          subjectId,
          activityId: activity.activityId,
          reactionId: randomUUID(),
          candidateRef: unknownChoice.selected!.candidateRef,
          explanationRef: unknownChoice.explanationRef,
        }),
      );
      await expect(
        c.run(() => source.readWorld(unknown.reaction, object, randomUUID())),
      ).rejects.toMatchObject({ problem: { problemCode: "reactor.source_denied" } });
      expect(
        (await worlds.pendingContact({ subjectId, worldId, eventId }))!.selectedRunId,
      ).toBe(replacementRun);
    } finally {
      await c.close();
    }
  }, 15000);
});
