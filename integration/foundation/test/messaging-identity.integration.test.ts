// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it } from "vitest";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  createMessagingService,
  prepareReadResultSchema,
  type RawMessageFact,
} from "@heptalogos/messaging";
import { createIdentityService } from "@heptalogos/identity";
import { createCanonicalMessageId } from "@heptalogos/foundation-contracts";
import { canonicalMigrationProvider } from "../../../packages/data/canonical-schema/dist/migration-provider.js";
import {
  makeFixture,
  cleanupCanonicalPostgresFixtures,
  qualifiedPgBin,
  mutateAsBootstrap,
} from "../support/canonical-postgres.js";

import { composeProductPersistence } from "../support/product-persistence.js";

const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
async function compose(fixture?: Awaited<ReturnType<typeof makeFixture>>) {
  const current = await composeProductPersistence(fixture);
  return {
    ...current,
    messaging: createMessagingService({ persistence: current.persistence }),
    identity: createIdentityService({ persistence: current.persistence }),
  };
}

const conversation = {
  platform: "qq",
  accountId: "900719925474099312345",
  conversationId: "99999999999999999999",
  kind: "group",
} as const;
function message(nativeMessageId: string): RawMessageFact {
  return {
    kind: "message",
    conversation,
    nativeMessageId,
    direction: "INBOUND",
    author: {
      accountId: "12345678901234567890",
      uid: "u_authenticated",
      displayName: "real author",
      groupCard: "group card",
    },
    platformSentAt: "2026-10-15T15:00:00.000Z",
    receivedAt: "2026-10-15T15:00:03.000Z",
    parts: [
      {
        kind: "text",
        text: "preserved body",
        nativeDataRef: "archive:segment:protected",
      },
      {
        kind: "image",
        attachment: { kind: "onebot-media", reference: "media:opaque:protected" },
      },
    ],
    references: [
      {
        kind: "forward",
        nativeId: "forward-native-id",
        sourceRef: "archive:reference:protected",
      },
      {
        kind: "reply",
        nativeId: "unavailable-parent",
        sourceRef: "archive:reference:protected",
      },
    ],
    sourceEnvelopeRef: "archive:envelope:protected",
  };
}
real.sequential("native Messaging and Host Identity on real fenced PostgreSQL", () => {
  it("deduplicates concurrent live/echo/history, retains pending work and provides bounded safe materials", async () => {
    const c = await compose();
    try {
      const duplicate = message("900719925474099399999");
      const accepted = await Promise.all(
        Array.from({ length: 16 }, () =>
          c.run(() => c.messaging.accept({ facts: [duplicate] })),
        ),
      );
      expect(
        accepted.flatMap((r) => r.results).filter((r) => r.status === "created"),
      ).toHaveLength(1);
      const first = accepted[0]!.results[0]!;
      expect(new Set(accepted.map((r) => r.results[0]!.factId)).size).toBe(1);
      expect(first.sequence).toBe(1);
      const more = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          c.run(() => c.messaging.accept({ facts: [message(`native-${i}`)] })),
        ),
      );
      expect(more.map((r) => r.results[0]!.sequence).sort((a, b) => a! - b!)).toEqual(
        Array.from({ length: 12 }, (_, i) => i + 2),
      );
      expect((await c.messaging.listPending({ limit: 100 })).pending).toHaveLength(13);
      const absentConversation = {
        ...duplicate.conversation,
        conversationId: "not-recorded",
      };
      expect(
        await c.messaging.resolveConversations({
          conversations: [duplicate.conversation, absentConversation],
        }),
      ).toEqual({ conversationIds: [first.conversationId] });
      expect(
        await c.messaging.resolveConversations({ conversations: [absentConversation] }),
      ).toEqual({ conversationIds: [] });
      const outside = await c.run(() =>
        c.messaging.accept({
          facts: [
            {
              ...message("outside-message"),
              conversation: { ...conversation, conversationId: "outside-scope" },
            },
          ],
        }),
      );
      expect(
        (
          await c.messaging.listPending({
            conversationIds: [first.conversationId],
            limit: 100,
          })
        ).pending,
      ).toHaveLength(13);
      expect(
        (await c.messaging.listPending({ conversationIds: [], limit: 100 })).pending,
      ).toEqual([]);
      expect(
        (await c.messaging.listAttachments({ conversationIds: [], limit: 100 }))
          .attachments,
      ).toEqual([]);
      expect(
        (await c.messaging.listReferences({ conversationIds: [], limit: 100 }))
          .references,
      ).toEqual([]);
      const outsideId = outside.results[0]!.factId;
      expect(
        await c.messaging.messageSources({
          messageRefs: [first.factId, outsideId],
          conversationIds: [first.conversationId],
        }),
      ).toEqual({
        sources: [
          {
            messageRef: first.factId,
            conversationId: first.conversationId,
            lifecycle: "present",
          },
        ],
      });
      expect(
        await c.messaging.messageSources({
          messageRefs: [first.factId],
          conversationIds: [],
        }),
      ).toEqual({ sources: [] });
      expect(
        (
          await c.messaging.listAttachments({
            conversationIds: [first.conversationId],
            limit: 100,
          })
        ).attachments.some((item) => item.messageId === outsideId),
      ).toBe(false);
      expect(
        (
          await c.messaging.listReferences({
            conversationIds: [first.conversationId],
            limit: 100,
          })
        ).references.some((item) => item.messageId === outsideId),
      ).toBe(false);

      expect(
        await c.messaging.readHistoryCoverage({ conversation: duplicate.conversation }),
      ).toEqual({ history: null });
      const history = await c.run(() =>
        c.messaging.updateHistoryCoverage({
          conversation: duplicate.conversation,
          expectedRevision: null,
          nativeCursor: "oldest-native-id",
          coverage: "limited",
          reason: "protocol_bounded_window",
          updatedAt: duplicate.receivedAt,
          firstNativeMessageId: duplicate.nativeMessageId,
          lastNativeMessageId: "native-11",
        }),
      );
      expect(history.revision).toBe(1);
      const raced = await Promise.allSettled(
        [1, 2].map(() =>
          c.run(() =>
            c.messaging.updateHistoryCoverage({
              ...history,
              revision: undefined,
              expectedRevision: 1,
              coverage: "gap",
              reason: "native_cursor_no_progress",
            }),
          ),
        ),
      );
      expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(
        (
          await c.messaging.readHistoryCoverage({
            conversation: duplicate.conversation,
          })
        ).history,
      ).toMatchObject({
        revision: 2,
        coverage: "gap",
        nativeCursor: "oldest-native-id",
        reason: "native_cursor_no_progress",
      });
      const audience = {
        subjectId: "subject-original",
        conversationIds: [first.conversationId],
      };
      const read = await c.messaging.prepareRead({
        window: { conversationId: first.conversationId, afterSequence: 0 },
        audience,
        budget: { maxMessages: 2, maxBytes: 100000 },
      });
      expect(compileSchema(prepareReadResultSchema).validate(read).ok).toBe(true);
      expect(read.materials).toHaveLength(2);
      expect(read.coverage.complete).toBe(false);
      expect(read.nextSequence).toBe(2);
      expect(read.materials[0]).toMatchObject({
        nativeMessageId: duplicate.nativeMessageId,
        author: duplicate.author,
        platformSentAt: duplicate.platformSentAt,
        receivedAt: duplicate.receivedAt,
      });
      expect(JSON.stringify(read)).not.toContain("protected");
      expect(
        (
          await c.messaging.prepareRead({
            messageRefs: [first.factId],
            audience: { ...audience, conversationIds: [] },
            budget: { maxMessages: 1, maxBytes: 100000 },
          })
        ).materials,
      ).toHaveLength(0);
      const tooSmall = await c.messaging.prepareRead({
        messageRefs: [first.factId],
        audience,
        budget: { maxMessages: 1, maxBytes: 1 },
      });
      expect(tooSmall.omitted[0]?.reason).toBe("byte_budget");
      const attachment = (
        await c.messaging.listAttachments({ limit: 100 })
      ).attachments.find((a) => a.messageId === first.factId)!;
      expect(attachment.conversation).toEqual(conversation);
      const acquiring = await c.run(() =>
        c.messaging.updateAttachment({
          attachmentId: attachment.attachmentId,
          expectedRevision: 0,
          state: "acquiring",
        }),
      );
      await expect(
        c.run(() =>
          c.messaging.updateAttachment({
            attachmentId: attachment.attachmentId,
            expectedRevision: 0,
            state: "acquiring",
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "messaging.state_conflict" } });
      const available = await c.run(() =>
        c.messaging.updateAttachment({
          attachmentId: attachment.attachmentId,
          expectedRevision: acquiring.revision,
          state: "available",
          cas: {
            reference: "cas:sha256:opaque",
            sha256: "a".repeat(64),
            bytes: 123,
            mediaType: "image/png",
          },
        }),
      );
      expect(available.revision).toBe(2);
      const reference = (
        await c.messaging.listReferences({ limit: 100 })
      ).references.find(
        (r) => r.messageId === first.factId && r.target.kind === "forward",
      )!;
      const partial = await c.run(() =>
        c.messaging.updateReference({
          referenceId: reference.referenceId,
          expectedRevision: 0,
          state: "partial",
          nodes: [
            {
              path: "root",
              parentPath: null,
              claimedAuthor: { accountId: "claimed-node-author" },
              platformSentAt: null,
              parts: [{ kind: "text", text: "node root" }],
            },
          ],
          reason: "node_budget",
          continuation: "archive:continuation:protected",
        }),
      );
      const safePartial = await c.messaging.prepareRead({
        messageRefs: [first.factId],
        audience,
        budget: { maxMessages: 1, maxBytes: 100000 },
      });
      expect(JSON.stringify(safePartial)).not.toContain("continuation:protected");
      expect(
        safePartial.materials[0]?.references.find(
          (r) => r.referenceId === reference.referenceId,
        ),
      ).not.toHaveProperty("continuation");
      await c.run(() =>
        c.messaging.updateReference({
          referenceId: reference.referenceId,
          expectedRevision: partial.revision,
          state: "available",
          nodes: [
            {
              path: "root/child",
              parentPath: "root",
              platformSentAt: null,
              parts: [
                {
                  kind: "image",
                  attachment: {
                    kind: "onebot-media",
                    reference: "media:forward:protected",
                  },
                },
              ],
            },
          ],
        }),
      );
      expect(
        (await c.messaging.listAttachments({ limit: 100 })).attachments.some(
          (a) =>
            a.referenceId === reference.referenceId &&
            a.nodePath?.endsWith("root/child") &&
            a.conversation.accountId === conversation.accountId &&
            a.conversation.conversationId === conversation.conversationId &&
            a.conversation.kind === "group",
        ),
      ).toBe(true);
      const expanded = await c.messaging.prepareRead({
        messageRefs: [first.factId],
        audience,
        budget: { maxMessages: 1, maxBytes: 100000 },
      });
      expect(
        expanded.materials[0]?.references.find(
          (r) => r.referenceId === reference.referenceId,
        )?.nodes,
      ).toHaveLength(2);
      expect(JSON.stringify(expanded)).not.toContain("protected");
      expect(
        (await c.messaging.listPending({ limit: 100 })).pending.some(
          (p) => p.kind === "message" && p.factId === first.factId,
        ),
      ).toBe(true);
      await c.run(() =>
        c.messaging.recordContact({
          subjectId: audience.subjectId,
          contactId: "actual-contact-1",
          messageRefs: [first.factId],
          observedAt: "2026-10-15T15:01:00.000Z",
        }),
      );
      const afterContact = (await c.messaging.listPending({ limit: 100 })).pending;
      expect(afterContact.some((p) => p.factId === first.factId)).toBe(false);
      expect(afterContact.some((p) => p.factId === more[0]!.results[0]!.factId)).toBe(
        true,
      );
      await expect(
        c.run(() =>
          c.messaging.recordContact({
            subjectId: audience.subjectId,
            contactId: "failed-contact",
            messageRefs: [more[0]!.results[0]!.factId, createCanonicalMessageId()],
            observedAt: "2026-10-15T15:01:00.000Z",
          }),
        ),
      ).rejects.toThrow();
      expect(
        (await c.messaging.listPending({ limit: 100 })).pending.some(
          (p) => p.factId === more[0]!.results[0]!.factId,
        ),
      ).toBe(true);
      const retract = (native: string, key: string) => ({
        kind: "event" as const,
        conversation,
        eventKey: key,
        eventType: "notice.group_recall",
        receivedAt: "2026-10-15T15:02:00.000Z",
        platformSentAt: null,
        sourceEnvelopeRef: "archive:retract:protected",
        targetNativeMessageId: native,
        effect: "retract" as const,
      });
      const second = more[0]!.results[0]!;
      await c.run(() =>
        c.messaging.accept({
          facts: [
            retract(duplicate.nativeMessageId, "retract-1"),
            retract("native-0", "retract-2"),
            retract("late-history", "retract-before-message"),
          ],
        }),
      );
      const late = await c.run(() =>
        c.messaging.accept({ facts: [message("late-history")] }),
      );
      expect(
        await c.messaging.messageSources({
          messageRefs: [first.factId],
          conversationIds: [first.conversationId],
        }),
      ).toEqual({
        sources: [
          {
            messageRef: first.factId,
            conversationId: first.conversationId,
            lifecycle: "retracted",
          },
        ],
      });
      const withdrawn = await c.messaging.prepareRead({
        messageRefs: [first.factId, second.factId, late.results[0]!.factId],
        audience,
        budget: { maxMessages: 10, maxBytes: 100000 },
      });
      expect(
        withdrawn.materials.find((m) => m.messageId === first.factId)?.parts,
      ).toHaveLength(2);
      for (const ref of [second.factId, late.results[0]!.factId])
        expect(withdrawn.materials.find((m) => m.messageId === ref)).toMatchObject({
          lifecycle: "retracted",
          withheld: true,
          parts: [],
          attachments: [],
          references: [],
        });
      const unknown = await c.run(() =>
        c.messaging.accept({
          facts: [
            {
              kind: "event",
              conversation,
              eventKey: "durable-receipt:unknown-1",
              eventType: "notice.future_qq_member_state",
              receivedAt: duplicate.receivedAt,
              platformSentAt: null,
              sourceEnvelopeRef: "archive:event:protected",
            },
          ],
        }),
      );
      expect(
        (await c.messaging.readEvents({ eventRefs: [unknown.results[0]!.factId] }))
          .events[0]?.eventType,
      ).toBe("notice.future_qq_member_state");
      expect(
        (
          await c.messaging.readEvents({
            eventRefs: [unknown.results[0]!.factId],
            conversationIds: [],
          })
        ).events,
      ).toEqual([]);
      await c.run(() =>
        c.messaging.completePending({ pendingRefs: [first.pendingRef] }),
      );
      await c.run(() => c.messaging.accept({ facts: [duplicate] }));
      expect(
        (await c.messaging.listPending({ limit: 100 })).pending.some(
          (p) => p.pendingRef === first.pendingRef,
        ),
      ).toBe(false);
      const reopened = createMessagingService({ persistence: c.persistence });
      expect(
        (await reopened.listPending({ limit: 100 })).pending.length,
      ).toBeGreaterThan(10);
    } finally {
      await c.close();
    }
  }, 120000);
  it("links authenticated account/UID keys without nickname merging and preserves Subject Entity across account changes", async () => {
    const c = await compose();
    try {
      const pair = {
        platform: "qq",
        accountId: "900719925474099388888",
        uid: "u_formal",
      };
      const entities = await Promise.all(
        Array.from({ length: 12 }, () => c.run(() => c.identity.resolveAccount(pair))),
      );
      expect(new Set(entities.map((e) => e.entityRef)).size).toBe(1);
      for (const entity of entities)
        expect(entity.entityRef).toMatch(/^entity:heptalogos:[0-9a-f-]{36}$/);
      const other = await c.run(() =>
        c.identity.resolveAccount({ platform: "qq", accountId: "other-account" }),
      );
      expect(other.entityRef).not.toBe(entities[0]!.entityRef);
      const group = await c.run(() =>
        c.identity.resolveGroup({ platform: "qq", groupId: pair.accountId }),
      );
      expect(group.kind).toBe("group");
      expect(group.entityRef).toMatch(/^entity:heptalogos:[0-9a-f-]{36}$/);
      expect(group.entityRef).not.toBe(entities[0]!.entityRef);
      await expect(
        c.run(() =>
          c.identity.resolveAccount({
            platform: "qq",
            accountId: "other-account",
            uid: pair.uid,
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "identity.link_conflict" } });
      const own = await c.run(() =>
        c.identity.bindSubjectAccount({
          subjectId: "existing-nous-subject",
          platform: "qq",
          accountId: "self-qq-old",
        }),
      );
      const changed = await c.run(() =>
        c.identity.bindSubjectAccount({
          subjectId: "existing-nous-subject",
          platform: "qq",
          accountId: "self-qq-new",
        }),
      );
      expect(changed.entityRef).toBe(own.entityRef);
      expect(own.entityRef).toMatch(/^entity:heptalogos:[0-9a-f-]{36}$/);
      expect(
        await c.identity.readSubjectEntity({ subjectId: "existing-nous-subject" }),
      ).toEqual({ entity: own });
      const linked = await c.run(() =>
        c.identity.linkAccount({
          entityRef: entities[0]!.entityRef,
          platform: "another-platform",
          accountId: "formal-explicit-link",
        }),
      );
      expect(linked.entityRef).toBe(entities[0]!.entityRef);
      expect(
        await c.run(() =>
          c.identity.resolveAccount({
            platform: "another-platform",
            accountId: "formal-explicit-link",
          }),
        ),
      ).toEqual(linked);
      for (const invalidRef of [
        entities[0]!.entityRef.split(":")[2]!,
        "entity:heptalogos:" + entities[0]!.entityRef,
      ]) {
        await expect(
          c.run(() =>
            c.identity.linkAccount({
              entityRef: invalidRef,
              platform: "qq",
              accountId: "invalid-opaque-link",
            }),
          ),
        ).rejects.toMatchObject({ problem: { problemCode: "identity.invalid_input" } });
      }
    } finally {
      await c.close();
    }
  }, 120000);
  it("upgrades a real legacy Subject Chat record in place without deleting its body or lineage", async () => {
    const original = canonicalMigrationProvider.getMigrations.bind(
      canonicalMigrationProvider,
    );
    canonicalMigrationProvider.getMigrations = async () =>
      Object.fromEntries(
        Object.entries(await original()).filter(([name]) => name < "0004_"),
      );
    let old: Awaited<ReturnType<typeof compose>>;
    try {
      old = await compose();
    } finally {
      canonicalMigrationProvider.getMigrations = original;
    }
    const ids = Array.from({ length: 6 }, () => createCanonicalMessageId());
    const [
      administrator,
      subject,
      conversationId,
      adminAccount,
      subjectAccount,
      messageId,
    ] = ids;
    const lineage = JSON.stringify({
      schemaVersion: 1,
      sourceActivityId: createCanonicalMessageId(),
      sourceInstanceId: old!.fixture.instanceId,
      sourceContinuityEpochId: old!.started.epoch,
    });
    await mutateAsBootstrap(
      old!.fixture,
      `INSERT INTO heptalogos.administrator VALUES(true,$1,1,'argon2id','\\x01','\\x02','\\x03',1,1,1,'NFKC-v1',now(),now());`,
      [administrator],
    );
    await mutateAsBootstrap(
      old!.fixture,
      `INSERT INTO heptalogos.subject_authority VALUES($1,$2,'STOPPED',1,now(),now(),$3::jsonb)`,
      [subject, old!.fixture.installationId, lineage],
    );
    await mutateAsBootstrap(
      old!.fixture,
      `INSERT INTO heptalogos.messaging_conversation VALUES($1,$2,'heptalogos-subject-chat',$3,$4,$5,$6,1,now(),$7::jsonb)`,
      [
        conversationId,
        old!.fixture.installationId,
        administrator,
        adminAccount,
        subject,
        subjectAccount,
        lineage,
      ],
    );
    await mutateAsBootstrap(
      old!.fixture,
      `INSERT INTO heptalogos.message_fact VALUES($1,$2,1,'INBOUND','ADMINISTRATOR',$3,'SUBJECT',$4,'retained legacy body','legacy-client-id',$5,NULL,now(),$6::jsonb)`,
      [
        messageId,
        conversationId,
        adminAccount,
        subjectAccount,
        "a".repeat(64),
        lineage,
      ],
    );
    await old!.close();
    const upgraded = await compose(old!.fixture);
    try {
      const read = await upgraded.messaging.prepareRead({
        messageRefs: [messageId!],
        audience: { subjectId: subject!, conversationIds: [conversationId!] },
        budget: { maxMessages: 10, maxBytes: 100000 },
      });
      expect(read.materials[0]).toMatchObject({
        messageId,
        conversationId,
        sequence: 1,
        platformSentAt: null,
        parts: [{ kind: "text", text: "retained legacy body" }],
      });
    } finally {
      await upgraded.close();
    }
  }, 120000);
});
