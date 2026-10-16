// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createMessagingService, type RawMessageFact } from "@heptalogos/messaging";
import {
  createSubjectAttentionService,
  type SubjectAttentionCandidate,
} from "@heptalogos/subject";
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
});
