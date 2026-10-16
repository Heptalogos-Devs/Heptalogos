// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createIdentityService } from "@heptalogos/identity";
import { createMessagingService } from "@heptalogos/messaging";
import {
  createLifeService,
  createAgencyService,
  createWorldLifeService,
} from "@heptalogos/subject";
import { createEvidenceService } from "@heptalogos/evidence";
import { createConfigurationService } from "../../../packages/system/configuration/dist/index.js";
import {
  ProductManagement,
  productSettingsDefinition,
} from "../../../packages/system/management/dist/index.js";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import { hasAuthorizedNativeSources } from "../../../packages/application/product-host/dist/native-source-selection.js";
import { createNativeCognitionBridge } from "../../../packages/application/product-host/dist/native-cognition.js";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
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
        captureObservedStamp: async () => {
          throw new Error("Empty selected contacts must not read the Subject clock");
        },
        authorizeInput: async (_registration, _activity, tx) => authorityReads(tx),
        recordContact: messaging.recordContact,
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
      // Optional cross-owner proof uses the actual independently started Nous
      // installation, never a model provider or the user's live runtime.
      if (process.env.HEPTALOGOS_TEST_NOUS_RUN_ROOT) {
        const node = await import(
          new URL(metadata.exports["./node"].import, metadataUrl).href
        );
        const client = await node.connectNousInstance({
          runRoot: process.env.HEPTALOGOS_TEST_NOUS_RUN_ROOT,
        });
        await client.subjects.createSubject({
          subjectId,
          operationId: randomUUID(),
          capabilities: {
            memory: false,
            selfCognition: false,
            socialCognition: false,
            motivation: false,
          },
        });
        await client.clocks.configureClock({
          subjectId,
          operationId: randomUUID(),
          timeDomainRef: domain,
          rate: 0,
          worldTime: sdk.timestampFromDate(new Date("2080-01-01T09:00:00.000Z")),
        });
        const session = await client.runtime.openSession({ subjectId });
        const clock = await client.clocks.readClock({ subjectId });
        const worldAt = new Date(
          Number(clock.now.at.seconds) * 1000 + clock.now.at.nanos / 1e6,
        ).toISOString();
        worldNow = worldAt;
        const interval = {
          timeDomainRef: domain,
          start: new Date(Date.parse(worldAt) - 60000).toISOString(),
          end: worldAt,
        };
        const eventId = randomUUID();
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
                title: "Actual world event",
                content: "Hidden author details",
                actorRefs: [actor],
                placeRef: "room",
                scheduleId: null,
                parentEventId: null,
                causalEventRefs: [],
                overlap: "exclusive",
                source: {
                  kind: "rule",
                  producerRef: "fixture:world-owner",
                  sourceRefs: [],
                },
                perceptions: [
                  {
                    actorRef: actor,
                    kind: "seen",
                    at: { timeDomainRef: domain, at: worldAt },
                    content: "I actually saw the event",
                  },
                ],
              },
            ],
          }),
        );
        const event = (await worlds.pendingContacts(subjectId, worldId))[0]!;
        const sourceRef = event.sourceRef;
        let captures = 0;
        const stampBridge = createNativeCognitionBridge({
          persistence: c.persistence,
          life,
          now,
          captureObservedStamp: async () => {
            captures++;
            return (await client.clocks.readClock({ subjectId })).now;
          },
          authorizeInput: async (registration, current, tx) => {
            await authorityReads(tx);
            expect(hasAuthorizedNativeSources(current, registration)).toBe(true);
            expect(
              await worlds.resolveSourceRefs(
                { subjectId, sourceRefs: [sourceRef] },
                tx,
              ),
            ).toEqual([sourceRef]);
          },
          recordContact: messaging.recordContact,
          nous: async () => client,
        });
        const worldObservation = sdk.encodeObservationInput({
          subjectId,
          requestId: randomUUID(),
          sourceClass: "world_realized",
          externalObjectRef: "object:heptalogos:" + sourceRef,
          actorEntityRef: actor,
          observedAt: sdk.timestampFromDate(new Date()),
          occurredTime: {
            timeDomainRef: interval.timeDomainRef,
            extent: {
              value: {
                case: "interval",
                value: {
                  start: sdk.timestampFromDate(new Date(interval.start)),
                  end: sdk.timestampFromDate(new Date(interval.end)),
                },
              },
            },
          },
          worldRealized: {
            worldId,
            eventId,
            eventRevision: String(event.eventRevision),
            producerRef: event.source.producerRef,
            generationMethod: event.source.kind,
            realizedAt: sdk.timestampFromDate(new Date(event.recordedAt)),
            worldObserved: {
              timeDomainRef: interval.timeDomainRef,
              at: sdk.timestampFromDate(new Date(worldAt)),
              recordedAt: sdk.timestampFromDate(new Date()),
            },
            sharedOriginRefs: [event.source.producerRef],
          },
          material: {
            case: "inlineText",
            value: { text: event.perceptions[0]!.content, mediaType: "text/plain" },
          },
        });
        const sourceContacts = [
          { contactRef: sourceRef + ":perception:0", observation: worldObservation },
          {
            contactRef: "message:" + messageRef,
            observation: sdk.encodeObservationInput({
              subjectId,
              requestId: randomUUID(),
              sourceClass: "message",
              externalObjectRef: "object:heptalogos:message:" + messageRef,
              conversationRef: scope.conversations[0]!.conversationRef,
              actorEntityRef: actor,
              occurredTime: {
                timeDomainRef: "time:real",
                extent: {
                  value: {
                    case: "instant",
                    value: sdk.timestampFromDate(
                      new Date(messages.materials[0]!.receivedAt),
                    ),
                  },
                },
              },
              material: {
                case: "inlineText",
                value: {
                  text: "Actual persisted QQ fixture message",
                  mediaType: "text/plain",
                },
              },
            }),
          },
        ];
        const sourceRunId = randomUUID();
        const registration = {
          subjectId,
          activityId: activity.activityId,
          nativeRunId: sourceRunId,
          nativeAgentId: "main",
          sessionKey: "fixture:world-contact",
          prompt: "Read the canonical world event and message",
          role: "main" as const,
          roleScope: {
            role: "subject.deliberation" as const,
            purpose: "subject_deliberation" as const,
            view: "subject" as const,
            contactNature: "subject_experience" as const,
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
          sourceRefs: [sourceRef, "message:" + messageRef],
          messageRefs: [messageRef],
          contacts: sourceContacts,
        };
        const saved = await c.run(() => stampBridge.registerInput(registration));
        const input = {
          version: 1 as const,
          subjectId,
          nousSessionId: session.sessionId,
          contactRequestId: randomUUID(),
          invocationId: "source:1",
          promptDigest: saved.promptDigest,
          native: {
            sessionKey: registration.sessionKey,
            sessionId: "fixture:world-session",
            runId: sourceRunId,
            agentId: "main",
            historyGeneration: "world:1",
          },
        };
        const first = await c.run(() => stampBridge.prepare(input));
        const worldInput = sdk.decodeObservationInput(first.contacts[0]!.observation);
        const messageInput = sdk.decodeObservationInput(first.contacts[1]!.observation);
        expect(worldInput.worldRealized).toEqual(
          sdk.decodeObservationInput(worldObservation).worldRealized,
        );
        expect(worldInput.observedStamp).toBeUndefined();
        expect(messageInput.observedStamp?.recordedAt).toEqual(messageInput.observedAt);
        expect(captures).toBe(1);
        const worldReceipt = await client.runtime.recordObservation(worldInput);
        const messageReceipt = await client.runtime.recordObservation(messageInput);
        await client.clocks.advanceClock({
          subjectId,
          operationId: randomUUID(),
          seconds: 60,
        });
        const replay = await c.run(() =>
          stampBridge.prepare({
            ...input,
            contactRequestId: randomUUID(),
            invocationId: "source:2",
          }),
        );
        expect(replay.contacts).toEqual(first.contacts);
        expect(captures).toBe(1);
        expect(
          await client.runtime.recordObservation(
            sdk.decodeObservationInput(replay.contacts[0]!.observation),
          ),
        ).toEqual(worldReceipt);
        expect(
          await client.runtime.recordObservation(
            sdk.decodeObservationInput(replay.contacts[1]!.observation),
          ),
        ).toEqual(messageReceipt);
        const occurrences = first.contacts.map((entry, index) => ({
          contactRef: entry.contactRef,
          receipt: sdk.encodeAcceptedObservation(
            index === 0 ? worldReceipt : messageReceipt,
          ),
        }));
        await c.run(() =>
          stampBridge.admitted({
            ...sdk.hostContactIdentitySchema.strip().parse(input),
            occurrences,
            projection: sdk.encodeProjection({
              projectionId: randomUUID(),
              consumerId: "consumer:clock-proof",
              subjectId,
              sessionId: session.sessionId,
              usage: sdk.withAcceptedContactRoots(
                sdk.decodeCognitionUsage(first.usage),
                subjectId,
                [worldReceipt, messageReceipt],
              ),
            }),
          }),
        );
        const toolInput = {
          ...sdk.hostContactIdentitySchema.strip().parse(input),
          stage: "pending" as const,
          observation: sdk.encodeObservationInput({
            subjectId,
            sessionId: session.sessionId,
            requestId: randomUUID(),
            sourceClass: "tool",
            observedAt: sdk.timestampFromDate(new Date()),
            material: {
              case: "inlineText",
              value: {
                text: "Actual local tool fixture output",
                mediaType: "text/plain",
              },
            },
            context: {
              tool_name: "fixture-local-read",
              tool_call_id: "actual-fixture-output",
            },
          }),
        };
        const firstFeedback = await c.run(() => stampBridge.feedback(toolInput));
        if (firstFeedback.stage !== "pending")
          throw new Error("Missing normalized actual feedback");
        const feedbackObservation = sdk.decodeObservationInput(
          firstFeedback.observation,
        );
        expect(feedbackObservation.observedAt).toEqual(
          feedbackObservation.observedStamp?.recordedAt,
        );
        expect(captures).toBe(2);
        const toolReceipt = await client.runtime.recordObservation(feedbackObservation);
        await client.clocks.advanceClock({
          subjectId,
          operationId: randomUUID(),
          seconds: 60,
        });
        const replayFeedback = await c.run(() => stampBridge.feedback(toolInput));
        if (replayFeedback.stage !== "pending")
          throw new Error("Missing replayed pending feedback");
        expect(replayFeedback).toEqual(firstFeedback);
        expect(captures).toBe(2);
        expect(
          await client.runtime.recordObservation(
            sdk.decodeObservationInput(replayFeedback.observation!),
          ),
        ).toEqual(toolReceipt);
        const actualRegistration = (await stampBridge.readRun(sourceRunId))!
          .registration;
        expect(
          hasAuthorizedNativeSources(
            { ...activity, scope: { ...scope, sourceRefs: [] } },
            actualRegistration,
          ),
        ).toBe(false);
        const wrong = {
          ...actualRegistration,
          contacts: actualRegistration.contacts.map((item) => ({ ...item })),
        };
        const body = sdk.decodeObservationInput(wrong.contacts[0]!.observation);
        body.worldRealized!.eventRevision = "999";
        wrong.contacts[0]!.observation = sdk.encodeObservationInput(body);
        expect(hasAuthorizedNativeSources(activity, wrong)).toBe(false);
        body.worldRealized!.eventRevision = String(event.eventRevision);
        body.sourceClass = "host_event";
        wrong.contacts[0]!.observation = sdk.encodeObservationInput(body);
        expect(hasAuthorizedNativeSources(activity, wrong)).toBe(false);
        body.sourceClass = "world_realized";
        body.worldRealized!.worldObserved!.at = sdk.timestampFromDate(
          new Date(Date.parse(worldAt) + 1),
        );
        wrong.contacts[0]!.observation = sdk.encodeObservationInput(body);
        expect(hasAuthorizedNativeSources(activity, wrong)).toBe(false);
      }
    } finally {
      await c.close();
    }
  }, 120000);
});
