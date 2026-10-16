// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Composes current channel, Life and cognition owners without an agent loop.
 * @module gateway-runtime
 */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { digestCanonicalJson } from "@heptalogos/foundation-contracts";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import type { PersistenceService } from "@heptalogos/persistence";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import { createMessagingService } from "@heptalogos/messaging";
import { createIdentityService } from "@heptalogos/identity";
import {
  createSubjectReactorService,
  createLifeService,
  createPursuitService,
  createAgencyService,
  createWorldLifeService,
  createWorldProfileService,
  createWorldHostLifecycleService,
  createDeliberationService,
  createNarrativeService,
  narrativeReviewSchema,
  type NarrativeReview,
  assertScopeWithin,
  type ActivityScope,
  type LifeActivity,
} from "@heptalogos/subject";
import {
  effectiveReactorPolicy,
  managementProblem,
  type ProductManagement,
  type SubjectRoleBinding,
} from "@heptalogos/management";
import { createArchiveStore } from "./archive-store.js";
import { createChannelRouteStore } from "./channel-routes.js";
import { hasCanonicalProfileSources } from "./native-profile-source.js";
import { authorizeAdoptedTaskSources } from "./adopted-task-sources.js";
import { createNativeCognitionBridge } from "./native-cognition.js";
import { projectWorldDeadline } from "@nous-wave/client";
import { connectProductNous } from "./nous.js";
import { createActivityOpportunity } from "./activity-opportunity.js";
import { createSelectedMediaUploader } from "./selected-media.js";
import {
  encodeCognitionUsage,
  decodeCognitionUsage,
  decodeObservationInput,
  decodeAcceptedObservation,
} from "@nous-wave/client/host-bridge";
import {
  hasCanonicalNativeMessages,
  hasAuthorizedNativeSources,
} from "./native-source-selection.js";
import { createPursuitMotivation } from "./pursuit-motivation.js";
import { compileSchema } from "@heptalogos/schema-runtime";
import { createSubjectReactor } from "./subject-reactor.js";
import { createSubjectSituationRuntime } from "./subject-situation.js";
import { createSubjectAttentionRuntime } from "./subject-attention-runtime.js";
import { createSubjectActivityResolver } from "./subject-activity-resolver.js";
import { createSubjectRoles } from "./subject-roles.js";
import { createSubjectActivityStarter } from "./subject-activity-runtime.js";
import { createSubjectDecisionHandler, decisionPhaseId } from "./subject-decisions.js";
import { createBoundLifeReader } from "./native-life-read.js";
import { createWorldHostRuntime } from "./world-host-runtime.js";
import { createWorldRuntime } from "./world-runtime.js";
import { currentSubjectContext, readActualSubjectStamp } from "./subject-context.js";
import type { NativeWorldSchedule, NativeAgentSelect } from "./native-dispatch.js";
import { timestampFromDate } from "@nous-wave/client/host-bridge";
import { createActivityDispatcher } from "./activity-dispatch.js";
import type { NativeActivityDispatch } from "./activity-dispatch-contracts.js";
import type { GatewayScope } from "./gateway-contracts.js";
import type { GatewayHttpOptions } from "./gateway-http.js";
/** Existing Host lifecycle and current authenticated settings remain the owners. */
export interface GatewayRuntimeOptions {
  readonly dispatchNativeActivity?: NativeActivityDispatch;
  readonly scheduleWorld?: NativeWorldSchedule;
  readonly selectNativeAgent?: NativeAgentSelect;
  readonly persistence: PersistenceService;
  readonly product: Pick<ProductManagement, "configuration">;
  readonly secretRoot: string;
  readonly dataRoot: string;
  readonly now: () => string;
  readonly runMutation: GatewayHttpOptions["runMutation"];
}
function denied(detail: string): never {
  throw managementProblem(
    "gateway.scope_denied",
    "Current channel scope does not allow this operation",
    detail,
    "authorization",
  );
}
async function cognitionRead<T>(invoke: () => Promise<T>): Promise<T> {
  try {
    return await invoke();
  } catch (error) {
    if (error instanceof Error && "problem" in error) throw error;
    throw managementProblem(
      "gateway.cognition_unavailable",
      "The actual cognition dependency is unavailable",
      "Inspect the configured Nous service and required public operation",
      "unavailable",
      "after-change",
    );
  }
}
async function serviceCredential(root: string) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, "channel-service-token");
  try {
    await writeFile(path, randomBytes(32).toString("hex") + "\n", {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST"))
      throw error;
  }
  const stat = await lstat(path);
  if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0))
    throw Error("Channel credential requires a private regular file");
  const token = (await readFile(path, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(token))
    throw Error("Channel service credential is invalid");
  const expected = createHash("sha256").update(token).digest();
  return async (supplied: string | undefined) => {
    if (
      !supplied ||
      !timingSafeEqual(createHash("sha256").update(supplied).digest(), expected)
    )
      throw managementProblem(
        "gateway.service_invalid",
        "Invalid Channel service credential",
        "Use this installation's protected Channel service credential",
        "authentication",
      );
  };
}
/** Initializes only local owners; models, QQ and Nous need not be online to start Management. */
export async function createGatewayRuntime(options: GatewayRuntimeOptions) {
  const messaging = createMessagingService({ persistence: options.persistence });
  const identity = createIdentityService({ persistence: options.persistence });
  const scope = async (
    transaction?: PersistenceInternalTransaction,
  ): Promise<GatewayScope> => {
    const current = await options.product.configuration(transaction);
    const settings = current.settings;
    if (!settings?.subject.id || !settings.qq || !current.revision)
      throw managementProblem(
        "gateway.unconfigured",
        "Channel authorization is not configured",
        "Bind the Subject and explicitly configure the installation's QQ grants",
        "unavailable",
      );
    return {
      subjectId: settings.subject.id,
      revision: current.revision,
      ...settings.qq,
    };
  };
  const nous = async () => {
    const current = await options.product.configuration();
    if (!current.settings)
      throw managementProblem(
        "gateway.unconfigured",
        "Nous binding is not configured",
        "Configure the official Nous discovery binding",
        "unavailable",
      );
    return connectProductNous(current.settings);
  };
  const currentSettings = async (transaction?: PersistenceInternalTransaction) => {
    const config = await options.product.configuration(transaction);
    if (!config.settings?.subject.id)
      denied("Bind the existing Subject through Management");
    return config.settings;
  };
  const currentSubject = async () => (await currentSettings()).subject.id!;
  const bindingFor = async (
    role: SubjectRoleBinding["role"],
    agentId?: string,
    transaction?: PersistenceInternalTransaction,
  ) => {
    const bindings = ((await currentSettings(transaction)).roles ?? []).filter(
      (binding) => binding.role === role && binding.enabled,
    );
    if (bindings.length !== 1)
      denied("Configure exactly one enabled native binding for " + role);
    const binding = bindings[0]!;
    if (
      agentId &&
      agentId !== binding.nativeAgentRef &&
      !binding.fallbackAgentRefs.includes(agentId)
    )
      denied(
        "This actual native profile is not an explicit binding of the requested role",
      );
    if (
      ["subject.render", "narrative.review"].includes(role) &&
      binding.allowedTools.length
    )
      denied("Renderer and review duties cannot acquire arbitrary tools");
    return binding;
  };
  const self = async (
    subjectId: string,
    actor: string,
    transaction?: PersistenceInternalTransaction,
  ) => {
    const settings = await currentSettings(transaction);
    if (settings.subject.id !== subjectId)
      denied("The operation names a different Subject");
    const bound = await identity.readSubjectEntity({ subjectId }, transaction);
    if (bound.entity?.entityRef !== actor)
      denied("Only the actual bound Subject actor may adopt work");
    return settings;
  };
  const authority = async (
    subjectId: string,
    actor: string,
    requested: ActivityScope,
    transaction?: PersistenceInternalTransaction,
  ): Promise<ActivityScope> => {
    const settings = await self(subjectId, actor, transaction);
    const current = settings.qq;
    const conversations: ActivityScope["conversations"] = [];
    const readableIds: string[] = [];
    for (const grant of current?.conversations ?? []) {
      if (!grant.receive) continue;
      const found = await messaging.resolveConversations(
        {
          conversations: [
            {
              platform: "qq",
              accountId: current!.accountId,
              kind: grant.kind,
              conversationId: grant.conversationId,
            },
          ],
        },
        transaction,
      );
      for (const id of found.conversationIds) {
        if (grant.observe) readableIds.push(id);
        const operations: ActivityScope["conversations"][number]["operations"] =
          grant.observe ? ["observe"] : [];
        for (const effect of grant.effects)
          if (
            effect === "send" ||
            effect === "edit" ||
            effect === "withdraw" ||
            effect === "moderate"
          )
            operations.push(effect);
        conversations.push({
          conversationRef: "conversation:heptalogos:" + id,
          operations,
        });
      }
    }
    const messageRefs = requested.sourceRefs.flatMap(
      (ref) => /^message:([0-9a-f-]{36})$/i.exec(ref)?.[1] ?? [],
    );
    const material = messageRefs.length
      ? await messaging.messageSources(
          { messageRefs, conversationIds: readableIds },
          transaction,
        )
      : { sources: [] };
    const sources = new Set(current?.sourceRefs ?? []);
    for (const ref of await worlds.resolveSourceRefs(
      {
        subjectId,
        sourceRefs: requested.sourceRefs,
      },
      transaction,
    ))
      sources.add(ref);
    for (const source of material.sources)
      if (source.lifecycle === "present") sources.add("message:" + source.messageRef);
    return {
      conversations,
      tools: [
        ...new Set([
          ...(current?.tools ?? []),
          ...(settings.roles ?? [])
            .filter((binding) => binding.enabled)
            .flatMap((binding) => binding.allowedTools),
        ]),
      ],
      sourceRefs: [...sources],
      maxRunMs: Math.max(
        current?.maxRunMs ?? 1000,
        ...(settings.roles ?? [])
          .filter((binding) => binding.enabled)
          .map((binding) => binding.deadlineMs),
      ),
    };
  };
  const life = createLifeService({
    persistence: options.persistence,
    now: options.now,
    scopeAuthority: authority,
    worldNow: async (subjectId) => {
      const clock = await cognitionRead(async () =>
        (await nous()).clocks.readClock({ subjectId }, { timeoutMs: 5000 }),
      );
      const stamp = clock.now;
      if (
        !stamp?.at ||
        stamp.timeDomainRef !== clock.timeDomainRef ||
        !clock.timeDomainRef
      )
        throw managementProblem(
          "gateway.clock_unavailable",
          "The actual Subject clock is unavailable",
          "Start the configured Nous version with the official clock service",
          "unavailable",
        );
      return {
        timeDomainRef: clock.timeDomainRef,
        at:
          new Date(Number(stamp.at.seconds) * 1000).toISOString().slice(0, -5) +
          "." +
          String(stamp.at.nanos).padStart(9, "0") +
          "Z",
      };
    },
  });
  const worlds = createWorldLifeService({
    persistence: options.persistence,
    now: options.now,
    worldNow: life.worldNow,
  });
  const profiles = createWorldProfileService({
    persistence: options.persistence,
    now: options.now,
    worldNow: life.worldNow,
    worlds,
    resolveActor: async (input) => {
      if (input.subjectId !== (await currentSubject()))
        denied("WorldProfile names another current Subject");
      return input.actorKey === "self"
        ? (await identity.ensureSubjectEntity({ subjectId: input.subjectId })).entityRef
        : (
            await identity.resolveWorldActor({
              worldId: input.worldId,
              actorKey: input.actorKey,
            })
          ).entityRef;
    },
  });
  const worldHostLifecycle = createWorldHostRuntime({
    profiles,
    currentWorldId: async () => (await currentSettings()).subject.worldId,
    life,
    worlds,
    currentSubject,
    nous,
    lifecycle: createWorldHostLifecycleService({
      persistence: options.persistence,
      now: options.now,
    }),
  });
  const pursuits = createPursuitService({
    persistence: options.persistence,
    life,
    now: options.now,
    motivation: createPursuitMotivation({ nous, now: options.now }),
    authorize: async (activity, actor) => {
      if (!activity.scope) denied("The Activity is not adopted");
      assertScopeWithin(
        activity.scope,
        await authority(activity.subjectId, actor, activity.scope),
      );
    },
  });
  let readLife: ReturnType<typeof createBoundLifeReader>;
  let foreground: ReturnType<typeof createSubjectReactorService>;
  let reactor: ReturnType<typeof createSubjectReactor>;
  const scheduleNative: NativeWorldSchedule =
    options.scheduleWorld ??
    (async () => {
      throw managementProblem(
        "gateway.native_unavailable",
        "Native scheduler unavailable",
        "Use the installed native command scheduler",
        "unavailable",
      );
    });
  const native = createNativeCognitionBridge({
    workerConcurrency: async (tx) =>
      effectiveReactorPolicy(await currentSettings(tx)).workerConcurrency,
    onRunReady: async (input) => {
      if (input.subjectId !== (await currentSubject())) return;
      await scheduleNative({
        subjectId: input.subjectId,
        activityId: input.activityId,
        realAt: new Date(Date.parse(options.now()) + 1000).toISOString(),
        requestId: decisionPhaseId(input.runId, "terminal-ready"),
      });
    },
    assertForegroundIn: async (tx, registration) => {
      if (
        !["subject.deliberation", "subject.render", "narrative.review"].includes(
          registration.roleScope.role,
        )
      )
        return;
      if (!registration.foreground)
        denied(
          "This new foreground provider attempt has no actual Reactor qualification",
        );
      await foreground.assertCurrentIn(
        tx,
        registration.subjectId,
        registration.activityId,
        registration.foreground,
      );
    },
    onWorldContactsAdmitted: async (input, registration) => {
      const acknowledged = new Set<string>();
      for (const contact of registration.contacts) {
        const observation = decodeObservationInput(contact.observation),
          source = observation.worldRealized;
        if (
          !source ||
          !input.occurrences.some(
            (receipt) =>
              receipt.contactRef === contact.contactRef &&
              decodeAcceptedObservation(receipt.receipt).occurrenceId,
          )
        )
          continue;
        const key = source.worldId + ":" + source.eventId;
        if (acknowledged.has(key)) continue;
        await worlds.acknowledgeContact({
          subjectId: input.subjectId,
          worldId: source.worldId,
          eventId: source.eventId,
          runId: input.native.runId,
          contactRef: contact.contactRef,
        });
        acknowledged.add(key);
      }
    },
    authorizeRetainedResult: async (registration, activity, tx) => {
      await pursuits.assertActivityCurrent(
        registration.subjectId,
        registration.activityId,
        tx,
      );
      await self(registration.subjectId, registration.actorEntityRef, tx);
      if (
        !activity.scope ||
        !(await hasCanonicalNativeMessages(registration, messaging, tx))
      )
        denied("The original result source authority changed");
      assertScopeWithin(
        activity.scope,
        await authority(
          registration.subjectId,
          registration.actorEntityRef,
          activity.scope,
          tx,
        ),
      );
    },
    authorizeAdoptedTaskSources: (registration, parent, transaction) =>
      authorizeAdoptedTaskSources(
        { decisions, life, worlds },
        registration,
        parent,
        transaction,
      ),
    readLife: (binding, request) => readLife(binding, request),
    captureObservedStamp: (subjectId) =>
      cognitionRead(() => readActualSubjectStamp(nous, subjectId)),
    persistence: options.persistence,
    life,
    now: options.now,
    recordContact: (input) => messaging.recordContact(input),
    resolveChildProviderPolicy: async (_parent, agentId) => {
      const binding = await bindingFor("subject.execution", agentId);
      return {
        tokenBudget: {
          inputTokens: binding.inputTokens,
          outputTokens: binding.outputTokens,
        },
        allowedToolNames: binding.allowedTools,
      };
    },
    nous,
    checkInput: async (registration) =>
      pursuits.guardActivity(registration.subjectId, registration.activityId),
    authorizeInput: async (registration, activity, transaction) => {
      await pursuits.assertActivityCurrent(
        registration.subjectId,
        registration.activityId,
        transaction,
      );
      const settings = await self(
        registration.subjectId,
        registration.actorEntityRef,
        transaction,
      );
      const role = registration.roleScope.role;
      if (
        ![
          "world.planner",
          "subject.deliberation",
          "subject.execution",
          "subject.render",
          "narrative.review",
        ].includes(role)
      )
        denied("This role belongs to another authority");
      const binding = await bindingFor(
        role as SubjectRoleBinding["role"],
        registration.nativeAgentId,
        transaction,
      );
      if (
        !settings.subject.enabled ||
        registration.tokenBudget.inputTokens !== binding.inputTokens ||
        registration.tokenBudget.outputTokens !== binding.outputTokens ||
        registration.allowedToolNames.some(
          (name) => !binding.allowedTools.includes(name),
        )
      )
        denied(
          "The current Subject must be enabled on its actual native account Agent",
        );
      if (!activity.scope) denied("The Activity has not adopted its permission scope");
      if (
        registration.allowedToolNames.some(
          (name) => !activity.scope!.tools.includes(name),
        )
      )
        denied("This actual role invocation exceeds the Activity's adopted tools");
      if (
        !(await hasCanonicalNativeMessages(registration, messaging, transaction)) ||
        !(await hasCanonicalProfileSources(registration, profiles, transaction))
      )
        denied(
          "Selected message contacts do not match the actual authorized conversation",
        );
      assertScopeWithin(
        activity.scope,
        await authority(
          activity.subjectId,
          registration.actorEntityRef,
          activity.scope,
          transaction,
        ),
      );
    },
  });
  const agency = createAgencyService({
    persistence: options.persistence,
    now: options.now,
    onDeliveryRecorded: (fact) => native.recordDeliveryFact(fact),
    checkSources: async (runId) => {
      const run = await native.readRun(runId);
      if (!run) denied("The producer run is not registered by the Host");
      await pursuits.guardActivity(
        run.registration.subjectId,
        run.registration.activityId,
      );
      const consumerId = run.consumerId;
      if (!consumerId) denied("The producer has no admitted cognition consumer");
      if (run.registration.subjectId !== (await currentSubject()))
        denied("The producer belongs to another current Subject");
      const checked = await cognitionRead(async () =>
        (await nous()).runtime.reportUse(
          {
            subjectId: run.registration.subjectId,
            sessionId: run.nousSessionId,
            consumerRef: consumerId,
            modelInput: true,
            events: [],
          },
          { timeoutMs: 5000 },
        ),
      );
      if (!checked.modelInputChecked)
        denied("The actual cognition source propagation barrier was not checked");
    },
    authority: async (runId, recipient, transaction) => {
      const run = await native.readRun(runId, transaction);
      if (!run) denied("The producer run is not registered by the Host");
      await pursuits.assertActivityCurrent(
        run.registration.subjectId,
        run.registration.activityId,
        transaction,
      );
      const current = await scope(transaction);
      if (
        recipient.channel !== "heptalogos-qq" ||
        recipient.accountId !== current.accountId ||
        run.registration.subjectId !== current.subjectId
      )
        denied(
          "The actual producer and protocol account must match the current binding",
        );
      const target = /^(group|direct):([0-9]+)$/.exec(recipient.to);
      if (
        !target ||
        !current.conversations.some(
          (c) =>
            c.kind === target[1] &&
            c.conversationId === target[2] &&
            c.receive &&
            c.effects.includes("send"),
        )
      )
        denied("This exact recipient has no current send grant");
      const found = await messaging.resolveConversations(
        {
          conversations: [
            {
              platform: "qq",
              accountId: current.accountId,
              kind: target[1] as "group" | "direct",
              conversationId: target[2]!,
            },
          ],
        },
        transaction,
      );
      if (found.conversationIds.length !== 1)
        denied("The recipient has no actual canonical conversation");
      const activity = await life.get(
        current.subjectId,
        run.registration.activityId,
        transaction,
      );
      if (!activity?.scope) denied("The original adopted Activity is unavailable");
      const audience = decodeCognitionUsage(run.registration.usage).audience
        ?.conversationRef;
      const targetRef = "conversation:heptalogos:" + found.conversationIds[0]!;
      if (
        audience !== targetRef ||
        !hasAuthorizedNativeSources(activity, run.registration) ||
        !(await hasCanonicalNativeMessages(run.registration, messaging, transaction))
      )
        denied(
          "The actual producer audience and selected canonical sources cannot be rebound to another delivery",
        );
      assertScopeWithin(
        activity.scope,
        await authority(
          current.subjectId,
          run.registration.actorEntityRef,
          activity.scope,
          transaction,
        ),
      );
      if (run.state !== "running")
        denied("The original native run no longer permits a new external effect");
      return {
        activity,
        role: run.registration.roleScope.role,
        actorEntityRef: run.registration.actorEntityRef,
        conversationRef: "conversation:heptalogos:" + found.conversationIds[0]!,
        sourceRefs: run.registration.sourceRefs,
        authorizedDerivedSourceRefs: run.registration.sourceRefs.filter(
          (ref) =>
            !ref.startsWith("message:") &&
            (ref.startsWith("world-event:") || ref.startsWith("role-result-release:")),
        ),
        messageSources: run.registration.messageRefs.map((ref) => ({
          sourceRef: "message:" + ref,
          conversationRef: targetRef,
        })),
      };
    },
  });
  const authorizeActivity = async (activity: LifeActivity) => {
    await pursuits.guardActivity(activity.subjectId, activity.activityId);
    if (!activity.scope || !activity.adoptedBy)
      denied("Use the actual adopted Activity");
    assertScopeWithin(
      activity.scope,
      await authority(activity.subjectId, activity.adoptedBy, activity.scope),
    );
  };
  const decisionSource = async (
    input: Parameters<ReturnType<typeof createDeliberationService>["adopt"]>[0],
  ) => {
    const run = await native.readRun(input.sourceRunId);
    if (
      !run?.consumerId ||
      run.registration.subjectId !== input.subjectId ||
      run.registration.activityId !== input.activityId ||
      run.registration.roleScope.role !== "subject.deliberation"
    )
      denied("Decision adoption requires its actual admitted subjective run");
    const activity = await life.get(input.subjectId, input.activityId);
    if (!activity?.scope) denied("The decision Activity is unavailable");
    await authorizeActivity(activity);
    const actual = new Set(run.registration.sourceRefs);
    const requested = input.decision.delegation?.sourceRefs ?? [];
    const found = await worlds.resolveSourceRefs({
      subjectId: input.subjectId,
      sourceRefs: requested,
    });
    for (const ref of found) {
      const match = /^world-event:([0-9a-f-]{36}):([0-9a-f-]{36}):([0-9]+)$/i.exec(ref);
      if (actual.has(ref)) continue;
      if (
        match &&
        activity.scope.sourceRefs.includes(`world:${match[1]}`) &&
        (
          await worlds.releasedEventIds(input.subjectId, match[1]!, [match[2]!])
        ).includes(match[2]!)
      )
        actual.add(ref);
    }
    return { sourceRefs: [...actual], tools: activity.scope.tools };
  };
  const decisions = createDeliberationService({
    persistence: options.persistence,
    life,
    now: options.now,
    worldNow: life.worldNow,
    validateSourceRun: (input) => decisionSource(input),
    assertSourceRunIn: async (tx, input) => {
      const run = await native.readRun(input.sourceRunId, tx);
      if (
        !run?.consumerId ||
        run.registration.subjectId !== input.subjectId ||
        run.registration.activityId !== input.activityId ||
        run.registration.roleScope.role !== "subject.deliberation"
      )
        denied("The actual decision source changed before adoption");
      if (!run.registration.foreground)
        denied("The decision source has no Reactor foreground qualification");
      await foreground.assertCurrentIn(
        tx,
        input.subjectId,
        input.activityId,
        run.registration.foreground,
      );
      await pursuits.assertActivityCurrent(input.subjectId, input.activityId, tx);
      const settings = await self(input.subjectId, run.registration.actorEntityRef, tx);
      await bindingFor("subject.deliberation", run.registration.nativeAgentId, tx);
      if (!settings.subject.enabled) denied("The current Subject is disabled");
      const activity = await life.get(input.subjectId, input.activityId, tx);
      if (!activity?.scope) denied("The actual decision Activity is unavailable");
      if (
        !(await hasCanonicalNativeMessages(run.registration, messaging, tx)) ||
        !hasAuthorizedNativeSources(activity, run.registration)
      )
        denied("The actual decision's admitted source authority changed");
      assertScopeWithin(
        activity.scope,
        await authority(
          input.subjectId,
          run.registration.actorEntityRef,
          activity.scope,
          tx,
        ),
      );
    },
  });
  const nativeRoles = createSubjectRoles({
    life,
    native,
    bindings: async () => (await currentSettings()).roles ?? [],
    selectAgent: async (binding) => {
      if (!options.selectNativeAgent)
        throw managementProblem(
          "gateway.native_unavailable",
          "Native profile selection is unavailable",
          "Use the installed native profile catalog",
          "unavailable",
        );
      return options.selectNativeAgent([
        binding.nativeAgentRef,
        ...binding.fallbackAgentRefs,
      ]);
    },
    dispatch:
      options.dispatchNativeActivity ??
      (async () => {
        throw managementProblem(
          "gateway.native_unavailable",
          "Native execution is not configured",
          "Use the installed Subject Gateway and explicit role bindings",
          "unavailable",
        );
      }),
    authorize: async (activity, binding) => {
      await authorizeActivity(activity);
      await bindingFor(binding.role, binding.nativeAgentRef);
    },
  });
  let narrative: ReturnType<typeof createNarrativeService>;
  const roles: ReturnType<typeof createSubjectRoles> = {
    startExecution: nativeRoles.startExecution,
    invoke: async (input) => {
      if (input.role !== "subject.deliberation") return nativeRoles.invoke(input);
      const activity = await life.get(input.subjectId, input.activityId);
      if (!activity?.scope) denied("The actual Activity is unavailable");
      await authorizeActivity(activity);
      const context = await currentSubjectContext(
        { worlds, life, narrative },
        input,
        [...new Set([...activity.scope.sourceRefs, ...input.sourceRefs])].slice(0, 128),
      );
      const usage = decodeCognitionUsage(input.usage);
      if (!usage.worldId && context.knownWorldViews.length === 1)
        usage.worldId = context.knownWorldViews[0]!.worldId;
      usage.worldTime = decodeCognitionUsage(
        encodeCognitionUsage({
          worldTime: {
            timeDomainRef: context.world.timeDomainRef,
            at: timestampFromDate(new Date(context.world.at)),
            recordedAt: timestampFromDate(new Date(options.now())),
          },
        }),
      ).worldTime;
      return nativeRoles.invoke({
        ...input,
        usage: encodeCognitionUsage(usage),
        context: { ...input.context, ...context },
      });
    },
  };
  narrative = createNarrativeService({
    persistence: options.persistence,
    decisions,
    worlds,
    life,
    agency,
    worldNow: life.worldNow,
    now: options.now,
    assertCandidateCurrentIn: async (tx, runId) => {
      const run = await native.readRun(runId, tx);
      if (!run?.registration.foreground)
        denied("The renderer has no actual foreground qualification");
      await foreground.assertCurrentIn(
        tx,
        run.registration.subjectId,
        run.registration.activityId,
        run.registration.foreground,
      );
    },
    review: async (brief, prepared) => {
      const applied = await native.readAppliedContext(prepared.runId);
      const claims = await narrative.claimsTo({
        subjectId: brief.subjectId,
        conversationRef: brief.audience.conversationRef,
        limit: 64,
        order: "newest",
      });
      const world = brief.worldDetailScope
        ? await worlds.query({
            subjectId: brief.subjectId,
            worldId: brief.worldDetailScope.worldId,
            interval: brief.worldDetailScope.interval,
            view: "world_author",
            limit: 64,
          })
        : null;
      const review = await roles.invoke({
        requestId: decisionPhaseId(
          prepared.runId,
          "narrative-review:" + prepared.nativeIntentId,
        ),
        requestDigest: digestCanonicalJson("host.narrative-review.v1", {
          briefId: brief.briefId,
          rendererRunId: prepared.runId,
          nativeIntentId: prepared.nativeIntentId,
        }).hex,
        subjectId: brief.subjectId,
        activityId: brief.activityId,
        parentRunId: prepared.runId,
        role: "narrative.review",
        foreground: (await native.readRun(prepared.runId))!.registration.foreground,
        deadlineAt: brief.validUntil,
        context: {
          brief,
          prepared,
          currentClaims: claims,
          relatedWorld: world,
          outputContract: narrativeReviewSchema,
        },
        contacts: [],
        sourceRefs: brief.sourceRefs,
        usage: applied.usage,
      });
      let parsed: unknown;
      try {
        parsed = JSON.parse(review.text);
      } catch {
        throw managementProblem(
          "narrative.invalid_review",
          "Reviewer returned invalid JSON",
          "Inspect the actual saved review role result",
          "validation",
        );
      }
      const checked =
        compileSchema<NarrativeReview>(narrativeReviewSchema).validate(parsed);
      if (!checked.ok)
        throw managementProblem(
          "narrative.invalid_review",
          "Reviewer output does not match its contract",
          "Inspect the actual saved review result",
          "validation",
        );
      return { reviewerRunId: review.runId, review: checked.value };
    },
  });
  readLife = createBoundLifeReader({ worlds, narrative, messaging });
  const decisionHandler = createSubjectDecisionHandler({
    startActivity: createSubjectActivityStarter({
      life,
      decisions,
      native,
      nous,
      authorize: authorizeActivity,
      schedule: async (activity, adopted) => {
        await scheduleNative({
          subjectId: activity.subjectId,
          activityId: activity.activityId,
          realAt: new Date(Date.parse(options.now()) + 1000).toISOString(),
          requestId: decisionPhaseId(adopted.decisionId, "initial-opportunity"),
        });
      },
    }),
    life,
    decisions,
    narrative,
    worlds,
    native,
    roles,
    now: options.now,
    deliveryFor: async (subjectId, activityId, usage) => {
      const audience = decodeCognitionUsage(usage).audience?.conversationRef;
      if (!audience) return undefined;
      const current = await scope();
      if (current.subjectId !== subjectId) return undefined;
      const activity = await life.get(subjectId, activityId);
      if (
        !activity?.scope?.conversations.some(
          (grant) =>
            grant.conversationRef === audience && grant.operations.includes("send"),
        )
      )
        return undefined;
      for (const grant of current.conversations) {
        if (!grant.receive || !grant.effects.includes("send")) continue;
        const resolved = await messaging.resolveConversations({
          conversations: [
            {
              platform: "qq",
              accountId: current.accountId,
              kind: grant.kind,
              conversationId: grant.conversationId,
            },
          ],
        });
        if (
          resolved.conversationIds.some(
            (id) => "conversation:heptalogos:" + id === audience,
          )
        )
          return {
            conversationRef: audience,
            channel: "heptalogos-qq",
            accountId: current.accountId,
            to: grant.kind + ":" + grant.conversationId,
          };
      }
      return undefined;
    },
  });
  const worldRuntime = createWorldRuntime({
    worlds,
    life,
    narrative,
    roles,
    native,
    wakeSubject: (input) => reactor.wake(input),
    nous,
    currentSubject,
    enabled: async () => !!(await currentSettings()).subject.enabled,
    bindingFor,
    authorize: authorizeActivity,
    schedule:
      options.scheduleWorld ??
      (async () => {
        throw managementProblem(
          "gateway.native_unavailable",
          "Native scheduler is not configured",
          "Use the installed Subject Gateway cron adapter",
          "unavailable",
        );
      }),
    now: options.now,
  });
  const routes = createChannelRouteStore({
    persistence: options.persistence,
    scope,
    now: options.now,
  });
  const archive = createArchiveStore(
    join(options.dataRoot, "messaging", "protected-cas"),
  );
  const activities = createActivityDispatcher({
    prepareMedia: createSelectedMediaUploader({ archive, nous }),
    life,
    messaging,
    identity,
    native,
    routes,
    scope,
    nous,
    now: options.now,
    wake: (input) => reactor.wake(input),
    authorizeActivity: async (activity) => {
      await pursuits.guardActivity(activity.subjectId, activity.activityId);
      if (!activity.scope || !activity.adoptedBy) denied("The Activity is not adopted");
      assertScopeWithin(
        activity.scope,
        await authority(activity.subjectId, activity.adoptedBy, activity.scope),
      );
    },
  });
  const attention = createSubjectAttentionRuntime({
    profiles,
    persistence: options.persistence,
    settings: currentSettings,
    life,
    worlds,
    narrative,
    native,
    messaging,
    now: options.now,
  });
  foreground = createSubjectReactorService({
    life,
    persistence: options.persistence,
    now: options.now,
    policy: async (tx) => effectiveReactorPolicy(await currentSettings(tx)),
    attention,
    assertActivityIn: async (tx, subjectId, activityId) => {
      const activity = await life.get(subjectId, activityId, tx);
      if (
        !activity?.adoptedBy ||
        !activity.scope ||
        activity.state !== "active" ||
        activity.continuationRequired
      )
        denied("Use the current adopted active Activity");
      await pursuits.assertActivityCurrent(subjectId, activityId, tx);
      const settings = await self(subjectId, activity.adoptedBy, tx);
      if (!settings.subject.enabled) denied("The Subject is disabled");
      assertScopeWithin(
        activity.scope,
        await authority(subjectId, activity.adoptedBy, activity.scope, tx),
      );
    },
  });
  const resolveActivity = createSubjectActivityResolver({
    settings: currentSettings,
    identity,
    life,
    nous,
    authorize: authorizeActivity,
    scopeFor: (subjectId, actor, worldId) =>
      authority(subjectId, actor, {
        conversations: [],
        tools: [],
        sourceRefs: worldId ? ["world:" + worldId] : [],
        maxRunMs: 1000,
      }),
  });
  const situation = createSubjectSituationRuntime({
    profiles,
    nous,
    persistence: options.persistence,
    settings: currentSettings,
    resolveActivity,
    life,
    worlds,
    foreground,
    native,
    roles,
    decisions: decisionHandler,
    messaging,
    activities,
    now: options.now,
  });
  reactor = createSubjectReactor({
    worldNow: life.worldNow,
    readActivity: (subjectId, activityId) => life.get(subjectId, activityId),
    foreground,
    attention,
    roles,
    decisions: decisionHandler,
    native,
    now: options.now,
    enabled: async () => !!(await currentSettings()).subject.enabled,
    resolveActivity,
    afterYield: (subjectId) => reprojectSubject(subjectId),
    prepare: situation.prepare,
    act: situation.act,
    saveContinuation: situation.saveContinuation,
  });
  const requestReactorOpportunity = async (input: {
    subjectId: string;
    operationRef: string;
  }) => {
    if (input.subjectId !== (await currentSubject()))
      denied("The opportunity names another current Subject");
    await scheduleNative({
      subjectId: input.subjectId,
      realAt: new Date(Date.parse(options.now()) + 1000).toISOString(),
      requestId: decisionPhaseId(input.operationRef, "reactor-opportunity"),
    });
  };
  const reprojectSubject = async (subjectId: string) => {
    let next = await worldRuntime.reproject();
    const selection = await attention.select({ subjectId });
    const actualNow = Date.parse(options.now());
    const metadataAt = selection.selected
      ? new Date(actualNow + 1000).toISOString()
      : selection.nextConsiderAt;
    if (metadataAt && (!next || Date.parse(metadataAt) < Date.parse(next)))
      next = new Date(Math.max(Date.parse(metadataAt), actualNow + 1000)).toISOString();
    const clock = await (
      await nous()
    ).clocks.readClock({ subjectId }, { timeoutMs: 5000 });
    let afterId: string | undefined;
    if (clock.now)
      do {
        const page = await life.schedule({
          subjectId,
          states: ["active"],
          limit: 128,
          ...(afterId ? { afterId } : {}),
        });
        for (const activity of page.activities)
          if (activity.nextOpportunity && !activity.continuationRequired) {
            const due = projectWorldDeadline(clock, {
              ...clock.now,
              timeDomainRef: activity.nextOpportunity.timeDomainRef,
              at: timestampFromDate(new Date(activity.nextOpportunity.at)),
            });
            if (due.kind === "due") {
              const at = new Date(
                Math.max(due.at.getTime(), actualNow + 1000),
              ).toISOString();
              if (!next || Date.parse(at) < Date.parse(next)) next = at;
            }
          }
        afterId = page.nextId ?? undefined;
      } while (afterId);
    await scheduleNative({
      subjectId,
      realAt: next,
      requestId: decisionPhaseId(subjectId, "reactor-next:" + (next ?? "none")),
    });
  };
  const opportunity = createActivityOpportunity({
    scope,
    wake: (input) => reactor.wake(input),
    enabled: async () =>
      !!(await options.product.configuration()).settings?.subject.enabled,
  });
  const http: GatewayHttpOptions = {
    reactor: async (input) => {
      if (input.subjectId !== (await currentSubject()))
        denied("The Reactor wake belongs to another Subject");
      if (input.worldId && input.activityId) {
        await worldRuntime.advance({
          ...input,
          worldId: input.worldId,
          activityId: input.activityId,
        });
        return { status: "processed" };
      }
      const result = await reactor.wake({
        subjectId: input.subjectId,
        naturalOpportunity: true,
      });
      await reprojectSubject(input.subjectId);
      return result;
    },
    opportunity,
    authenticate: await serviceCredential(options.secretRoot),
    runMutation: options.runMutation,
    scope,
    messaging,
    identity,
    life,
    agency: { ...agency, adoptDelivery: (input) => narrative.adoptDelivery(input) },
    routes,
    archive,
    cognition: native,
    activities,
  };
  return {
    http,
    life,
    native,
    foreground,
    reactor,
    attention,
    requestReactorOpportunity,
    reprojectSubject,
    routes,
    messaging,
    identity,
    activities,
    pursuits,
    worldRuntime,
    profiles,
    worldHostLifecycle,
    worldHttp: {
      profiles,
      living: worlds.readLivingState,
      authenticate: http.authenticate,
      runMutation: options.runMutation,
      worlds: {
        ...worlds,
        configure: async (input: Parameters<typeof worlds.configure>[0]) => {
          const expected = await identity.ensureSubjectEntity({
            subjectId: input.definition.subjectId,
          });
          if (input.definition.subjectActorRef !== expected.entityRef)
            denied("World Subject actor must be its actual self Entity");
          const refs = input.definition.actors
            .map((actor) => actor.entityRef)
            .filter((ref) => ref !== expected.entityRef);
          const checked = await identity.readWorldActors({
            worldId: input.definition.worldId,
            entityRefs: refs,
          });
          if (checked.actors.length !== refs.length)
            denied("Every virtual actor must belong to this exact adopted world");
          return worlds.configure(input);
        },
      },
      identity,
      currentSubject,
    },
    worldOpportunityHttp: {
      authenticate: http.authenticate,
      runMutation: options.runMutation,
      currentSubject,
      advance: worldRuntime.advance,
    },
    narrativeHttp: {
      authenticate: http.authenticate,
      runMutation: options.runMutation,
      currentSubject,
      narrative,
    },
    pursuitHttp: {
      authenticate: http.authenticate,
      runMutation: options.runMutation,
      pursuits,
      currentSubject,
    },
  };
}
