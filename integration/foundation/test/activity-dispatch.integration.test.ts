// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLifeService, assertScopeWithin } from "@heptalogos/subject";
import { createMessagingService } from "@heptalogos/messaging";
import { createIdentityService } from "@heptalogos/identity";
import { readRepositorySql } from "@heptalogos/persistence/repository";
import { createActivityDispatcher } from "../../../packages/application/product-host/src/activity-dispatch.js";
import {
  createNativeCognitionBridge,
  type NativeCognitionOptions,
} from "../../../packages/application/product-host/src/native-cognition.js";
import { createActivityOpportunity } from "../../../packages/application/product-host/src/activity-opportunity.js";
import { hasCanonicalNativeMessages } from "../../../packages/application/product-host/src/native-source-selection.js";
import { createChannelRouteStore } from "../../../packages/application/product-host/src/channel-routes.js";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const metadataUrl = new URL(
  "../../../packages/application/product-host/node_modules/@nous-wave/client/package.json",
  import.meta.url,
);
const metadata = JSON.parse(await readFile(metadataUrl, "utf8")) as {
  exports: Record<string, { import: string }>;
};
const sdk = await import(
  new URL(metadata.exports["./host-bridge"]!.import, metadataUrl).href
);
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("trusted Activity native input dispatch", () => {
  it("reads only an explicitly selected granted target while notification opportunities preserve unread state", async () => {
    const c = await composeProductPersistence();
    try {
      const now = () => new Date().toISOString();
      const subjectId = randomUUID();
      const messaging = createMessagingService({ persistence: c.persistence });
      const identity = createIdentityService({ persistence: c.persistence });
      const self = await c.run(() =>
        identity.bindSubjectAccount({ subjectId, platform: "qq", accountId: "100" }),
      );
      const author = await c.run(() =>
        identity.resolveAccount({ platform: "qq", accountId: "200" }),
      );
      const facts = await c.run(() =>
        messaging.accept({
          facts: [
            {
              kind: "message",
              conversation: {
                platform: "qq",
                accountId: "100",
                kind: "group",
                conversationId: "300",
              },
              nativeMessageId: "public",
              direction: "INBOUND",
              author: {
                accountId: "200",
                entityRef: author.entityRef,
                displayName: "actual author",
              },
              platformSentAt: "2026-10-16T01:00:00.000Z",
              receivedAt: now(),
              parts: [{ kind: "text", text: "PUBLIC ACTUAL TASK" }],
              references: [],
              sourceEnvelopeRef: "archive:public",
            },
            {
              kind: "message",
              conversation: {
                platform: "qq",
                accountId: "100",
                kind: "direct",
                conversationId: "200",
              },
              nativeMessageId: "private",
              direction: "INBOUND",
              author: { accountId: "200", entityRef: author.entityRef },
              platformSentAt: null,
              receivedAt: now(),
              parts: [{ kind: "text", text: "PRIVATE MUST NOT ENTER" }],
              references: [],
              sourceEnvelopeRef: "archive:private",
            },
          ],
        }),
      );
      const waterFacts = await c.run(() =>
        messaging.accept({
          facts: [
            {
              kind: "message",
              conversation: {
                platform: "qq",
                accountId: "100",
                kind: "group",
                conversationId: "1072706649",
              },
              nativeMessageId: "water-observe-only",
              direction: "INBOUND",
              author: { accountId: "200", entityRef: author.entityRef },
              platformSentAt: now(),
              receivedAt: now(),
              parts: [
                { kind: "text", text: "PUBLIC ACTUAL TASK WATER LEARNING MATERIAL" },
              ],
              references: [],
              sourceEnvelopeRef: "archive:water",
            },
          ],
        }),
      );
      const waterTarget =
        "conversation:heptalogos:" + waterFacts.results[0]!.conversationId;
      const publicMessage = {
        messageId: facts.results[0]!.factId,
        conversationId: facts.results[0]!.conversationId,
      };
      const privateMessage = {
        messageId: facts.results[1]!.factId,
        conversationId: facts.results[1]!.conversationId,
      };
      const target = "conversation:heptalogos:" + publicMessage.conversationId;
      let scope = {
        subjectId,
        revision: randomUUID(),
        accountId: "100",
        nativeAgentId: "qq",
        conversations: [
          {
            kind: "group" as const,
            conversationId: "300",
            receive: true,
            observe: true,
            effects: ["send" as const],
          },
          {
            kind: "group" as const,
            conversationId: "1072706649",
            receive: true,
            observe: true,
            effects: [],
          },
        ],
        tools: [],
        sourceRefs: [],
        maxRunMs: 60000,
      };
      const adopted = {
        conversations: [
          {
            conversationRef: target,
            operations: ["observe" as const, "send" as const],
          },
          { conversationRef: waterTarget, operations: ["observe" as const] },
        ],
        tools: [],
        sourceRefs: ["message:" + publicMessage.messageId],
        maxRunMs: 60000,
      };
      const life = createLifeService({
        persistence: c.persistence,
        now,
        worldNow: async () => ({ timeDomainRef: "time:real", at: now() }),
        scopeAuthority: async () => adopted,
      });
      const workContextId = randomUUID();
      let activity = await c.run(() =>
        life.propose({
          operationId: randomUUID(),
          subjectId,
          purpose: "Answer actual selected task",
          mode: "work",
          window: { notBefore: null, notAfter: null },
          sourceRefs: adopted.sourceRefs,
          workContextId,
          proposedBy: self.entityRef,
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
          adoptedBy: self.entityRef,
          scope: adopted,
        }),
      );
      activity = await c.run(() =>
        life.transition({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          action: "start",
          reason: "Actual test dispatch",
        }),
      );
      const native = createNativeCognitionBridge({
        persistence: c.persistence,
        life,
        now,
        captureObservedStamp: async () => {
          const at = sdk.timestampFromDate(new Date());
          return sdk.decodeObservationInput(
            sdk.encodeObservationInput({
              observedStamp: { timeDomainRef: "time:real", at, recordedAt: at },
            }),
          ).observedStamp!;
        },
        authorizeInput: async (registration) => {
          expect(await hasCanonicalNativeMessages(registration, messaging)).toBe(true);
        },
        recordContact: (input) => messaging.recordContact(input),
        nous: async () =>
          ({ runtime: {} }) as Awaited<ReturnType<NativeCognitionOptions["nous"]>>,
      });
      const routes = createChannelRouteStore({
        persistence: c.persistence,
        scope: async () => scope,
        now,
      });
      await c.run(() =>
        routes.register({
          accountId: "100",
          conversation: { kind: "group", id: "300" },
          nativeAgentId: "qq",
          sessionKey: "agent:qq:heptalogos-qq:group:300",
          mainSessionKey: "agent:qq:main",
          matchedBy: "binding.account",
        }),
      );
      await c.run(() =>
        routes.register({
          accountId: "100",
          conversation: { kind: "group", id: "1072706649" },
          nativeAgentId: "qq",
          sessionKey: "agent:qq:heptalogos-qq:group:1072706649",
          mainSessionKey: "agent:qq:main",
          matchedBy: "binding.account",
        }),
      );
      const wake = vi.fn(async () => ({}));
      const entry = createActivityDispatcher({
        life,
        messaging,
        identity,
        native,
        routes,
        scope: async () => scope,
        now,
        wake,
        nous: async () => ({
          runtime: {
            getWorkContext: async () => ({
              workContext: { subjectId, workContextId, state: "open" },
            }),
          },
        }),
        authorizeActivity: async (value) => assertScopeWithin(value.scope!, adopted),
      });
      const input = {
        requestId: randomUUID(),
        subjectId,
        activityId: activity.activityId,
        conversationRef: target,
        messageRefs: [publicMessage.messageId],
      };
      const unreadBefore = await messaging.listPending({
        conversationId: publicMessage.conversationId,
        limit: 128,
      });
      const view = await c.run(() => entry.prepare(input));
      expect(view.context).toMatchObject({ trigger: { kind: "message" } });
      expect(JSON.stringify(view.context)).toContain("PUBLIC ACTUAL TASK");
      expect(JSON.stringify(view)).not.toContain("PRIVATE MUST NOT ENTER");
      expect(view.contacts).toHaveLength(1);
      const observation = sdk.decodeObservationInput(view.contacts[0]!.observation);
      expect(observation.actorEntityRef).toBe(author.entityRef);
      expect(observation.occurredTime.timeDomainRef).toBe("time:real");
      expect(observation.occurredTime.extent.value.case).toBe("instant");
      expect(
        await messaging.listPending({
          conversationId: publicMessage.conversationId,
          limit: 128,
        }),
      ).toEqual(unreadBefore);
      expect(
        await readRepositorySql(
          c.persistence,
          "SELECT run_id FROM heptalogos.life_native_run",
          [],
        ),
      ).toEqual([]);
      await expect(
        c.run(() =>
          entry.prepare({ ...input, messageRefs: [privateMessage.messageId] }),
        ),
      ).rejects.toBeDefined();
      await expect(
        c.run(() => entry.prepare({ ...input, messageRefs: [] })),
      ).rejects.toBeDefined();
      // External dispatch and channel opportunities can only notify the shared Reactor.
      await expect(c.run(() => entry.dispatch(input))).rejects.toBeDefined();
      expect(wake).toHaveBeenCalledWith({ subjectId, naturalOpportunity: true });
      const opportunity = createActivityOpportunity({
        scope: async () => scope,
        enabled: async () => true,
        wake,
      });
      expect(
        await c.run(() =>
          opportunity({ accountId: "100", conversation: { kind: "group", id: "300" } }),
        ),
      ).toEqual({ decision: "considered" });
      expect(
        await messaging.listPending({
          conversationId: publicMessage.conversationId,
          limit: 128,
        }),
      ).toEqual(unreadBefore);
      const calls = wake.mock.calls.length;
      expect(
        await c.run(() =>
          opportunity({
            accountId: "100",
            conversation: { kind: "direct", id: "200" },
          }),
        ),
      ).toEqual({ decision: "defer" });
      expect(wake).toHaveBeenCalledTimes(calls);
      scope = {
        ...scope,
        conversations: scope.conversations.map((grant) => ({
          ...grant,
          observe: false,
        })),
      };
      await expect(c.run(() => entry.prepare(input))).rejects.toBeDefined();
    } finally {
      await c.close();
    }
  }, 120000);
});
