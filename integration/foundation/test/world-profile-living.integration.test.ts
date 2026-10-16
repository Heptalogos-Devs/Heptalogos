// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { createNativeCognitionBridge } from "../../../packages/application/product-host/dist/native-cognition.js";
import {
  hasCanonicalProfileSources,
  readInitialSettingSource,
} from "../../../packages/application/product-host/dist/native-profile-source.js";
import { randomUUID } from "node:crypto";
import { createIdentityService } from "@heptalogos/identity";
import {
  createLifeService,
  createWorldLifeService,
  createWorldProfileService,
  DEFAULT_WORLD_ENERGY,
  worldOccurrenceId,
  subjectProblem,
  type WorldProfile,
} from "@heptalogos/subject";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
} from "../support/canonical-postgres.js";
import { composeProductPersistence } from "../support/product-persistence.js";
const sdkMetaUrl = new URL(
  "../../../packages/application/product-host/node_modules/@nous-wave/client/package.json",
  import.meta.url,
);
const sdkMeta = JSON.parse(await readFile(sdkMetaUrl, "utf8"));
const sdk = await import(
  new URL(sdkMeta.exports["./host-bridge"].import, sdkMetaUrl).href
);
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("WorldProfile and realized interval energy under real PostgreSQL", () => {
  it("adopts an independent entry, integrates one primary plus maximum subsidiary burden, and keeps device CAS independent", async () => {
    const current = await composeProductPersistence(),
      subjectId = randomUUID(),
      worldId = randomUUID();
    let worldAt = "2026-10-19T00:00:00.000Z";
    const worldNow = async () => ({ timeDomainRef: "school", at: worldAt });
    const worlds = createWorldLifeService({
      persistence: current.persistence,
      now: () => new Date().toISOString(),
      worldNow,
    });
    const identity = createIdentityService({ persistence: current.persistence });
    const profiles = createWorldProfileService({
      persistence: current.persistence,
      worlds,
      now: () => new Date().toISOString(),
      worldNow,
      resolveActor: async (input) =>
        input.actorKey === "self"
          ? (await identity.ensureSubjectEntity({ subjectId: input.subjectId }))
              .entityRef
          : (
              await identity.resolveWorldActor({
                worldId: input.worldId,
                actorKey: input.actorKey,
              })
            ).entityRef,
    });
    const profile: WorldProfile = {
      name: "Explicit student entry",
      timeDomainRef: "school",
      timezone: "Asia/Shanghai",
      offlinePolicy: "simulate_elapsed",
      clock: { onlineRate: 1, offlineRate: 1 },
      entry: {
        role: "Student",
        description: "Entered this school now; no earlier biography supplied",
        placeRef: "class",
        at: worldAt,
      },
      places: [
        { placeRef: "class", name: "Classroom", description: "A classroom" },
        { placeRef: "home", name: "Home", description: "A home" },
      ],
      actors: [],
      rules: "Compatible daily school life",
      creationScope: "Virtual events only",
      informationSourceRefs: [],
      routineRules: [],
      calendarExceptions: [],
      energy: DEFAULT_WORLD_ENERGY,
      planning: { horizonHours: 24, detailHours: 2 },
      travelEdges: [{ from: "class", to: "home", durationMinutes: 15 }],
      publicCalendar: "none",
    };
    try {
      const request = {
        operationId: randomUUID(),
        subjectId,
        worldId,
        expectedRevision: 0,
        profile,
      };
      const adopted = await current.run(() => profiles.adopt(request));
      expect(adopted.entrySourceRef).toBe(`world-profile:${worldId}:1`);
      expect(
        await worlds.resolveSourceRefs({
          subjectId,
          sourceRefs: [adopted.entrySourceRef, `world-profile:${worldId}:2`],
        }),
      ).toEqual([adopted.entrySourceRef]);
      expect(
        await worlds.resolveSourceRefs({
          subjectId: randomUUID(),
          sourceRefs: [adopted.entrySourceRef],
        }),
      ).toEqual([]);

      expect(await current.run(() => profiles.adopt(request))).toEqual(adopted);
      expect((await worlds.readLivingState({ subjectId, worldId }))?.energy).toBe(80);
      const actor = adopted.subjectActorRef;
      const settingScope = {
        conversations: [],
        tools: [],
        sourceRefs: [`world:${worldId}`],
        maxRunMs: 60000,
      };
      const settingsLife = createLifeService({
        persistence: current.persistence,
        now: () => new Date().toISOString(),
        worldNow,
        scopeAuthority: async () => settingScope,
      });
      let entryActivity = await current.run(async () =>
        settingsLife.propose({
          operationId: randomUUID(),
          subjectId,
          purpose: "Read the adopted entry declaration",
          mode: "work",
          window: { notBefore: null, notAfter: null },
          proposedBy: actor,
          sourceRefs: settingScope.sourceRefs,
          workContextId: randomUUID(),
          world: await worldNow(),
          nextOpportunity: null,
          interruptOn: [],
        }),
      );
      entryActivity = await current.run(() =>
        settingsLife.adopt({
          subjectId,
          activityId: entryActivity.activityId,
          expectedRevision: entryActivity.revision,
          adoptedBy: actor,
          scope: settingScope,
        }),
      );
      entryActivity = await current.run(() =>
        settingsLife.transition({
          subjectId,
          activityId: entryActivity.activityId,
          expectedRevision: entryActivity.revision,
          action: "start",
          reason: "Actual initial-setting contact proof",
        }),
      );
      const native = createNativeCognitionBridge({
        persistence: current.persistence,
        life: settingsLife,
        now: () => new Date().toISOString(),
        captureObservedStamp: async () =>
          sdk.decodeObservationInput(
            sdk.encodeObservationInput({
              observedStamp: {
                timeDomainRef: "school",
                at: sdk.timestampFromDate(new Date(worldAt)),
                recordedAt: sdk.timestampFromDate(new Date()),
              },
            }),
          ).observedStamp!,
        authorizeInput: async (reg, _activity, tx) => {
          if (!(await hasCanonicalProfileSources(reg, profiles, tx)))
            throw subjectProblem(
              "native.noncanonical_initial_setting",
              "Initial setting is not canonical",
              "Read the adopted profile owner material",
              "conflict",
            );
        },
        recordContact: async () => {
          throw Error("Initial settings are not QQ message contacts");
        },
        nous: async () => {
          throw Error(
            "Owner admission fixture must not call a model or remote cognition service",
          );
        },
      });
      const runId = randomUUID();
      const setting = await readInitialSettingSource(
        { profiles, hasAcceptedSource: native.hasAcceptedSource },
        { subjectId, sourceRef: adopted.entrySourceRef, nativeRunId: runId },
      );
      expect(setting.contacts).toHaveLength(1);
      expect(await native.hasAcceptedSource(subjectId, adopted.entrySourceRef)).toBe(
        false,
      );
      const input = {
        subjectId,
        activityId: entryActivity.activityId,
        sessionKey: "native:initial-setting:" + runId,
        nativeAgentId: "main",
        nativeRunId: runId,
        prompt: "Read this original adopted setting, not a prior lived event",
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
        workContextId: entryActivity.workContextId!,
        usage: sdk.decodeCognitionUsage({
          purpose: "subject_deliberation",
          intent: entryActivity.purpose,
          audience: { visibility: "internal" },
          worldId,
          sourceRead: { subjectId, sourceRefs: [] },
        }),
        sourceRefs: [`world:${worldId}`, adopted.entrySourceRef],
        messageRefs: [],
        contacts: setting.contacts,
      };
      const wrong = sdk.decodeObservationInput(setting.contacts[0]!.observation);
      wrong.material.value.text = JSON.stringify({
        ...JSON.parse(wrong.material.value.text),
        entry: { ...profile.entry, description: "Invented prior career" },
      });
      await expect(
        current.run(() =>
          native.registerInput({
            ...input,
            nativeRunId: randomUUID(),
            sessionKey: "native:forged-initial:" + randomUUID(),
            contacts: [
              {
                contactRef: adopted.entrySourceRef,
                observation: sdk.encodeObservationInput(wrong),
              },
            ],
          }),
        ),
      ).rejects.toMatchObject({
        problem: { problemCode: "native.noncanonical_initial_setting" },
      });
      const registered = await current.run(() => native.registerInput(input));
      const contactRequest = {
        version: 1 as const,
        subjectId,
        nousSessionId: randomUUID(),
        contactRequestId: randomUUID(),
        invocationId: "initial:1",
        promptDigest: registered.promptDigest,
        native: {
          sessionKey: registered.sessionKey,
          sessionId: randomUUID(),
          runId,
          agentId: "main",
          historyGeneration: randomUUID(),
        },
      };
      const prepared = await current.run(() => native.prepare(contactRequest));
      const firstSetting = sdk.decodeObservationInput(
        prepared.contacts[0]!.observation,
      );
      expect(firstSetting.sourceClass).toBe("initial_setting");
      expect(firstSetting.worldRealized).toBeUndefined();
      expect(firstSetting.occurredTime).toBeUndefined();
      expect(firstSetting.observedStamp.timeDomainRef).toBe("school");
      expect(await native.hasAcceptedSource(subjectId, adopted.entrySourceRef)).toBe(
        false,
      );
      const occurrences = prepared.contacts.map((value) => ({
        contactRef: value.contactRef,
        receipt: sdk.encodeAcceptedObservation({ occurrenceId: randomUUID() }),
      }));
      await current.run(() =>
        native.admitted({
          ...sdk.hostContactIdentitySchema.strip().parse(contactRequest),
          occurrences,
          projection: sdk.encodeProjection({
            projectionId: randomUUID(),
            consumerId: "consumer:initial-setting-owner-fixture",
            subjectId,
            sessionId: contactRequest.nousSessionId,
            usage: sdk.withAcceptedContactRoots(
              sdk.decodeCognitionUsage(prepared.usage),
              subjectId,
              occurrences.map((value) => sdk.decodeAcceptedObservation(value.receipt)),
            ),
          }),
        }),
      );
      expect(await native.hasAcceptedSource(subjectId, adopted.entrySourceRef)).toBe(
        true,
      );
      const knownSetting = await readInitialSettingSource(
        { profiles, hasAcceptedSource: native.hasAcceptedSource },
        { subjectId, sourceRef: adopted.entrySourceRef, nativeRunId: randomUUID() },
      );
      expect(knownSetting.contacts).toEqual([]);
      expect(knownSetting.context.retrievalOnly).toBe(true);
      expect((await worlds.prepareAdvance(subjectId, worldId)).recentEvents).toEqual(
        [],
      );

      worldAt = "2026-10-19T01:00:00.000Z";
      const range = {
        timeDomainRef: "school",
        start: "2026-10-19T00:00:00.000Z",
        end: worldAt,
      };
      const study = {
        eventId: randomUUID(),
        interval: range,
        title: "Study",
        content: "Worked through the lesson",
        actorRefs: [actor],
        placeRef: "class",
        scheduleId: null,
        parentEventId: null,
        causalEventRefs: [],
        overlap: "concurrent" as const,
        source: { kind: "rule" as const, producerRef: "adopted:study", sourceRefs: [] },
        perceptions: [],
        energy: {
          kind: "study" as const,
          participation: "primary" as const,
          delta: 0,
          reason: "",
        },
      };
      const operation = {
        operationId: randomUUID(),
        subjectId,
        worldId,
        expectedRevision: 1,
        interval: range,
        events: [study],
        coverage: "complete" as const,
      };
      await current.run(() => worlds.realize(operation));
      expect((await worlds.readLivingState({ subjectId, worldId }))?.energy).toBe(72);
      await current.run(() => worlds.realize(operation));
      expect((await worlds.readLivingState({ subjectId, worldId }))?.energy).toBe(72);
      const subsidiary = {
        ...study,
        eventId: randomUUID(),
        parentEventId: study.eventId,
        interval: { ...range, start: "2026-10-19T00:30:00.000Z" },
        energy: {
          kind: "social" as const,
          participation: "subsidiary" as const,
          delta: -1,
          reason: "An adopted emotionally demanding interruption",
        },
      };
      await current.run(() =>
        worlds.realize({
          ...operation,
          operationId: randomUUID(),
          expectedRevision: 2,
          events: [subsidiary],
        }),
      );
      expect((await worlds.readLivingState({ subjectId, worldId }))?.energy).toBe(70.5);
      const secondSubsidiary = {
        ...subsidiary,
        eventId: randomUUID(),
        energy: { ...subsidiary.energy, delta: 0, reason: "" },
      };
      await current.run(() =>
        worlds.realize({
          ...operation,
          operationId: randomUUID(),
          expectedRevision: 3,
          events: [secondSubsidiary],
        }),
      );
      expect((await worlds.readLivingState({ subjectId, worldId }))?.energy).toBe(70.5);
      const deviceRequest = {
        operationId: randomUUID(),
        subjectId,
        worldId,
        expectedRevision: 1,
        view: { kind: "notifications" as const },
      };
      expect(await current.run(() => worlds.adoptDeviceView(deviceRequest))).toEqual({
        revision: 2,
        view: { kind: "notifications" },
      });
      expect(await current.run(() => worlds.adoptDeviceView(deviceRequest))).toEqual({
        revision: 2,
        view: { kind: "notifications" },
      });
      const before = await worlds.readLivingState({ subjectId, worldId });
      await worlds.readCalendar({
        subjectId,
        worldId,
        interval: { ...range, end: "2026-10-20T00:00:00.000Z" },
        view: "planned",
        perspective: "subject",
        displayTimezone: "Asia/Shanghai",
        limit: 10,
      });
      expect(await worlds.readLivingState({ subjectId, worldId })).toEqual(before);
      await expect(
        current.run(() =>
          worlds.realize({
            ...operation,
            operationId: randomUUID(),
            expectedRevision: 4,
            events: [{ ...study, eventId: randomUUID() }],
          }),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "world.living_conflict" } });
      expect(await worlds.readLivingState({ subjectId, worldId })).toEqual(before);
      expect((await worlds.read(subjectId, worldId))?.revision).toBe(4);
      const state = (await worlds.read(subjectId, worldId))!;
      const classRule = {
        ruleId: randomUUID(),
        revision: 1,
        title: "Current class",
        content: "Current class continues",
        subjectPerception: "I attended this portion of class",
        startsAtLocal: "2026-10-19T09:00:00",
        timezone: "Asia/Shanghai",
        rrule: null,
        rdates: [],
        exdates: [],
        validThrough: null,
        effectiveFrom: null,
        effectiveUntil: null,
        startShiftSeconds: 0,
        disambiguation: "compatible" as const,
        durationMinutes: 60,
        actorRefs: [actor],
        placeRef: "class",
        activityId: null,
        kind: "study" as const,
        visibility: "subject" as const,
        adjustable: false,
        mode: "fixed" as const,
      };
      await current.run(() =>
        worlds.configure({
          operationId: randomUUID(),
          expectedRevision: 4,
          definition: {
            ...state.definition,
            revision: state.definition.revision + 1,
            routineRules: [classRule],
          },
          schedule: [],
        }),
      );
      worldAt = "2026-10-19T01:10:00.000Z";
      await current.run(() =>
        worlds.advanceRules(subjectId, worldId, {
          timeDomainRef: "school",
          start: "2026-10-19T01:00:00.000Z",
          end: worldAt,
        }),
      );
      expect(
        (await worlds.readLivingState({ subjectId, worldId }))?.energy,
      ).toBeCloseTo(70.5 - 8 / 6);
      const moveRequest = {
        operationId: randomUUID(),
        subjectId,
        worldId,
        sourceReactionRef: "reaction:actual",
        action: { kind: "move" as const, placeRef: "home" },
      };
      const move = await current.run(() => worlds.adoptAction(moveRequest));
      expect(move.status).toBe("pending");
      expect(
        (await worlds.readLivingState({ subjectId, worldId }))?.currentPlaceRef,
      ).toBe("class");
      worldAt = "2026-10-19T01:15:00.000Z";
      const partial = await current.run(() =>
        worlds.completeActions({ subjectId, worldId }),
      );
      expect(partial[0]?.status).toBe("pending");
      expect(partial[0]?.eventRefs).toHaveLength(1);
      expect(
        (await worlds.readLivingState({ subjectId, worldId }))?.currentPlaceRef,
      ).toBe("class");
      await current.run(() =>
        worlds.advanceRules(subjectId, worldId, {
          timeDomainRef: "school",
          start: "2026-10-19T01:10:00.000Z",
          end: worldAt,
        }),
      );
      worldAt = "2026-10-19T01:25:00.000Z";
      await current.run(() =>
        worlds.advanceRules(subjectId, worldId, {
          timeDomainRef: "school",
          start: "2026-10-19T01:15:00.000Z",
          end: worldAt,
        }),
      );
      expect(
        (await worlds.readLivingState({ subjectId, worldId }))?.currentPlaceRef,
      ).toBe("home");
      expect(
        (await worlds.readLivingState({ subjectId, worldId }))?.energy,
      ).toBeCloseTo(70.5 - 8 / 6);
      expect((await current.run(() => worlds.adoptAction(moveRequest))).status).toBe(
        "completed",
      );
      const rest = await current.run(() =>
        worlds.adoptAction({
          operationId: randomUUID(),
          subjectId,
          worldId,
          sourceReactionRef: "reaction:rest",
          action: { kind: "rest" },
        }),
      );
      expect(rest.status).toBe("pending");
      worldAt = "2026-10-19T01:40:00.000Z";
      const missed = await current.run(() =>
        worlds.advanceRules(subjectId, worldId, {
          timeDomainRef: "school",
          start: "2026-10-19T01:25:00.000Z",
          end: worldAt,
        }),
      );
      expect(missed.events.every((event) => event.scheduleOutcome === "missed")).toBe(
        true,
      );
      expect(
        (await worlds.readLivingState({ subjectId, worldId }))?.currentPlaceRef,
      ).toBe("home");
      expect(
        (await worlds.readLivingState({ subjectId, worldId }))?.energy,
      ).toBeCloseTo(70.5 - 8 / 6 + 3);
      expect(await worlds.readPendingActions(subjectId, worldId)).toHaveLength(0);
      const rejected = await current.run(() =>
        worlds.adoptAction({
          operationId: randomUUID(),
          subjectId,
          worldId,
          sourceReactionRef: "reaction:cannot-teleport",
          action: {
            kind: "participate",
            scheduleId: worldOccurrenceId(
              worldId,
              classRule.ruleId,
              "2026-10-19T09:00:00",
            ),
          },
        }),
      );
      expect(rejected.status).toBe("rejected");
      await expect(
        current.run(() =>
          worlds.adoptAction(
            { ...moveRequest, operationId: randomUUID() },
            async () => {
              throw subjectProblem(
                "world.action_revoked",
                "Foreground revoked",
                "Use the actual current Reaction",
                "conflict",
              );
            },
          ),
        ),
      ).rejects.toMatchObject({ problem: { problemCode: "world.action_revoked" } });
      const energyBefore = (await worlds.readLivingState({ subjectId, worldId }))!
        .energy;
      worldAt = "2026-10-19T01:50:00.000Z";
      const worldHead = (await worlds.read(subjectId, worldId))!;
      const policy = await current.run(() =>
        profiles.adopt({
          ...request,
          operationId: randomUUID(),
          expectedRevision: worldHead.revision,
          profile: {
            ...profile,
            energy: {
              ...profile.energy,
              rates: { ...profile.energy.rates, study: -4 },
            },
          },
        }),
      );
      expect(policy.revision).toBe(2);
      expect(policy.entrySourceRef).toBe(adopted.entrySourceRef);
      expect(policy.entryRecordedAt).toBe(adopted.entryRecordedAt);
      expect((await worlds.readLivingState({ subjectId, worldId }))!.energy).toBe(
        energyBefore,
      );
      worldAt = "2026-10-19T02:00:00.000Z";
      const policyHead = (await worlds.read(subjectId, worldId))!;
      const afterPolicy = {
        ...study,
        eventId: randomUUID(),
        placeRef: "home",
        interval: { ...range, start: "2026-10-19T01:40:00.000Z", end: worldAt },
      };
      await current.run(() =>
        worlds.realize({
          ...operation,
          operationId: randomUUID(),
          expectedRevision: policyHead.revision,
          interval: afterPolicy.interval,
          events: [afterPolicy],
        }),
      );
      expect(
        (await worlds.readLivingState({ subjectId, worldId }))!.energy,
      ).toBeCloseTo(energyBefore - 8 / 6 - 4 / 6);
      const plan = {
        scheduleId: randomUUID(),
        interval: { ...range, start: worldAt, end: "2026-10-19T02:20:00.000Z" },
        title: "Cancelable home activity",
        description: "Explicit adopted plan",
        actorRefs: [actor],
        placeRef: "home",
        activityId: null,
        sourceRefs: [],
        status: "planned" as const,
        overlap: "exclusive" as const,
      };
      const beforePlan = (await worlds.read(subjectId, worldId))!;
      const planned = await current.run(() =>
        worlds.configure({
          operationId: randomUUID(),
          expectedRevision: beforePlan.revision,
          definition: {
            ...beforePlan.definition,
            revision: beforePlan.definition.revision + 1,
          },
          schedule: [plan],
        }),
      );
      const participation = await current.run(() =>
        worlds.adoptAction({
          operationId: randomUUID(),
          subjectId,
          worldId,
          sourceReactionRef: "reaction:cancel-plan",
          action: { kind: "participate", scheduleId: plan.scheduleId },
        }),
      );
      expect(participation.status).toBe("pending");
      await current.run(() =>
        worlds.configure({
          operationId: randomUUID(),
          expectedRevision: planned.revision,
          definition: {
            ...planned.definition,
            revision: planned.definition.revision + 1,
          },
          schedule: [{ ...plan, status: "cancelled" }],
        }),
      );
      worldAt = "2026-10-19T02:01:00.000Z";
      expect(
        (await current.run(() => worlds.completeActions({ subjectId, worldId })))[0]
          ?.status,
      ).toBe("cancelled");
      expect(
        (await worlds.readLivingState({ subjectId, worldId }))?.currentActivityRefs,
      ).toEqual([]);
    } finally {
      await current.close();
    }
  }, 15000);
});
