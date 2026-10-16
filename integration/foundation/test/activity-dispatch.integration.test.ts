// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLifeService, assertScopeWithin } from "@heptalogos/subject";
import { createMessagingService } from "@heptalogos/messaging";
import { createIdentityService } from "@heptalogos/identity";
import { readRepositorySql } from "@heptalogos/persistence/repository";
import {
  createActivityDispatcher,
  type ActivityDispatchOptions,
} from "../../../packages/application/product-host/src/activity-dispatch.js";
import {
  createNativeCognitionBridge,
  type NativeCognitionOptions,
} from "../../../packages/application/product-host/src/native-cognition.js";
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
  it("selects only the adopted target, persists exact raw input before one call, retains outcomes and never replays failures", async () => {
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
      const publicMessage = {
        messageId: facts.results[0]!.factId,
        conversationId: facts.results[0]!.conversationId,
      };
      const privateMessage = { messageId: facts.results[1]!.factId };
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
        authorizeInput: async () => {},
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
      let fail = false;
      const dispatch = vi.fn<NonNullable<ActivityDispatchOptions["dispatch"]>>(
        async (params) => {
          const saved = await readRepositorySql<{
            document: {
              prompt: string;
              registration: { usage: unknown; contacts: { observation: unknown }[] };
              dispatch: { params: unknown };
            };
          }>(
            c.persistence,
            "SELECT document FROM heptalogos.life_native_input WHERE native_run_id=$1",
            [params.idempotencyKey],
          );
          expect(saved[0]!.document.prompt).toBe(params.message);
          expect(saved[0]!.document.dispatch.params).toEqual(params);
          expect(params.message).toContain("PUBLIC ACTUAL TASK");
          expect(params.message).not.toContain("PRIVATE MUST NOT ENTER");
          const usage = sdk.decodeCognitionUsage(saved[0]!.document.registration.usage);
          expect(usage.sourceRead.originConversationRefs).toEqual([target]);
          expect(usage.sourceRead.sourceRefs).toEqual([
            expect.objectContaining({ kind: "work_context", value: workContextId }),
          ]);
          const observation = sdk.decodeObservationInput(
            saved[0]!.document.registration.contacts[0]!.observation,
          );
          expect(observation.actorEntityRef).toBe(author.entityRef);
          expect(observation.occurredTime.value.case).toBe("instant");
          expect(typeof observation.context.host_received_at).toBe("string");
          await native.prepare({
            version: 1,
            subjectId,
            contactRequestId: randomUUID(),
            invocationId: randomUUID(),
            nousSessionId: randomUUID(),
            promptDigest: createHash("sha256").update(params.message).digest("hex"),
            native: {
              agentId: params.agentId,
              sessionKey: params.sessionKey,
              sessionId: randomUUID(),
              historyGeneration: randomUUID(),
              runId: params.idempotencyKey,
            },
          });
          if (fail) throw Error("SDK failed after potential execution");
          return {
            status: "terminal",
            result: { payloads: [{ text: "retained actual native final" }] },
          };
        },
      );
      const options: ActivityDispatchOptions = {
        life,
        messaging,
        identity,
        native,
        routes,
        scope: async () => scope,
        now,
        dispatch,
        nous: async () =>
          ({
            runtime: {
              getWorkContext: async () => ({
                workContext: { subjectId, workContextId, state: "active" },
              }),
            },
          }) as Awaited<ReturnType<ActivityDispatchOptions["nous"]>>,
        authorizeActivity: async (value) => {
          assertScopeWithin(value.scope!, adopted);
        },
      };
      const entry = createActivityDispatcher(options);
      const input = {
        requestId: randomUUID(),
        subjectId,
        activityId: activity.activityId,
        conversationRef: target,
        messageRefs: [publicMessage.messageId],
      };
      const [first, duplicate] = await Promise.all([
        c.run(() => entry.dispatch(input)),
        c.run(() => entry.dispatch(input)),
      ]);
      expect(dispatch).toHaveBeenCalledTimes(1);
      expect(first.nativeRunId).toBe(duplicate.nativeRunId);
      expect(first.nativeRunId).toBe(input.requestId);
      expect((await native.readRun(first.nativeRunId))!.state).toBe("completed");
      expect(first.promptDigest).toBe(
        createHash("sha256").update(dispatch.mock.calls[0]![0].message).digest("hex"),
      );
      expect((await c.run(() => entry.dispatch(input))).result).toEqual({
        payloads: [{ text: "retained actual native final" }],
      });
      await expect(
        c.run(() =>
          entry.dispatch({ ...input, messageRefs: [privateMessage.messageId] }),
        ),
      ).rejects.toBeDefined();
      await expect(
        c.run(() =>
          entry.dispatch({
            ...input,
            requestId: randomUUID(),
            messageRefs: [privateMessage.messageId],
          }),
        ),
      ).rejects.toBeDefined();
      fail = true;
      const failed = { ...input, requestId: randomUUID() };
      expect((await c.run(() => entry.dispatch(failed))).state).toBe("uncertain");
      expect((await native.readRun(failed.requestId))!.state).toBe("uncertain");
      expect((await c.run(() => entry.dispatch(failed))).state).toBe("uncertain");
      expect(dispatch).toHaveBeenCalledTimes(2);
      scope = {
        ...scope,
        conversations: scope.conversations.map((v) => ({ ...v, effects: [] })),
      };
      await expect(
        c.run(() => entry.dispatch({ ...input, requestId: randomUUID() })),
      ).rejects.toBeDefined();
      await expect(c.run(() => entry.dispatch(input))).rejects.toBeDefined();
      expect(dispatch).toHaveBeenCalledTimes(2);
    } finally {
      await c.close();
    }
  }, 120000);
});
