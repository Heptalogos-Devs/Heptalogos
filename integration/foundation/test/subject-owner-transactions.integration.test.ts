// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { createEvidenceService } from "@heptalogos/evidence";
import { createIdentityService } from "@heptalogos/identity";
import { createMessagingService } from "@heptalogos/messaging";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import {
  createAgencyService,
  createLifeService,
  createWorldLifeService,
} from "@heptalogos/subject";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeCognitionBridge } from "../../../packages/application/product-host/dist/native-cognition.js";
import { createConfigurationService } from "../../../packages/system/configuration/dist/index.js";
import {
  ProductManagement,
  productSettingsDefinition,
} from "../../../packages/system/management/dist/index.js";
import {
  cleanupCanonicalPostgresFixtures,
  qualifiedPgBin,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const metadataUrl = new URL(
  "../../../packages/application/product-host/node_modules/@nous-wave/client/package.json",
  import.meta.url,
);
const metadata = JSON.parse(await readFile(metadataUrl, "utf8"));
const sdk = await import(
  new URL(metadata.exports["./host-bridge"].import, metadataUrl).href
);
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("Subject authority reuses the caller's sole PostgreSQL connection", () => {
  it("registers, adopts and fences the real send point through canonical owners without nested pool reads", async () => {
    const c = await composeProductPersistence(undefined, 1);
    try {
      const now = () => new Date().toISOString();
      const domain = "time:owner-world";
      let worldNow = now();
      const subjectId = randomUUID(),
        worldId = randomUUID();
      const identity = createIdentityService({ persistence: c.persistence });
      const actor = (await c.run(() => identity.ensureSubjectEntity({ subjectId })))
        .entityRef;
      const messaging = createMessagingService({ persistence: c.persistence });
      const conversation = {
        platform: "qq",
        accountId: "100",
        kind: "group" as const,
        conversationId: "200",
      };
      await c.run(() =>
        messaging.accept({
          facts: [
            {
              kind: "message",
              conversation,
              nativeMessageId: "300",
              direction: "INBOUND",
              author: { accountId: "400", displayName: "sender" },
              platformSentAt: now(),
              receivedAt: now(),
              parts: [{ kind: "text", text: "actual persisted message" }],
              references: [],
              sourceEnvelopeRef: "fixture:envelope",
            },
          ],
        }),
      );
      const conversationId = (
        await messaging.resolveConversations({ conversations: [conversation] })
      ).conversationIds[0]!;
      const messages = await messaging.prepareRead({
        window: { conversationId, afterSequence: 0 },
        audience: { subjectId, conversationIds: [conversationId] },
        budget: { maxMessages: 1, maxBytes: 4096 },
      });
      const messageRef = messages.materials[0]!.messageId;
      const worlds = createWorldLifeService({
        persistence: c.persistence,
        now,
        worldNow: async () => ({ timeDomainRef: domain, at: worldNow }),
      });
      await c.run(() =>
        worlds.configure({
          operationId: randomUUID(),
          expectedRevision: 0,
          definition: {
            subjectId,
            worldId,
            revision: 1,
            name: "Owner fixture",
            timeDomainRef: domain,
            timezone: "UTC",
            offlinePolicy: "pause_with_host",
            places: [{ placeRef: "room", name: "Room", description: "Owner test" }],
            actors: [
              { entityRef: actor, name: "Subject", description: "Canonical self" },
            ],
            subjectActorRef: actor,
            rules: "Local fixture",
            creationScope: "No external effects",
            informationSourceRefs: [],
          },
          schedule: [],
        }),
      );
      const configuration = createConfigurationService({
        definitions: [productSettingsDefinition],
        persistence: c.persistence,
        time: c.time,
        execution: c.runtime,
        evidence: createEvidenceService(c.time),
      });
      const revision = await c.run(() =>
        configuration.createRevision({
          definitionId: productSettingsDefinition.definitionId,
          scopeRef: {
            schemaVersion: 1,
            resourceKind: "installation",
            resourceId: c.started.host.installationId,
          },
          value: {
            nous: { runRoot: "/fixture/nous", expectedInstanceId: null },
            subject: { id: subjectId, enabled: true },
            subjectGateway: { origin: "http://127.0.0.1:19471" },
            maintenanceGateway: { origin: "http://127.0.0.1:19472" },
          },
        }),
      );
      await c.run(() => configuration.activate({ revisionId: revision.revisionId }));
      const product = new ProductManagement({
        configuration,
        installationId: c.started.host.installationId,
        bootId: c.started.host.bootId,
        startedAt: now(),
        dependencies: async () => [],
        runMutation: (_kind, operation) => c.run(operation),
        subjects: {
          get: async () => {
            throw new Error("No cognition network in authority transaction");
          },
          create: async () => {
            throw new Error("No cognition mutation in authority transaction");
          },
        },
      });
      const scope = {
        conversations: [
          {
            conversationRef: `conversation:heptalogos:${conversationId}`,
            operations: ["observe" as const, "send" as const],
          },
        ],
        tools: [],
        sourceRefs: [`world:${worldId}`],
        maxRunMs: 60000,
      };
      const life = createLifeService({
        persistence: c.persistence,
        now,
        worldNow: async () => ({ timeDomainRef: domain, at: worldNow }),
        scopeAuthority: async () => scope,
      });
      let activity = await c.run(() =>
        life.propose({
          operationId: randomUUID(),
          subjectId,
          purpose: "Prove the actual short transaction authority path",
          mode: "work",
          window: { notBefore: null, notAfter: null },
          proposedBy: actor,
          sourceRefs: [],
          workContextId: randomUUID(),
          world: { timeDomainRef: domain, at: now() },
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
          reason: "Explicit fixture adoption",
        }),
      );
      let txChecks = 0;
      const authorityReads = async (tx?: PersistenceInternalTransaction) => {
        expect((await product.configuration(tx)).settings?.subject).toEqual({
          id: subjectId,
          enabled: true,
        });
        expect(
          (await identity.readSubjectEntity({ subjectId }, tx)).entity?.entityRef,
        ).toBe(actor);
        expect(
          (await messaging.resolveConversations({ conversations: [conversation] }, tx))
            .conversationIds,
        ).toEqual([conversationId]);
        expect(
          (
            await messaging.messageSources(
              { messageRefs: [messageRef], conversationIds: [conversationId] },
              tx,
            )
          ).sources[0]?.lifecycle,
        ).toBe("present");
        expect(
          (
            await messaging.prepareRead(
              {
                messageRefs: [messageRef],
                audience: { subjectId, conversationIds: [conversationId] },
                budget: { maxMessages: 1, maxBytes: 4096 },
              },
              tx,
            )
          ).materials[0]?.messageId,
        ).toBe(messageRef);
        expect(
          await worlds.resolveSourceRefs(
            { subjectId, sourceRefs: [`world:${worldId}`] },
            tx,
          ),
        ).toEqual([`world:${worldId}`]);
        expect((await life.get(subjectId, activity.activityId, tx))?.state).toBe(
          "active",
        );
        if (tx) txChecks++;
      };
      const native = createNativeCognitionBridge({
        persistence: c.persistence,
        life,
        now,
        captureObservedStamp: async () =>
          sdk.decodeObservationInput(
            sdk.encodeObservationInput({
              observedStamp: {
                timeDomainRef: domain,
                at: sdk.timestampFromDate(new Date(worldNow)),
                recordedAt: sdk.timestampFromDate(new Date()),
              },
            }),
          ).observedStamp!,
        authorizeInput: async (_registration, _activity, tx) => authorityReads(tx),
        recordContact: (input) => messaging.recordContact(input),
        nous: async () => {
          throw new Error("No cognition request in authority transaction");
        },
      });
      const runId = randomUUID();
      const registered = await c.run(() =>
        native.registerInput({
          subjectId,
          activityId: activity.activityId,
          nativeRunId: runId,
          nativeAgentId: "main",
          sessionKey: "fixture:single-connection",
          prompt: "Explicit selected source",
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
            audience: {
              visibility: "group",
              conversationRef: scope.conversations[0]!.conversationRef,
            },
            sourceRead: { subjectId, sourceRefs: [] },
          }),
          sourceRefs: [],
          messageRefs: [],
          contacts: [],
        }),
      );
      const contact = {
        version: 1 as const,
        subjectId,
        nousSessionId: randomUUID(),
        contactRequestId: randomUUID(),
        invocationId: "provider:1",
        promptDigest: registered.promptDigest,
        native: {
          sessionKey: "fixture:single-connection",
          sessionId: "fixture:session",
          runId,
          agentId: "main",
          historyGeneration: "fixture:generation",
        },
      };
      const prepared = await c.run(() => native.prepare(contact));
      await c.run(() =>
        native.admitted({
          ...sdk.hostContactIdentitySchema.strip().parse(contact),
          occurrences: [],
          projection: sdk.encodeProjection({
            projectionId: randomUUID(),
            consumerId: "consumer:owner-fixture",
            subjectId,
            sessionId: contact.nousSessionId,
            usage: sdk.decodeCognitionUsage(prepared.usage),
          }),
        }),
      );
      const agency = createAgencyService({
        persistence: c.persistence,
        now,
        checkSources: async () => {},
        authority: async (id, _recipient, tx) => {
          await authorityReads(tx);
          const run = await native.readRun(id, tx);
          expect(run?.registration.actorEntityRef).toBe(actor);
          return {
            activity: (await life.get(subjectId, activity.activityId, tx))!,
            role: "subject.render",
            actorEntityRef: actor,
            conversationRef: scope.conversations[0]!.conversationRef,
            sourceRefs: [],
            authorizedDerivedSourceRefs: [],
            messageSources: [],
          };
        },
      });
      const request = {
        channel: "qq",
        accountId: "100",
        to: "group:200",
        runId,
        nativeIntentId: randomUUID(),
        preparedBatch: {
          schemaVersion: 1,
          runId,
          entries: [
            {
              sourceIndex: 0,
              status: "accepted",
              payload: { text: "Exact adopted statement" },
            },
          ],
        },
      };
      const adopted = await c.run(() => agency.adoptDelivery(request));
      const part = {
        reference: adopted.reference,
        channel: request.channel,
        accountId: request.accountId,
        to: request.to,
        deliveryQueueId: "fixture:queue",
        payload: {
          sourceIndex: 0,
          kind: "text" as const,
          text: "Exact adopted statement",
        },
      };
      await expect(c.run(() => agency.authorizeDelivery(part))).resolves.toMatchObject({
        authorized: true,
      });
      await expect(c.run(() => agency.beginDelivery(part))).resolves.toMatchObject({
        action: "send",
      });
      expect(txChecks).toBeGreaterThanOrEqual(3);
    } finally {
      await c.close();
    }
  }, 120000);
});
