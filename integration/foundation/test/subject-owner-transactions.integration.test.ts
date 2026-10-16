// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createIdentityService } from "@heptalogos/identity";
import { createMessagingService } from "@heptalogos/messaging";
import {
  createLifeService,
  createAgencyService,
  createWorldLifeService,
  createDeliberationService,
  createNarrativeService,
} from "@heptalogos/subject";
import { createEvidenceService } from "@heptalogos/evidence";
import { createConfigurationService } from "../../../packages/system/configuration/dist/index.js";
import {
  ProductManagement,
  productSettingsDefinition,
} from "../../../packages/system/management/dist/index.js";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import { hasAuthorizedNativeSources } from "../../../packages/application/product-host/dist/native-source-selection.js";
import {
  createSubjectDecisionHandler,
  decisionPhaseId,
} from "../../../packages/application/product-host/dist/subject-decisions.js";
import { createSubjectRoles } from "../../../packages/application/product-host/dist/subject-roles.js";
import { authorizeAdoptedTaskSources } from "../../../packages/application/product-host/dist/adopted-task-sources.js";
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
      let adoptedTaskDecisions: ReturnType<typeof createDeliberationService>;
      const native = createNativeCognitionBridge({
        authorizeAdoptedTaskSources: (registration, parent, tx) =>
          authorizeAdoptedTaskSources(
            { decisions: adoptedTaskDecisions, life, worlds },
            registration,
            parent,
            tx,
          ),
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
      // The real RoleInvoker must pass the decoded protobuf into the existing
      // Native owner; a wire worldTime string used to fail before any provider.
      const eventId = randomUUID(),
        roleRequestId = randomUUID();
      const interval = {
        timeDomainRef: domain,
        start: new Date(Date.parse(worldNow) - 60000).toISOString(),
        end: worldNow,
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
              title: "Previously perceived scene",
              content: "Canonical source for a bounded task",
              actorRefs: [actor],
              placeRef: "room",
              scheduleId: null,
              parentEventId: null,
              causalEventRefs: [],
              overlap: "concurrent",
              source: {
                kind: "rule",
                producerRef: "fixture:task-world",
                sourceRefs: [],
              },
              perceptions: [
                {
                  actorRef: actor,
                  kind: "seen",
                  at: { timeDomainRef: domain, at: worldNow },
                  content: "A task-relevant world event",
                },
              ],
            },
          ],
        }),
      );
      const worldEvent = (await worlds.pendingContacts(subjectId, worldId))[0]!;
      const eventRef = worldEvent.sourceRef;
      const worldContact = {
        contactRef: eventRef,
        observation: sdk.encodeObservationInput({
          subjectId,
          requestId: randomUUID(),
          sourceClass: "world_realized",
          externalObjectRef: "object:heptalogos:" + eventRef,
          actorEntityRef: actor,
          observedAt: sdk.timestampFromDate(new Date()),
          occurredTime: {
            timeDomainRef: domain,
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
            eventRevision: String(worldEvent.eventRevision),
            producerRef: worldEvent.source.producerRef,
            generationMethod: worldEvent.source.kind,
            realizedAt: sdk.timestampFromDate(new Date(worldEvent.recordedAt)),
            worldObserved: {
              timeDomainRef: domain,
              at: sdk.timestampFromDate(new Date(worldNow)),
              recordedAt: sdk.timestampFromDate(new Date()),
            },
            sharedOriginRefs: [worldEvent.source.producerRef],
          },
          material: {
            case: "inlineText",
            value: {
              text: worldEvent.perceptions[0]!.content,
              mediaType: "text/plain",
            },
          },
        }),
      };
      await c.run(() =>
        worlds.selectContact({ subjectId, worldId, eventId, runId: roleRequestId }),
      );
      const outputs = new Map<string, string>();
      const dispatchedRoles: string[] = [];
      let flowNarrative: ReturnType<typeof createNarrativeService> | undefined;
      let flowReference: string | undefined;
      const roles = createSubjectRoles({
        life,
        native,
        bindings: async () => [
          {
            role: "subject.deliberation",
            nativeAgentRef: "main",
            enabled: true,
            outputContract: "structured_json",
            deadlineMs: 60000,
            inputTokens: 4096,
            outputTokens: 512,
            allowedTools: [],
            fallbackAgentRefs: [],
          },
          ...(["subject.execution", "subject.render", "narrative.review"] as const).map(
            (role) => ({
              role,
              nativeAgentRef: "main",
              enabled: true,
              outputContract:
                role === "narrative.review"
                  ? ("structured_json" as const)
                  : ("natural_text" as const),
              deadlineMs: 60000,
              inputTokens: 8192,
              outputTokens: 1024,
              allowedTools: [],
              fallbackAgentRefs: [],
            }),
          ),
        ],
        selectAgent: async () => "main",
        authorize: async () => authorityReads(),
        dispatch: async (params) => {
          const pending = (await native.readDispatch(
            subjectId,
            params.idempotencyKey,
          ))!;
          const input = {
            version: 1 as const,
            subjectId,
            nousSessionId: randomUUID(),
            contactRequestId: randomUUID(),
            invocationId: "actual-role-fixture",
            promptDigest: pending.promptDigest,
            currentContextDigest:
              params.extraSystemPrompt === undefined
                ? undefined
                : createHash("sha256").update(params.extraSystemPrompt).digest("hex"),
            native: {
              sessionKey: params.sessionKey,
              sessionId: randomUUID(),
              runId: params.idempotencyKey,
              agentId: "main",
              historyGeneration: randomUUID(),
            },
          };
          if (params.idempotencyKey === roleRequestId) {
            expect(params.message).not.toContain("CURRENT_EPHEMERAL_WORLD_FIXTURE");
            expect(params.extraSystemPrompt).toContain(
              "CURRENT_EPHEMERAL_WORLD_FIXTURE",
            );
          }
          const actualRole = (await native.readInputState(
            subjectId,
            params.idempotencyKey,
          ))!.registration.roleScope.role;
          dispatchedRoles.push(actualRole);
          await expect(
            native.prepare({ ...input, currentContextDigest: "0".repeat(64) }),
          ).rejects.toMatchObject({
            problem: { problemCode: "gateway.native_context_changed" },
          });
          const prepared = await native.prepare(input);
          const occurrences = prepared.contacts.map((entry) => ({
            contactRef: entry.contactRef,
            receipt: sdk.encodeAcceptedObservation({ occurrenceId: randomUUID() }),
          }));
          await native.admitted({
            ...sdk.hostContactIdentitySchema.strip().parse(input),
            occurrences,
            projection: sdk.encodeProjection({
              projectionId: randomUUID(),
              consumerId: "consumer:world-role-fixture",
              subjectId,
              sessionId: input.nousSessionId,
              epistemicView: { complete: true },
              usage: sdk.withAcceptedContactRoots(
                sdk.decodeCognitionUsage(prepared.usage),
                subjectId,
                occurrences.map((item) => sdk.decodeAcceptedObservation(item.receipt)),
              ),
            }),
          });
          const text =
            outputs.get(params.idempotencyKey) ??
            JSON.stringify({
              action: "inspect",
              reason: "Actual registered RoleInvoker fixture",
            });
          if (actualRole === "subject.execution") {
            expect(params.waitForFinal).toBe(false);
            await native.feedback({
              ...sdk.hostContactIdentitySchema.strip().parse(input),
              stage: "pending",
              observation: sdk.encodeObservationInput({
                subjectId,
                sessionId: input.nousSessionId,
                requestId: randomUUID(),
                sourceClass: "generated",
                material: {
                  case: "inlineText",
                  value: {
                    text: "Preserved professional result",
                    mediaType: "text/plain",
                  },
                },
              }),
            });
            await native.runTerminal({
              ...sdk.hostContactIdentitySchema.strip().parse(input),
              outcome: "completed",
              endedAt: now(),
            });
            return { status: "accepted", result: { runId: params.idempotencyKey } };
          }
          if (actualRole === "subject.render" && flowNarrative) {
            flowReference = (
              await flowNarrative.adoptDelivery({
                channel: "heptalogos-qq",
                accountId: "100",
                to: "group:200",
                nativeIntentId: randomUUID(),
                runId: params.idempotencyKey,
                preparedBatch: {
                  schemaVersion: 1,
                  runId: params.idempotencyKey,
                  entries: [{ sourceIndex: 0, status: "accepted", payload: { text } }],
                },
              })
            ).reference;
          }
          return {
            status: "terminal",
            result: { status: "ok", result: { payloads: [{ text }] } },
          };
        },
      });
      const invoked = await c.run(() =>
        roles.invoke({
          requestId: roleRequestId,
          subjectId,
          activityId: activity.activityId,
          role: "subject.deliberation",
          context: {
            worldSource: eventRef,
            currentSituation: "CURRENT_EPHEMERAL_WORLD_FIXTURE",
          },
          contacts: [worldContact],
          sourceRefs: [eventRef],
          usage: sdk.encodeCognitionUsage({
            purpose: "subject_deliberation",
            audience: {
              visibility: "group",
              conversationRef: scope.conversations[0]!.conversationRef,
            },
            worldId,
            worldTime: {
              timeDomainRef: domain,
              at: sdk.timestampFromDate(new Date(worldNow)),
              recordedAt: sdk.timestampFromDate(new Date()),
            },
            sourceRead: { subjectId, sourceRefs: [] },
          }),
        }),
      );
      expect(invoked.admitted).toBe(true);
      const actualContext = await native.readAppliedContext(roleRequestId);
      expect(actualContext.occurrences).toHaveLength(1);
      expect(
        sdk.decodeCognitionUsage(actualContext.usage).worldTime?.timeDomainRef,
      ).toBe(domain);
      await c.run(() =>
        worlds.acknowledgeContact({
          subjectId,
          worldId,
          eventId,
          runId: roleRequestId,
          contactRef: actualContext.occurrences[0]!.contactRef,
        }),
      );
      expect(await worlds.releasedEventIds(subjectId, worldId, [eventId])).toEqual([
        eventId,
      ]);
      // The source parent did not contain this old event; only an exact actual
      // adopted task plus the canonical released world owner may add it.
      adoptedTaskDecisions = createDeliberationService({
        persistence: c.persistence,
        life,
        now,
        worldNow: life.worldNow,
        validateSourceRun: async (input) => {
          const actualRun = (await native.readRun(input.sourceRunId))!;
          expect(actualRun.consumerId).toBeTruthy();
          return {
            sourceRefs: [...new Set([eventRef, ...actualRun.registration.sourceRefs])],
            tools: [],
          };
        },
        assertSourceRunIn: async (tx, input) => {
          expect(
            (await native.readRun(input.sourceRunId, tx))?.consumerId,
          ).toBeTruthy();
        },
      });
      const beforeDecision = (await life.get(subjectId, activity.activityId))!;
      const selectedTask = await c.run(() =>
        adoptedTaskDecisions.adopt({
          operationId: randomUUID(),
          subjectId,
          activityId: activity.activityId,
          sourceRunId: runId,
          expectedActivityRevision: beforeDecision.revision,
          decision: {
            action: "search",
            reason: "Use an actually released old scene",
            delegation: {
              goal: "Inspect this scene",
              sourceRefs: [eventRef],
              tools: [],
            },
          },
        }),
      );
      const taskRegistration = {
        subjectId,
        activityId: activity.activityId,
        parentRunId: runId,
        adoptedDecisionRef: selectedTask.decisionRef,
        sessionKey: "fixture:adopted-task",
        nativeAgentId: "main",
        nativeRunId: randomUUID(),
        prompt: "Inspect the adopted old scene",
        role: "main" as const,
        roleScope: {
          role: "subject.execution" as const,
          purpose: "professional_execution" as const,
          view: "worker" as const,
          contactNature: "execution_only" as const,
        },
        tokenBudget: { inputTokens: 4096, outputTokens: 512 },
        allowedToolNames: [],
        actorEntityRef: actor,
        workContextId: activity.workContextId!,
        usage: sdk.decodeCognitionUsage({
          purpose: "professional_execution",
          audience: {
            visibility: "group",
            conversationRef: scope.conversations[0]!.conversationRef,
          },
          sourceRead: { subjectId, sourceRefs: [] },
        }),
        sourceRefs: [eventRef],
        messageRefs: [],
        contacts: [],
      };
      expect((await native.readRun(runId))!.registration.sourceRefs).not.toContain(
        eventRef,
      );
      await c.run(() => native.registerInput(taskRegistration));
      await expect(
        c.run(() =>
          native.registerInput({
            ...taskRegistration,
            nativeRunId: randomUUID(),
            sessionKey: "fixture:no-decision",
            adoptedDecisionRef: undefined,
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_parent_sources_denied" },
      });
      await expect(
        c.run(() =>
          native.registerInput({
            ...taskRegistration,
            nativeRunId: randomUUID(),
            sessionKey: "fixture:wrong-parent",
            parentRunId: roleRequestId,
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "gateway.native_adopted_task_denied" },
      });
      // Cross the complete role-result/explicit-view/fresh-choice/narrative chain using
      // actual owners and public SDK admission. Only the model transport is a local fixture.
      const executionId = randomUUID();
      const executionInput = {
        requestId: executionId,
        subjectId,
        activityId: activity.activityId,
        parentRunId: runId,
        adoptedDecisionRef: selectedTask.decisionRef,
        role: "subject.execution" as const,
        taskTools: [],
        context: { task: "Inspect this scene" },
        contacts: [],
        sourceRefs: [eventRef],
        usage: sdk.encodeCognitionUsage(taskRegistration.usage),
      };
      const beforeFlow = dispatchedRoles.length;
      const task = await c.run(() => roles.startExecution(executionInput));
      expect(task.status).toBe("pending");
      expect(await c.run(() => roles.startExecution(executionInput))).toEqual(task);
      expect(dispatchedRoles.length).toBe(beforeFlow + 1);
      const ready = (await native.readyResults({ subjectId, limit: 128 })).runs;
      expect(ready.some((r) => r.runId === executionId)).toBe(true);
      const results = await native.readRoleResults(subjectId, executionId);
      expect(
        results.results.some(
          (r) => sdk.decodeObservationInput(r.observation).sourceClass === "generated",
        ),
      ).toBe(true);
      const releaseId = randomUUID();
      const release = await c.run(() =>
        native.releaseResult({
          version: 1,
          requestId: releaseId,
          subjectId,
          parentRunId: runId,
          childRunId: executionId,
          resultIds: results.results
            .filter(
              (r) =>
                sdk.decodeObservationInput(r.observation).sourceClass === "generated",
            )
            .map((r) => r.resultId),
        }),
      );
      expect(
        (await native.readyResults({ subjectId, limit: 128 })).runs.some(
          (r) => r.runId === executionId,
        ),
      ).toBe(true);
      expect(
        await native.hasAcceptedSource(subjectId, release.contacts[0]!.contactRef),
      ).toBe(false);
      const freshId = randomUUID();
      outputs.set(
        freshId,
        JSON.stringify({
          action: "communicate",
          reason: "Report an actually viewed result",
          expressionIntent: {
            intent: "Report that the result was viewed",
            stance: "Plain",
            qualifications: [],
            deception: "none",
            eventRefs: [],
            cognitionRefs: [],
            priorClaimRefs: [],
          },
        }),
      );
      const freshInput = {
        requestId: freshId,
        subjectId,
        activityId: activity.activityId,
        role: "subject.deliberation" as const,
        context: { actualResultRelease: releaseId },
        contacts: release.contacts,
        sourceRefs: release.contacts.map((value) => value.contactRef),
        usage: (await native.readAppliedContext(runId)).usage,
      };
      const fresh = await c.run(() => roles.invoke(freshInput));
      expect(await c.run(() => roles.invoke(freshInput))).toEqual(fresh);
      expect(
        await native.hasAcceptedSource(subjectId, release.contacts[0]!.contactRef),
      ).toBe(true);
      expect(
        (await native.readyResults({ subjectId, limit: 128 })).runs.some(
          (r) => r.runId === executionId,
        ),
      ).toBe(false);
      const flowAgency = createAgencyService({
        persistence: c.persistence,
        now,
        checkSources: async () => {},
        authority: async (id, _recipient, tx) => {
          await authorityReads(tx);
          const currentRun = (await native.readRun(id, tx))!;
          return {
            activity: (await life.get(subjectId, activity.activityId, tx))!,
            role: currentRun.registration.roleScope.role,
            actorEntityRef: actor,
            conversationRef: scope.conversations[0]!.conversationRef,
            sourceRefs: currentRun.registration.sourceRefs,
            authorizedDerivedSourceRefs: currentRun.registration.sourceRefs.filter(
              (ref) => ref.startsWith("role-result-release:"),
            ),
            messageSources: [],
          };
        },
      });
      let reviewCount = 0;
      flowNarrative = createNarrativeService({
        persistence: c.persistence,
        life,
        decisions: adoptedTaskDecisions,
        worlds,
        agency: flowAgency,
        now,
        worldNow: life.worldNow,
        review: async (brief, prepared) => {
          reviewCount++;
          const reviewId = decisionPhaseId(prepared.runId, "review");
          outputs.set(
            reviewId,
            JSON.stringify({
              claims: [
                {
                  sourceIndex: 0,
                  start: 0,
                  end: 6,
                  quote: "结果已经查阅",
                  content: "The result was viewed",
                  entityRefs: [actor],
                  kind: "external_result",
                  stance: "asserted",
                  polarity: "affirm",
                  about: null,
                  basis: "report",
                  sourceRefs: brief.sourceRefs,
                  eventRefs: [],
                  cognitionRefs: [],
                  priorClaimRefs: [],
                },
              ],
              conflicts: [],
              commitments: [],
              worldPatch: null,
            }),
          );
          const review = await roles.invoke({
            requestId: reviewId,
            subjectId,
            activityId: activity.activityId,
            parentRunId: prepared.runId,
            role: "narrative.review",
            context: { brief, prepared },
            contacts: [],
            sourceRefs: brief.sourceRefs,
            usage: (await native.readAppliedContext(prepared.runId)).usage,
          });
          return { reviewerRunId: review.runId, review: JSON.parse(review.text) };
        },
      });
      const handler = createSubjectDecisionHandler({
        life,
        decisions: adoptedTaskDecisions,
        narrative: flowNarrative,
        worlds,
        native,
        roles,
        now,
        startActivity: async () => {
          throw Error("No new Activity in role chain");
        },
        deliveryFor: async () => ({
          conversationRef: scope.conversations[0]!.conversationRef,
          channel: "heptalogos-qq",
          accountId: "100",
          to: "group:200",
        }),
      });
      const freshChoice = await c.run(() =>
        handler.adopt({
          subjectId,
          activityId: activity.activityId,
          requestId: freshId,
          run: fresh,
        }),
      );
      outputs.set(decisionPhaseId(freshId, "render"), "结果已经查阅");
      const expression = await c.run(() =>
        handler.express({
          subjectId,
          activityId: activity.activityId,
          adopted: freshChoice,
          run: fresh,
        }),
      );
      expect(expression.expression.state).toBe("rendered");
      expect(reviewCount).toBe(1);
      expect(dispatchedRoles.slice(beforeFlow)).toEqual([
        "subject.execution",
        "subject.deliberation",
        "subject.render",
        "narrative.review",
      ]);
      expect(flowReference).toBeTruthy();
      const flowPart = {
        reference: flowReference!,
        channel: "heptalogos-qq",
        accountId: "100",
        to: "group:200",
        deliveryQueueId: "native:one-custody",
        payload: { sourceIndex: 0, kind: "text" as const, text: "结果已经查阅" },
      };
      const attempt = await c.run(() => flowAgency.beginDelivery(flowPart));
      if (attempt.action !== "send")
        throw Error("Expected the unique first send point");
      await c.run(() =>
        flowAgency.recordDelivery({
          reference: flowReference!,
          sourceIndex: 0,
          partIndex: 0,
          attemptId: attempt.attemptId,
          outcome: {
            state: "accepted",
            platformMessageId: "fixture:role-flow",
            acceptedAt: now(),
          },
        }),
      );
      expect(
        (await flowNarrative.explainStatement(subjectId, "fixture:role-flow")).claims[0]
          ?.status,
      ).toBe("expressed");
      expect((await c.run(() => flowAgency.beginDelivery(flowPart))).action).toBe(
        "return",
      );
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
        await c.run(async () =>
          worlds.realize({
            operationId: randomUUID(),
            subjectId,
            worldId,
            expectedRevision: (await worlds.read(subjectId, worldId))!.revision,
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
