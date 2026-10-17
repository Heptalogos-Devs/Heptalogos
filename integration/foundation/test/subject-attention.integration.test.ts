// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createMessagingService, type RawMessageFact } from "@heptalogos/messaging";
import {
  createSubjectAttentionService,
  createLifeService,
  type SubjectAttentionCandidate,
} from "@heptalogos/subject";
import { createIdentityService } from "@heptalogos/identity";
import { createSubjectActivityResolver } from "../../../packages/application/product-host/src/subject-activity-resolver.js";
import { createSubjectAttentionRuntime } from "../../../packages/application/product-host/src/subject-attention-runtime.js";
import { useRepositoryMutationTransaction } from "@heptalogos/persistence/repository";
import {
  cleanupCanonicalPostgresFixtures,
  qualifiedPgBin,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("Metadata-only global Attention on real PostgreSQL", () => {
  it("prioritizes a direct contact, preserves unread facts and advances a new source revision in the same Reaction", async () => {
    const c = await composeProductPersistence(undefined, 1);
    try {
      const subjectId = randomUUID(),
        reactionId = randomUUID();
      let clock = Date.parse("2026-10-16T10:00:00.000Z");
      const now = () => new Date(clock).toISOString();
      const messaging = createMessagingService({ persistence: c.persistence });
      const hot = {
        platform: "qq",
        accountId: "100",
        kind: "group" as const,
        conversationId: "200",
      };
      const direct = { ...hot, kind: "direct" as const, conversationId: "300" };
      const excluded = { ...hot, conversationId: "400" };
      const fact = (
        conversation: RawMessageFact["conversation"],
        nativeMessageId: string,
      ): RawMessageFact => ({
        kind: "message",
        conversation,
        nativeMessageId,
        direction: "INBOUND",
        author: { accountId: "500" },
        platformSentAt: now(),
        receivedAt: now(),
        parts: [
          { kind: "text", text: "PRIVATE_UNREAD_BODY" },
          {
            kind: "image",
            attachment: { kind: "onebot-media", reference: "PRIVATE_UNREAD_MEDIA" },
          },
        ],
        references: [],
        sourceEnvelopeRef: "PRIVATE_ENVELOPE",
      });
      await c.run(() =>
        messaging.accept({
          facts: [
            fact(hot, "1"),
            fact(hot, "2"),
            fact(direct, "3"),
            fact(excluded, "4"),
          ],
        }),
      );
      const { conversationIds } = await messaging.resolveConversations({
        conversations: [hot, direct],
      });
      const noticesBefore = await messaging.notices({
        conversations: conversationIds.map((conversationId) => ({ conversationId })),
        selfAccountId: "100",
        perConversationLimit: 2,
      });
      expect(noticesBefore.notices).toHaveLength(3);
      expect(JSON.stringify(noticesBefore)).not.toMatch(
        /PRIVATE_|parts|attachment|sourceEnvelopeRef/,
      );
      expect(noticesBefore.notices.filter((notice) => notice.direct)).toHaveLength(1);
      let important = false;
      const attention = createSubjectAttentionService({
        persistence: c.persistence,
        now,
        policy: async () => ({
          candidateLimit: 4,
          perSourceLimit: 2,
          messageBatchLimit: 2,
          coalesceMs: 0,
          reconsiderMs: 120000,
        }),
        candidates: async ({ positions }) => {
          const notices = await messaging.notices({
            conversations: conversationIds.map((conversationId) => ({
              conversationId,
              afterSequence: positions.find(
                (position) => position.sourceKey === conversationId,
              )?.sourcePosition,
            })),
            selfAccountId: "100",
            perConversationLimit: 2,
          });
          const candidates: SubjectAttentionCandidate[] = notices.notices.map(
            (notice) => ({
              subjectId,
              candidateRef: "notice:" + notice.messageRef,
              sourceOwner: "messaging",
              sourceKey: notice.conversationId,
              sourceRef: notice.messageRef,
              sourceRevision: notice.sequence,
              sourcePosition: notice.sequence,
              kind: "message",
              priorityClass: notice.direct ? "direct" : "background",
              availableAt: notice.receivedAt,
              related: false,
              metadata: {
                label: "Unread notification",
                conversationRef: "conversation:heptalogos:" + notice.conversationId,
                messageRefs: [notice.messageRef],
                unreadCount: notice.unreadCount,
                direct: notice.direct,
              },
            }),
          );
          if (important)
            candidates.push({
              subjectId,
              candidateRef: "due:actual",
              sourceOwner: "life",
              sourceKey: "due:actual",
              sourceRef: "due:actual",
              sourceRevision: "1",
              kind: "schedule",
              priorityClass: "important",
              availableAt: now(),
              related: false,
              metadata: { label: "Actual due commitment" },
            });
          return { candidates, more: false };
        },
      });
      const selected = await c.run(() => attention.select({ subjectId }));
      expect(selected.selected?.metadata.direct).toBe(true);
      expect(
        new Set(selected.candidates.map((candidate) => candidate.sourceKey)).size,
      ).toBe(2);
      expect(
        JSON.stringify(await attention.explain(subjectId, selected.explanationRef)),
      ).not.toMatch(/PRIVATE_|parts|attachment/);
      const considered = await c.run(() =>
        c.persistence.mutate((context) =>
          useRepositoryMutationTransaction(context, (tx) =>
            attention.recordConsidered(
              {
                subjectId,
                reactionId,
                candidateRef: selected.selected!.candidateRef,
                explanationRef: selected.explanationRef,
              },
              tx,
            ),
          ),
        ),
      );
      clock += 1000;
      const replay = await c.run(() =>
        attention.recordConsidered({
          subjectId,
          reactionId,
          candidateRef: selected.selected!.candidateRef,
          explanationRef: selected.explanationRef,
        }),
      );
      expect(replay.consideredAt).toBe(considered.consideredAt);
      expect(await messaging.listPending({ conversationIds, limit: 10 })).toMatchObject(
        { pending: expect.any(Array) },
      );
      expect(
        (await messaging.listPending({ conversationIds, limit: 10 })).pending,
      ).toHaveLength(3);
      const focus = {
        reactionId,
        activityId: randomUUID(),
        focusRevision: 1,
        candidateRef: selected.selected!.candidateRef,
        priorityClass: "direct" as const,
      };
      expect(
        (await c.run(() => attention.select({ subjectId, currentFocus: focus }))).state,
      ).toBe("focus_retained");
      important = true;
      expect(
        (await c.run(() => attention.select({ subjectId, currentFocus: focus })))
          .switchRequested?.candidateRef,
      ).toBe("due:actual");
      important = false;
      await c.run(() => messaging.accept({ facts: [fact(direct, "5")] }));
      const next = await c.run(() => attention.select({ subjectId }));
      expect(next.selected?.metadata.direct).toBe(true);
      const advanced = await c.run(() =>
        attention.recordConsidered({
          subjectId,
          reactionId,
          candidateRef: next.selected!.candidateRef,
          explanationRef: next.explanationRef,
        }),
      );
      expect(advanced.sourceRevision).not.toBe(considered.sourceRevision);
      expect(advanced.consideredAt).toBe(now());
      expect(
        (await messaging.listPending({ conversationIds, limit: 10 })).pending,
      ).toHaveLength(4);
      expect(
        (
          await messaging.notices({
            conversations: [],
            selfAccountId: "100",
            perConversationLimit: 2,
          })
        ).notices,
      ).toHaveLength(0);
    } finally {
      await c.close();
    }
  }, 60000);
  it("ranks before source caps, revisits pending metadata only at natural nodes and keeps reads unconsumed", async () => {
    const c = await composeProductPersistence(undefined, 1);
    try {
      const subjectId = randomUUID(),
        now = () => "2026-10-16T10:00:00.000Z";
      const messaging = createMessagingService({ persistence: c.persistence });
      const group = {
        platform: "qq",
        accountId: "100",
        kind: "group" as const,
        conversationId: "200",
      };
      const facts: RawMessageFact[] = [false, true].map((mention, i) => ({
        kind: "message",
        conversation: group,
        nativeMessageId: String(i + 1),
        direction: "INBOUND",
        author: { accountId: "500" },
        platformSentAt: now(),
        receivedAt: now(),
        parts: mention
          ? [{ kind: "at", targetId: "100", atAll: false }]
          : [{ kind: "text", text: "PRIVATE_UNREAD" }],
        references: [],
        sourceEnvelopeRef: "PRIVATE_ENVELOPE",
      }));
      await c.run(() => messaging.accept({ facts }));
      const settings = async () => ({
        nous: { runRoot: "fixture", expectedInstanceId: null },
        subject: { id: subjectId, enabled: true },
        subjectGateway: { origin: "http://127.0.0.1:1" },
        maintenanceGateway: { origin: "http://127.0.0.1:2" },
        qq: {
          accountId: "100",
          nativeAgentId: "fixture",
          tools: [],
          sourceRefs: [],
          maxRunMs: 180000,
          conversations: [
            {
              kind: "group" as const,
              conversationId: "200",
              receive: true,
              observe: true,
              effects: [],
            },
          ],
        },
        reactor: {
          candidateLimit: 2,
          perSourceLimit: 2,
          messageBatchLimit: 1,
          coalesceMs: 0,
          reconsiderMs: 120000,
        },
      });
      const make = () =>
        createSubjectAttentionRuntime({
          persistence: c.persistence,
          settings,
          messaging,
          now,
          life: {
            schedule: async () => ({ activities: [], nextId: null }),
            worldNow: async () => ({ timeDomainRef: "time:real", at: now() }),
          },
          worlds: { pendingContacts: async () => [] },
          profiles: { entryNotice: async () => undefined },
          narrative: {
            pendingCommitments: async () => ({ commitments: [], more: false }),
          },
          native: {
            readyResults: async () => ({ runs: [], more: false }),
            hasAcceptedSource: async () => false,
          },
        });
      // A source may supply older background before a known direct opportunity.
      // Two metadata batches must be collected even when the final selection has one slot.
      const owner = createSubjectAttentionService({
        persistence: c.persistence,
        now,
        policy: async () => ({
          candidateLimit: 1,
          perSourceLimit: 1,
          messageBatchLimit: 1,
          coalesceMs: 0,
          reconsiderMs: 120000,
        }),
        candidates: async () => ({
          more: false,
          candidates: ["background", "direct"].map((p, i) => ({
            subjectId,
            candidateRef: "known:" + i,
            sourceOwner: "messaging" as const,
            sourceKey: "same",
            sourceRef: "ref:" + i,
            sourceRevision: String(i),
            kind: "message" as const,
            priorityClass: p as "background" | "direct",
            availableAt: now(),
            related: false,
            metadata: { label: "metadata" },
          })),
        }),
      });
      expect(
        (await c.run(() => owner.select({ subjectId }))).selected?.priorityClass,
      ).toBe("direct");
      const runtime = make();
      const first = await c.run(() => runtime.select({ subjectId, limit: 1 }));
      await c.run(() =>
        runtime.recordConsidered({
          subjectId,
          reactionId: randomUUID(),
          candidateRef: first.selected!.candidateRef,
          explanationRef: first.explanationRef,
        }),
      );
      expect(first.selected?.priorityClass).toBe("direct");
      // End-of-page is not permission to create another paid reaction to old unread work.
      expect(
        (await c.run(() => make().select({ subjectId }))).selected?.sourceOwner,
      ).not.toBe("messaging");
      expect(
        (
          await c.run(() => make().select({ subjectId, naturalOpportunity: true }))
        ).candidates.some((candidate) => candidate.sourceOwner === "messaging"),
      ).toBe(true);
      expect(
        (
          await messaging.listPending({
            conversationIds: (
              await messaging.resolveConversations({ conversations: [group] })
            ).conversationIds,
            limit: 10,
          })
        ).pending,
      ).toHaveLength(2);
    } finally {
      await c.close();
    }
  });
  it("concurrently creates/adopts/resumes one own-life per audience and never shares audience context", async () => {
    const c = await composeProductPersistence(undefined, 1);
    try {
      const subjectId = randomUUID(),
        now = () => "2026-10-16T10:00:00.000Z";
      const identity = createIdentityService({ persistence: c.persistence });
      const conversations = ["a", "b"].map((k) => ({
        conversationRef: "conversation:" + k,
        operations: ["observe", "send"] as ("observe" | "send")[],
      }));
      const scope = { conversations, tools: [], sourceRefs: [], maxRunMs: 180000 };
      const life = createLifeService({
        persistence: c.persistence,
        now,
        worldNow: async () => ({ timeDomainRef: "time:real", at: now() }),
        scopeAuthority: async () => scope,
      });
      const constraints = new Map<string, unknown>();
      let resumeArrivals = 0;
      let releaseResume!: () => void;
      const resumeGate = new Promise<void>((resolve) => {
        releaseResume = resolve;
      });
      const resolve = createSubjectActivityResolver({
        life,
        identity,
        settings: async () => ({
          nous: { runRoot: "fixture", expectedInstanceId: null },
          subject: { id: subjectId, enabled: true },
          subjectGateway: { origin: "http://127.0.0.1:1" },
          maintenanceGateway: { origin: "http://127.0.0.1:2" },
        }),
        scopeFor: async () => scope,
        authorize: async (activity) => {
          if (activity.continuationRequired) {
            if (++resumeArrivals === 2) releaseResume();
            await resumeGate;
          }
        },
        nous: async () => ({
          runtime: {
            createWorkContext: async (input) => {
              expect(input.entityAnchors).toEqual([]);
              constraints.set(input.operationId!, input.constraints);
              return {
                $typeName: "nous.wave.v1alpha1.WorkContextResponse",
                degradation: [],
                workContext: {
                  $typeName: "nous.wave.v1alpha1.WorkContext",
                  workContextId: input.operationId!,
                  subjectId,
                  state: "open",
                  purpose: input.purpose!,
                  unresolvedQuestions: [],
                  constraints: input.constraints,
                  resumeConditions: [],
                  revision: 1n,
                  cognitionAnchors: [],
                  contextText: input.contextText!,
                  entityAnchors: [],
                  tagAnchors: [],
                },
              };
            },
          },
        }),
      });
      const candidate = (audience: string): SubjectAttentionCandidate => ({
        subjectId,
        candidateRef: audience,
        sourceOwner: "messaging",
        sourceKey: audience,
        sourceRef: audience,
        sourceRevision: "1",
        kind: "message",
        priorityClass: "direct",
        availableAt: now(),
        related: false,
        metadata: { label: "metadata", conversationRef: audience },
      });
      const a = candidate("conversation:a"),
        b = candidate("conversation:b");
      const pair = await c.run(() => Promise.all([resolve(a), resolve(a)]));
      expect(pair[0]?.activityId).toBe(pair[1]?.activityId);
      expect(pair[0]?.scope?.conversations.map((x) => x.conversationRef)).toEqual([
        "conversation:a",
      ]);
      const other = await c.run(() => resolve(b));
      expect(other?.activityId).not.toBe(pair[0]?.activityId);
      expect(other?.workContextId).not.toBe(pair[0]?.workContextId);
      expect(other?.scope?.conversations.map((x) => x.conversationRef)).toEqual([
        "conversation:b",
      ]);
      expect(
        new Set([...constraints.values()].map((x) => JSON.stringify(x))).size,
      ).toBe(2);
      await c.run(() => life.recover(subjectId));
      const resumed = await c.run(() => Promise.all([resolve(a), resolve(a)]));
      expect(
        resumed.every(
          (x) =>
            x !== undefined &&
            x.activityId === pair[0]?.activityId &&
            !x.continuationRequired,
        ),
      ).toBe(true);
    } finally {
      await c.close();
    }
  });
});
