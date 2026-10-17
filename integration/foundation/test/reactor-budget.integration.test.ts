// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Tests the application boundary with real fenced owners and the public SDK codec. */
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLifeService,
  createDeliberationService,
  createWorldLifeService,
  createAgencyService,
  createNarrativeService,
  createSubjectAttentionService,
  createSubjectReactorService,
} from "@heptalogos/subject";
import { createNativeCognitionBridge } from "../../../packages/application/product-host/src/native-cognition.js";
import { createSubjectRoles } from "../../../packages/application/product-host/src/subject-roles.js";
import {
  createSubjectDecisionHandler,
  decisionPhaseId,
} from "../../../packages/application/product-host/src/subject-decisions.js";
import {
  createSubjectReactor,
  type ReactorPreparedView,
} from "../../../packages/application/product-host/src/subject-reactor.js";
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
real("Bounded Reactor application under real PostgreSQL", () => {
  it("recovers an eighth-action read before admission without a ninth action or a new Reaction budget", async () => {
    const c = await composeProductPersistence(undefined, 1);
    try {
      const subjectId = randomUUID(),
        actor = "entity:subject:" + randomUUID();
      const messageId = randomUUID(),
        conversationRef = "conversation:heptalogos:" + randomUUID();
      const now = () => new Date().toISOString();
      const worldNow = async () => ({ timeDomainRef: "time:real", at: now() });
      const scope = {
        conversations: [{ conversationRef, operations: ["observe" as const] }],
        tools: [],
        sourceRefs: [],
        maxRunMs: 180000,
      };
      const life = createLifeService({
        persistence: c.persistence,
        now,
        worldNow,
        scopeAuthority: async () => scope,
      });
      let activity = await c.run(async () =>
        life.propose({
          operationId: randomUUID(),
          subjectId,
          purpose: "Bounded reading",
          mode: "work",
          window: { notBefore: null, notAfter: null },
          proposedBy: actor,
          sourceRefs: [],
          workContextId: randomUUID(),
          world: await worldNow(),
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
          reason: "Actual test activity",
        }),
      );
      const candidate = {
        subjectId,
        activityId: activity.activityId,
        candidateRef: "fixture:read",
        sourceOwner: "life" as const,
        sourceKey: "fixture",
        sourceRef: "fixture:read",
        sourceRevision: "1",
        kind: "explicit_subject_intent" as const,
        priorityClass: "direct" as const,
        availableAt: now(),
        related: true,
        metadata: { label: "Read the fixture material" },
      };
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
        candidates: async () => ({ candidates: [candidate], more: false }),
      });
      const foreground = createSubjectReactorService({
        persistence: c.persistence,
        now,
        life,
        policy: async () => ({
          maxInteractionSteps: 8,
          reactionDeadlineMs: 180000,
          workerConcurrency: 2,
        }),
        attention,
        assertActivityIn: async (tx, s, a) => {
          expect((await life.get(s, a, tx))?.state).toBe("active");
        },
      });
      const native = createNativeCognitionBridge({
        persistence: c.persistence,
        life,
        now,
        authorizeInput: async () => {},
        captureObservedStamp: async () =>
          sdk.decodeObservationInput(
            sdk.encodeObservationInput({
              observedStamp: {
                timeDomainRef: "time:real",
                at: sdk.timestampFromDate(new Date()),
                recordedAt: sdk.timestampFromDate(new Date()),
              },
            }),
          ).observedStamp!,
        assertForegroundIn: async (tx, reg) => {
          if (reg.foreground)
            await foreground.assertCurrentIn(
              tx,
              reg.subjectId,
              reg.activityId,
              reg.foreground,
            );
        },
        recordContact: async () => {},
        nous: async () => {
          throw Error("No remote model/Core in this owner proof");
        },
      });
      let providerCalls = 0,
        actualAdmittedContacts = 0;
      const roles = createSubjectRoles({
        life,
        native,
        bindings: async () => [
          {
            role: "subject.deliberation",
            nativeAgentRef: "main",
            enabled: true,
            outputContract: "structured_json",
            deadlineMs: 180000,
            inputTokens: 8192,
            outputTokens: 512,
            allowedTools: [],
            fallbackAgentRefs: [],
          },
        ],
        selectAgent: async () => "main",
        authorize: async () => {},
        dispatch: async (params) => {
          providerCalls++;
          const pending = (await native.readDispatch(
            subjectId,
            params.idempotencyKey,
          ))!;
          const identity = {
            version: 1 as const,
            subjectId,
            nousSessionId: randomUUID(),
            contactRequestId: randomUUID(),
            invocationId: "provider:" + providerCalls,
            promptDigest: pending.promptDigest,
            currentContextDigest: createHash("sha256")
              .update(params.extraSystemPrompt!)
              .digest("hex"),
            native: {
              runId: params.idempotencyKey,
              sessionKey: params.sessionKey,
              sessionId: randomUUID(),
              agentId: "main",
              historyGeneration: randomUUID(),
            },
          };
          const prepared = await native.prepare(identity);
          actualAdmittedContacts += prepared.contacts.length;
          const occurrences = prepared.contacts.map((value) => ({
            contactRef: value.contactRef,
            receipt: sdk.encodeAcceptedObservation({ occurrenceId: randomUUID() }),
          }));
          await native.admitted({
            ...sdk.hostContactIdentitySchema.strip().parse(identity),
            occurrences,
            projection: sdk.encodeProjection({
              projectionId: randomUUID(),
              consumerId: "consumer:budget-fixture",
              subjectId,
              sessionId: identity.nousSessionId,
              usage: sdk.withAcceptedContactRoots(
                sdk.decodeCognitionUsage(prepared.usage),
                subjectId,
                occurrences.map((value) =>
                  sdk.decodeAcceptedObservation(value.receipt),
                ),
              ),
            }),
          });
          return {
            status: "terminal" as const,
            result: {
              status: "ok",
              result: {
                payloads: [
                  {
                    text: JSON.stringify({
                      action: providerCalls === 8 ? "read" : "inspect",
                      target: "object:actual",
                      reason: "Fixture actual choice",
                    }),
                  },
                ],
              },
            },
          };
        },
      });
      const decisions = createDeliberationService({
        persistence: c.persistence,
        life,
        now,
        worldNow,
        validateSourceRun: async () => ({ sourceRefs: [], tools: [] }),
        assertSourceRunIn: async (tx, input) => {
          expect(
            (await native.readRun(input.sourceRunId, tx))?.consumerId,
          ).toBeTruthy();
        },
      });
      const worlds = createWorldLifeService({
        persistence: c.persistence,
        now,
        worldNow,
      });
      const agency = createAgencyService({
        persistence: c.persistence,
        now,
        authority: async () => {
          throw Error("No speech action in this proof");
        },
        checkSources: async () => {},
      });
      const narrative = createNarrativeService({
        persistence: c.persistence,
        life,
        decisions,
        worlds,
        agency,
        now,
        worldNow,
        review: async () => {
          throw Error("No renderer/review in this proof");
        },
      });
      const handler = createSubjectDecisionHandler({
        life,
        decisions,
        narrative,
        worlds,
        native,
        roles,
        now,
        startActivity: async () => {
          throw Error("No Activity creation");
        },
        deliveryFor: async () => undefined,
      });
      const contact = {
        contactRef: "message:" + messageId,
        observation: sdk.encodeObservationInput({
          subjectId,
          requestId: randomUUID(),
          sourceClass: "message",
          externalObjectRef: "object:heptalogos:message:" + messageId,
          conversationRef,
          material: {
            case: "inlineText",
            value: { text: "Actual viewed fixture material", mediaType: "text/plain" },
          },
        }),
      };
      let readDone = false,
        interruptOnce = true;
      const application = createSubjectReactor({
        foreground,
        attention,
        resolveActivity: async () => (await life.get(subjectId, activity.activityId))!,
        roles,
        decisions: handler,
        native,
        worldNow,
        readActivity: life.get,
        enabled: async () => true,
        now,
        prepare: async ({ reaction, lastAction }) => {
          if (lastAction?.action.action === "read" && interruptOnce) {
            interruptOnce = false;
            throw Error("Simulated process boundary after completed read");
          }
          const view: ReactorPreparedView = {
            frame: {
              subjectId,
              activityId: activity.activityId,
              reactionId: reaction.reactionId,
              focusRevision: reaction.focusRevision,
              frameRef: "situation:actual",
              world: await worldNow(),
              currentActivityRefs: [],
              objects: [
                {
                  handle: "object:actual",
                  owner: "life",
                  kind: "page",
                  sourceRef: "fixture:actual-read",
                  sourceRevision: "1",
                  label: "Fixture material",
                  state: readDone ? "viewed" : "available",
                  actions: ["inspect", "read"],
                },
              ],
              remainingSteps: Math.max(0, 8 - reaction.stepCount),
              deadlineAt: reaction.deadlineAt,
            },
            candidates: [candidate],
            contacts: readDone ? [contact] : [],
            sourceRefs: readDone ? ["message:" + messageId] : [],
            messageRefs: readDone ? [messageId] : [],
            usage: sdk.encodeCognitionUsage({
              purpose: "subject_deliberation",
              audience: { visibility: "group", conversationRef },
              sourceRead: { subjectId, sourceRefs: [] },
            }),
            context: {},
          };
          return view;
        },
        act: async ({ reaction, adopted }) => {
          if (adopted.decision.action === "read") {
            readDone = true;
            await foreground.bindRun({
              subjectId,
              activityId: activity.activityId,
              focus: reaction,
              runId: decisionPhaseId(reaction.reactionId, "deliberation:8"),
            });
          }
          return {
            state: "completed",
            resultRefs: [adopted.decisionRef],
            continuationRef: adopted.decisionRef,
          };
        },
        afterYield: async () => {},
        saveContinuation: async () => "activity:" + activity.activityId,
      });
      await expect(
        c.run(() => application.wake({ subjectId, naturalOpportunity: true })),
      ).rejects.toThrow("Simulated process boundary");
      const before = (await foreground.current(subjectId))!;
      expect(before.stepCount).toBe(8);
      expect(before.currentRunId).toBe(
        decisionPhaseId(before.reactionId, "deliberation:8"),
      );
      expect(providerCalls).toBe(8);
      expect(actualAdmittedContacts).toBe(0);
      const resumed = await c.run(() =>
        application.wake({ subjectId, naturalOpportunity: true }),
      );
      expect(resumed.status).toBe("yielded");
      expect(providerCalls).toBe(9);
      expect(actualAdmittedContacts).toBe(1);
      expect(await native.hasAcceptedSource(subjectId, contact.contactRef)).toBe(true);
      expect(await foreground.current(subjectId)).toBeUndefined();
      const retained = (await foreground.readReaction(subjectId, before.reactionId))!;
      expect(retained.stepCount).toBe(8);
      expect(
        (await foreground.lastAction(subjectId, before.reactionId))?.action.action,
      ).toBe("read");
      expect(
        await decisions.readOperation(
          subjectId,
          decisionPhaseId(
            decisionPhaseId(before.reactionId, "deliberation:8"),
            "adopt",
          ),
        ),
      ).toBeUndefined();
    } finally {
      await c.close();
    }
  }, 30000);
});
