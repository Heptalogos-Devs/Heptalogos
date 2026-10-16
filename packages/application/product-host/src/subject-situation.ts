// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Resolves current object handles into existing Messaging, World, Life and native owners.
 * @module subject-situation
 */
import type { NousClient } from "@nous-wave/client";
import { v5 as uuidv5 } from "uuid";
import { digestCanonicalJson } from "@heptalogos/foundation-contracts";
import type { PersistenceService } from "@heptalogos/persistence";
import { useRepositoryMutationTransaction } from "@heptalogos/persistence/repository";
import {
  managementProblem,
  effectiveReactorPolicy,
  type ProductSettings,
} from "@heptalogos/management";
import type { MessagingService } from "@heptalogos/messaging";
import {
  type SubjectReaction,
  type SituationObject,
  type SituationFrame,
  type SubjectAttentionCandidate,
  type createLifeService,
  type createWorldLifeService,
  type createWorldProfileService,
  type createSubjectReactorService,
  type ReactorActionReceipt,
  type DecisionCommit,
} from "@heptalogos/subject";
import {
  encodeCognitionUsage,
  decodeCognitionUsage,
  decodeObservationInput,
  encodeObservationInput,
  timestampFromDate,
  decodeAcceptedObservation,
  type HostPrepareResponse,
} from "@nous-wave/client/host-bridge";
import type {
  NativeRoleResults,
  createNativeCognitionBridge,
} from "./native-cognition.js";
import type { createActivityDispatcher } from "./activity-dispatch.js";
import type { createSubjectRoles } from "./subject-roles.js";
import type { createSubjectDecisionHandler } from "./subject-decisions.js";
import { createSubjectSourceContacts } from "./subject-source-contact.js";
import { decisionPhaseId } from "./subject-decisions.js";
import type { ReactorPreparedView, ReactorActionOutcome } from "./subject-reactor.js";
const ns = "e51d00a4-cd3f-47ef-9fde-bdbb52d51099";
const handle = (owner: string, ref: string, revision: string) =>
  "object:" + uuidv5(`${owner}:${ref}:${revision}`, ns);
function denied(detail: string): never {
  throw managementProblem(
    "reactor.source_denied",
    "Current object is unavailable",
    detail,
    "conflict",
    "after-change",
  );
}
/** The adapter reads a body only for a chosen read action; all other directories are metadata. */
export interface SubjectSituationOptions {
  persistence: PersistenceService;
  settings: () => Promise<ProductSettings>;
  resolveActivity: (
    candidate: SubjectAttentionCandidate,
  ) => Promise<import("@heptalogos/subject").LifeActivity | undefined>;
  life: Pick<ReturnType<typeof createLifeService>, "get" | "worldNow" | "progressIn">;
  worlds: ReturnType<typeof createWorldLifeService>;
  profiles: Pick<ReturnType<typeof createWorldProfileService>, "read">;
  foreground: ReturnType<typeof createSubjectReactorService>;
  native: Pick<
    ReturnType<typeof createNativeCognitionBridge>,
    | "readyResults"
    | "hasAcceptedSource"
    | "readRun"
    | "readInputState"
    | "readAppliedContext"
    | "readResultRelease"
    | "readRoleResults"
    | "releaseResult"
  >;
  roles: Pick<ReturnType<typeof createSubjectRoles>, "startExecution">;
  decisions: Pick<
    ReturnType<typeof createSubjectDecisionHandler>,
    "express" | "startActivity"
  >;
  messaging: Pick<MessagingService, "resolveConversations" | "notices">;
  activities: Pick<ReturnType<typeof createActivityDispatcher>, "prepare">;
  nous: () => Promise<Pick<NousClient, "runtime">>;
  now: () => string;
}
/** Resolves only the current foreground's explicit owner actions. */
export function createSubjectSituationRuntime(options: SubjectSituationOptions) {
  const { readWorld, readInitialSetting } = createSubjectSourceContacts(options);
  const audienceFor = async (conversationRef: string) => {
    const qq = (await options.settings()).qq;
    for (const grant of qq?.conversations ?? []) {
      if (!grant.receive || !grant.observe) continue;
      const canonical = await options.messaging.resolveConversations({
        conversations: [
          {
            platform: "qq",
            accountId: qq!.accountId,
            kind: grant.kind,
            conversationId: grant.conversationId,
          },
        ],
      });
      if (
        canonical.conversationIds.some(
          (id) => "conversation:heptalogos:" + id === conversationRef,
        )
      )
        return {
          conversationRef,
          visibility: grant.kind === "group" ? "group" : "direct",
          channelRef: "heptalogos-qq",
        };
    }
    return undefined;
  };
  const activateActivity = async (
    reaction: SubjectReaction,
    candidate: SubjectAttentionCandidate,
    actionId: string,
  ) => {
    const target = await options.resolveActivity(candidate);
    if (!target) denied("The currently permitted audience Activity is unavailable");
    if (target.activityId === reaction.activityId) return target;
    const world = await options.life.worldNow(reaction.subjectId);
    await options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (tx) => {
        await options.foreground.assertCurrentIn(
          tx,
          reaction.subjectId,
          reaction.activityId,
          reaction,
        );
        const current = await options.life.get(
          reaction.subjectId,
          target.activityId,
          tx,
        );
        if (!current || current.state !== "active")
          denied("The actual target Activity changed");
        await options.life.progressIn(
          tx,
          {
            subjectId: reaction.subjectId,
            activityId: current.activityId,
            expectedRevision: current.revision,
            progress: {
              ...current.progress,
              resultRefs: [
                ...new Set([
                  ...current.progress.resultRefs,
                  "subject-open:" + actionId,
                ]),
              ].slice(-128),
            },
            nextOpportunity: world,
          },
          world,
        );
      }),
    );
    return target;
  };
  const activateConversation = async (
    reaction: SubjectReaction,
    conversationRef: string,
    actionId: string,
  ) => {
    const candidate: SubjectAttentionCandidate = {
      subjectId: reaction.subjectId,
      candidateRef: "subject-open:" + actionId,
      sourceOwner: "life",
      sourceKey: "conversation:" + conversationRef,
      sourceRef: conversationRef,
      sourceRevision: actionId,
      kind: "explicit_subject_intent",
      priorityClass: "direct",
      availableAt: options.now(),
      related: true,
      metadata: { label: "主动打开已获准的会话", conversationRef },
    };
    return activateActivity(reaction, candidate, actionId);
  };
  const prepare = async (input: {
    reaction: SubjectReaction;
    candidates: readonly SubjectAttentionCandidate[];
    lastAction?: ReactorActionReceipt;
  }): Promise<ReactorPreparedView> => {
    const { reaction } = input;
    const activity = await options.life.get(reaction.subjectId, reaction.activityId);
    if (!activity?.scope || !activity.workContextId)
      denied("The actual adopted Activity and WorkContext are unavailable");
    const world = await options.life.worldNow(reaction.subjectId),
      settings = await options.settings();
    const living = settings.subject.worldId
      ? await options.worlds.readLivingState({
          subjectId: reaction.subjectId,
          worldId: settings.subject.worldId,
        })
      : undefined;
    const bindings = [
      ...new Map(
        [reaction.candidate, ...input.candidates].map((value) => [
          value.candidateRef + ":" + value.sourceRevision,
          value,
        ]),
      ).values(),
    ];
    const objects: SituationObject[] = [];
    for (const candidate of bindings) {
      if (candidate.subjectId !== reaction.subjectId)
        denied("A foreign Subject entered the object directory");
      if (candidate.sourceOwner === "cognition") continue;
      objects.push({
        handle: handle(
          candidate.sourceOwner,
          candidate.sourceRef,
          candidate.sourceRevision,
        ),
        owner: candidate.sourceOwner,
        kind:
          candidate.kind === "activity_result"
            ? "task"
            : candidate.kind === "world_event"
              ? "world_event"
              : candidate.kind === "world_entry"
                ? "world_entry"
                : candidate.kind === "message"
                  ? "notification"
                  : "activity",
        sourceRef: candidate.sourceRef,
        sourceRevision: candidate.sourceRevision,
        label: candidate.metadata.label,
        state:
          candidate.kind === "activity_result"
            ? "ready"
            : candidate.kind === "message" ||
                candidate.kind === "world_event" ||
                candidate.kind === "world_entry"
              ? "unread"
              : "available",
        actions:
          candidate.activityId && candidate.activityId !== reaction.activityId
            ? ["inspect", "continue"]
            : candidate.kind === "activity_result" ||
                candidate.kind === "world_event" ||
                candidate.kind === "world_entry"
              ? ["inspect", "read"]
              : candidate.kind === "message"
                ? ["inspect", "open", "read"]
                : ["inspect", "continue", "wait", "rest", "search"],
      });
    }
    if (settings.subject.worldId && living) {
      const state = await options.worlds.read(
        reaction.subjectId,
        settings.subject.worldId,
      );
      if (state && state.definition.timeDomainRef === world.timeDomainRef) {
        const calendar = await options.worlds.readCalendar({
          subjectId: reaction.subjectId,
          worldId: settings.subject.worldId,
          interval: {
            timeDomainRef: world.timeDomainRef,
            start: world.at,
            end: new Date(Date.parse(world.at) + 24 * 3600000).toISOString(),
          },
          view: "planned",
          perspective: "subject",
          displayTimezone: state.definition.timezone,
          actorRef: activity.adoptedBy!,
          limit: 32,
        });
        const places = new Set([living.currentPlaceRef]);
        for (const item of calendar.items)
          if (item.planned) {
            places.add(item.planned.placeRef);
            objects.push({
              handle: handle(
                "world",
                item.planned.scheduleId,
                String(calendar.revision),
              ),
              owner: "world",
              kind: "schedule",
              sourceRef: `world-schedule:${settings.subject.worldId}:${item.planned.scheduleId}`,
              sourceRevision: String(calendar.revision),
              label: item.planned.title,
              state: "available",
              actions: [
                "inspect",
                "participate",
                ...(item.planned.ruleRef ? ["adjust_plan" as const] : []),
              ],
            });
          }
        for (const ref of places)
          objects.push({
            handle: handle("world", ref, "place"),
            owner: "world",
            kind: "place",
            sourceRef: ref,
            sourceRevision: "place",
            label: ref,
            state: "available",
            actions: ["inspect", "move"],
          });
      }
    }
    // Conversations are granted interaction objects. Their directory contains no message previews.
    for (const grant of activity.scope.conversations.filter((g) =>
      g.operations.includes("observe"),
    ))
      objects.push({
        handle: handle("messaging", grant.conversationRef, "directory"),
        owner: "messaging",
        kind: "conversation",
        sourceRef: grant.conversationRef,
        sourceRevision: "directory",
        label: grant.conversationRef,
        state: "available",
        actions: ["inspect", "open", "communicate"],
      });
    objects.unshift({
      handle: handle("life", activity.activityId, String(activity.revision)),
      owner: "life",
      kind: "activity",
      sourceRef: "activity:" + activity.activityId,
      sourceRevision: String(activity.revision),
      label: activity.purpose,
      state: "available",
      actions: ["inspect", "continue", "search", "wait", "rest"],
    });
    const device = living?.device.view;
    const currentRef =
      device?.kind === "conversation"
        ? device.conversationRef
        : device?.kind === "page"
          ? device.materialRef
          : input.lastAction?.resultRefs.find(
              (ref) =>
                ref.startsWith("role-result-release:") ||
                ref.startsWith("world-event:") ||
                ref.startsWith("conversation:heptalogos:"),
            );
    const current = objects.find((value) => value.sourceRef === currentRef);
    const actualWork = (
      await (
        await options.nous()
      ).runtime.getWorkContext(
        { subjectId: reaction.subjectId, workContextId: activity.workContextId },
        { timeoutMs: 5000 },
      )
    ).workContext;
    if (
      !actualWork ||
      actualWork.subjectId !== reaction.subjectId ||
      actualWork.workContextId !== activity.workContextId ||
      actualWork.state !== "open"
    )
      denied("The actual WorkContext changed");
    const boundAudience = actualWork.constraints?.audience_ref;
    const conversation =
      typeof boundAudience === "string" &&
      boundAudience !== "internal" &&
      activity.scope.conversations.length === 1 &&
      activity.scope.conversations[0]!.conversationRef === boundAudience
        ? boundAudience
        : undefined;
    const frame: SituationFrame = {
      subjectId: reaction.subjectId,
      activityId: reaction.activityId,
      reactionId: reaction.reactionId,
      focusRevision: reaction.focusRevision,
      frameRef:
        "situation:" +
        decisionPhaseId(reaction.reactionId, "frame:" + reaction.stepCount),
      world,
      ...(living ? { locationRef: living.currentPlaceRef, energy: living.energy } : {}),
      currentActivityRefs: living?.currentActivityRefs ?? [
        "activity:" + activity.activityId,
      ],
      ...(current ? { currentHandle: current.handle } : {}),
      objects: objects.slice(0, 128),
      remainingSteps: Math.max(
        0,
        reaction.policy.maxInteractionSteps - reaction.stepCount,
      ),
      deadlineAt: reaction.deadlineAt,
      ...(objects.length > 128
        ? {
            limitation:
              "Current object directory is bounded; further owner pages remain unopened",
          }
        : {}),
    };
    const audience = conversation ? await audienceFor(conversation) : undefined;
    const view: ReactorPreparedView = {
      frame,
      candidates: bindings,
      contacts: [],
      sourceRefs: activity.scope.sourceRefs.filter(
        (ref) => !ref.startsWith("message:"),
      ),
      usage: encodeCognitionUsage({
        agentInstanceId: reaction.reactionId,
        purpose: "subject_deliberation",
        intent: activity.purpose,
        audience: audience ?? { visibility: "internal" },
        participants: [],
        ...(settings.subject.worldId ? { worldId: settings.subject.worldId } : {}),
        sourceRead: {
          subjectId: reaction.subjectId,
          sourceRefs: [{ kind: "work_context", value: activity.workContextId }],
          originConversationRefs: conversation ? [conversation] : [],
        },
      }),
      context: {
        situation: frame,
        ...(settings.subject.worldId
          ? {
              pendingWorldActions: await options.worlds.readPendingActions(
                reaction.subjectId,
                settings.subject.worldId,
                32,
              ),
            }
          : {}),
      },
    };
    if (
      input.lastAction?.action.action === "read" &&
      input.lastAction.state === "completed"
    ) {
      const runId = decisionPhaseId(
        reaction.reactionId,
        "deliberation:" + reaction.stepCount,
      );
      const original = await options.native.readInputState(reaction.subjectId, runId);
      if (original)
        return {
          ...view,
          contacts: original.registration.contacts,
          sourceRefs: original.registration.sourceRefs,
          messageRefs: original.registration.messageRefs,
          usage: original.registration.usage,
          context: {
            ...view.context,
            actualContacts: original.registration.contacts.map((value) => ({
              contactRef: value.contactRef,
              material: encodeObservationInput({
                material: decodeObservationInput(value.observation).material,
              }),
            })),
          },
        };
      const releaseRef = input.lastAction.resultRefs.find((value) =>
        value.startsWith("role-result-release:"),
      );
      if (releaseRef) {
        const release = await options.native.readResultRelease(
          reaction.subjectId,
          releaseRef.slice("role-result-release:".length),
        );
        if (!release)
          denied("The exact previously selected result release is unavailable");
        return {
          ...view,
          contacts: release.contacts,
          sourceRefs: release.contacts.map((value) => value.contactRef),
          context: {
            ...view.context,
            receivedResults: release.contacts.map((value) => ({
              contactRef: value.contactRef,
              material: encodeObservationInput({
                material: decodeObservationInput(value.observation).material,
              }),
            })),
          },
        };
      }
      const settingRef = input.lastAction.resultRefs.find((value) =>
        value.startsWith("world-profile:"),
      );
      if (settingRef) {
        const read = await readInitialSetting(reaction, settingRef, runId);
        return {
          ...view,
          contacts: read.contacts,
          sourceRefs: [...new Set([...view.sourceRefs, settingRef])],
          context: { ...view.context, ...read.context },
        };
      }
      const eventRef = input.lastAction.resultRefs.find((value) =>
        value.startsWith("world-event:"),
      );
      if (eventRef) {
        const read = await readWorld(
          reaction,
          {
            handle: input.lastAction.action.target!,
            owner: "world",
            kind: "world_event",
            sourceRef: eventRef,
            sourceRevision: eventRef,
            label: "Previously selected world event",
            state: "unread",
            actions: ["read"],
          },
          runId,
        );
        return {
          ...view,
          contacts: read.contacts,
          sourceRefs: [...new Set([...view.sourceRefs, eventRef])],
          context: { ...view.context, ...read.context },
        };
      }
      const refs = input.lastAction.resultRefs.flatMap((value) =>
        value.startsWith("message:") ? [value.slice(8)] : [],
      );
      if (refs.length && conversation) {
        const read = await options.activities.prepare({
          requestId: runId,
          subjectId: reaction.subjectId,
          activityId: reaction.activityId,
          conversationRef: conversation,
          messageRefs: refs,
        });
        return {
          ...view,
          contacts: read.contacts,
          sourceRefs: read.sourceRefs,
          messageRefs: read.messageRefs,
          usage: read.usage,
          context: { ...view.context, ...read.context },
        };
      }
    }
    return view;
  };
  const adoptView = async (
    reaction: SubjectReaction,
    actionId: string,
    view: Parameters<typeof options.worlds.adoptDeviceView>[0]["view"],
  ) => {
    const worldId = (await options.settings()).subject.worldId;
    if (!worldId) return;
    const living = await options.worlds.readLivingState({
      subjectId: reaction.subjectId,
      worldId,
    });
    if (!living) return;
    await options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (tx) => {
        await options.foreground.assertCurrentIn(
          tx,
          reaction.subjectId,
          reaction.activityId,
          reaction,
        );
        await options.worlds.adoptDeviceViewIn(tx, {
          subjectId: reaction.subjectId,
          worldId,
          operationId: decisionPhaseId(actionId, "device"),
          expectedRevision: living.device.revision,
          view,
        });
      }),
    );
  };

  return {
    prepare,
    async saveContinuation(input: {
      reaction: SubjectReaction;
      reason: string;
      lastAction?: ReactorActionReceipt;
    }) {
      const activity = await options.life.get(
        input.reaction.subjectId,
        input.reaction.activityId,
      );
      if (!activity?.scope) denied("The actual continuation Activity is unavailable");
      const continuation = `Reactor ${input.reaction.reactionId}: ${input.reason}; action ${input.lastAction?.actionId ?? "none"}`;
      const joined = [activity.progress.note, continuation].filter(Boolean).join("\n");
      const progress = {
        ...activity.progress,
        note: joined.length <= 8192 ? joined : activity.progress.note,
        resultRefs: [
          ...new Set([
            ...activity.progress.resultRefs,
            ...(input.lastAction?.resultRefs ?? []),
          ]),
        ].slice(-128),
      };
      const world = await options.life.worldNow(input.reaction.subjectId);
      const saved = await options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (tx) => {
          await options.foreground.assertCurrentIn(
            tx,
            input.reaction.subjectId,
            input.reaction.activityId,
            input.reaction,
            false,
          );
          return options.life.progressIn(
            tx,
            {
              subjectId: activity.subjectId,
              activityId: activity.activityId,
              expectedRevision: activity.revision,
              progress,
              nextOpportunity: activity.nextOpportunity,
              mode: activity.mode,
            },
            world,
          );
        }),
      );
      return `activity:${saved.activityId}:revision:${saved.revision}`;
    },
    async act(input: {
      reaction: SubjectReaction;
      frame: SituationFrame;
      object?: SituationObject;
      adopted: DecisionCommit;
      sourceRunId: string;
      view: ReactorPreparedView;
      actionId: string;
    }): Promise<ReactorActionOutcome> {
      const { reaction, object, adopted, actionId } = input,
        action = adopted.decision.action;
      const continuationRef = "subject-decision:" + adopted.decisionId;
      const result = (
        state: ReactorActionOutcome["state"],
        refs: readonly string[],
        extra: Partial<ReactorActionOutcome> = {},
      ): ReactorActionOutcome => ({
        state,
        resultRefs: refs,
        continuationRef,
        ...extra,
      });
      if (action === "inspect") {
        await adoptView(reaction, actionId, { kind: "notifications" });
        const settings = await options.settings(),
          policy = effectiveReactorPolicy(settings);
        const activity = await options.life.get(
          reaction.subjectId,
          reaction.activityId,
        );
        const additional: SubjectAttentionCandidate[] = [];
        if (settings.qq && activity?.scope) {
          const notices = await options.messaging.notices({
            selfAccountId: settings.qq.accountId,
            perConversationLimit: policy.messageBatchLimit,
            conversations: activity.scope.conversations
              .filter((value) => value.operations.includes("observe"))
              .map((value) => ({
                conversationId: value.conversationRef.slice(
                  "conversation:heptalogos:".length,
                ),
              })),
          });
          for (const notice of notices.notices)
            additional.push({
              subjectId: reaction.subjectId,
              activityId: reaction.activityId,
              candidateRef: "inspect-notice:" + notice.pendingRef,
              sourceOwner: "messaging",
              sourceKey: "messaging:" + notice.conversationId,
              sourceRef: "message:" + notice.messageRef,
              sourceRevision: notice.sequence,
              sourcePosition: notice.sequence,
              kind: "message",
              priorityClass:
                notice.direct || notice.mention || notice.reply
                  ? "direct"
                  : "background",
              availableAt: notice.receivedAt,
              related: true,
              metadata: {
                label: notice.direct ? "未读私聊消息" : "未读群聊消息",
                conversationRef: "conversation:heptalogos:" + notice.conversationId,
                messageRefs: [notice.messageRef],
                unreadCount: notice.unreadCount,
                direct: notice.direct,
                mention: notice.mention,
                reply: notice.reply,
              },
            });
        }
        const ready = await options.native.readyResults({
          subjectId: reaction.subjectId,
          limit: Math.min(128, policy.candidateLimit),
        });
        for (const task of ready.runs)
          additional.push({
            subjectId: reaction.subjectId,
            activityId: task.activityId,
            candidateRef: "inspect-task:" + task.runId,
            sourceOwner: "role_result",
            sourceKey: "role-results",
            sourceRef: "role-run:" + task.runId,
            sourceRevision: task.terminalAt,
            kind: "activity_result",
            priorityClass: "background",
            availableAt: task.terminalAt,
            related: task.activityId === reaction.activityId,
            metadata: { label: "已委派工作有结果可查看" },
          });
        const updated = (await options.foreground.current(reaction.subjectId))!;
        const view = await prepare({
          reaction: updated,
          candidates: [...input.view.candidates, ...additional],
        });
        return result("completed", [view.frame.frameRef], { view });
      }
      if (action === "open") {
        if (object?.owner !== "messaging")
          denied("Choose an actual conversation or notification");
        const candidate = input.frame.objects.find(
          (value) => value.handle === object.handle,
        );
        const conversation =
          object.kind === "conversation"
            ? object.sourceRef
            : input.view.candidates.find(
                (value) =>
                  value.sourceRef === object.sourceRef &&
                  value.sourceRevision === object.sourceRevision,
              )?.metadata.conversationRef;
        if (!candidate || !conversation)
          denied("Open the actual notification's canonical conversation");
        await adoptView(reaction, actionId, {
          kind: "conversation",
          conversationRef: conversation,
        });
        const target = await activateConversation(reaction, conversation, actionId);
        return result("completed", [conversation, "activity:" + target.activityId], {
          yield: target.activityId !== reaction.activityId,
        });
      }
      if (action === "read") {
        if (!object) denied("Choose an actual unread object");
        const nextRunId = decisionPhaseId(
          reaction.reactionId,
          "deliberation:" + (reaction.stepCount + 1),
        );
        if (object.owner === "messaging") {
          const candidate = input.view.candidates.find(
            (value) =>
              value.sourceRef === object.sourceRef &&
              value.sourceRevision === object.sourceRevision,
          );
          if (
            !candidate?.metadata.conversationRef ||
            !candidate.metadata.messageRefs?.length
          )
            denied("Choose the exact bounded current notification batch");
          const audience = decodeCognitionUsage(input.view.usage).audience
            ?.conversationRef;
          const currentActivity = await options.life.get(
            reaction.subjectId,
            reaction.activityId,
          );
          if (
            audience !== candidate.metadata.conversationRef ||
            currentActivity?.scope?.conversations.length !== 1
          ) {
            await adoptView(reaction, actionId, {
              kind: "conversation",
              conversationRef: candidate.metadata.conversationRef,
            });
            const target = await activateConversation(
              reaction,
              candidate.metadata.conversationRef,
              actionId,
            );
            return result(
              "pending",
              ["activity:" + target.activityId, candidate.sourceRef],
              { yield: true },
            );
          }
          const prepared = await options.activities.prepare({
            requestId: nextRunId,
            subjectId: reaction.subjectId,
            activityId: reaction.activityId,
            conversationRef: candidate.metadata.conversationRef,
            messageRefs: candidate.metadata.messageRefs,
          });
          await adoptView(reaction, actionId, {
            kind: "conversation",
            conversationRef: candidate.metadata.conversationRef,
          });
          return result("completed", prepared.sourceRefs, {
            view: {
              ...input.view,
              contacts: prepared.contacts,
              sourceRefs: prepared.sourceRefs,
              messageRefs: prepared.messageRefs,
              usage: prepared.usage,
              context: prepared.context,
            },
          });
        }
        if (object.owner === "world") {
          const read =
            object.kind === "world_entry"
              ? await readInitialSetting(reaction, object.sourceRef, nextRunId)
              : await readWorld(reaction, object, nextRunId);
          await adoptView(reaction, actionId, {
            kind: "page",
            materialRef: object.sourceRef,
          });
          return result("completed", [object.sourceRef], {
            view: {
              ...input.view,
              contacts: read.contacts,
              sourceRefs: [...new Set([...input.view.sourceRefs, object.sourceRef])],
              context: read.context,
            },
          });
        }
        if (object.owner === "role_result") {
          const childRunId = object.sourceRef.replace(/^role-run:/, "");
          const child = await options.native.readRun(childRunId);
          if (
            !child ||
            child.registration.subjectId !== reaction.subjectId ||
            child.registration.activityId !== reaction.activityId ||
            !child.registration.parentRunId
          )
            denied("Use the exact adopted professional task within this Activity");
          const releaseId = decisionPhaseId(childRunId, "explicit-view");
          const previous = await options.native.readResultRelease(
            reaction.subjectId,
            releaseId,
          );
          const retained: NativeRoleResults | undefined = previous
            ? undefined
            : await options.native.readRoleResults(reaction.subjectId, childRunId);
          const generated = retained?.results.filter(
            (value) =>
              decodeObservationInput(value.observation).sourceClass === "generated",
          );
          const release =
            previous ??
            (await options.native.releaseResult({
              version: 1,
              requestId: releaseId,
              subjectId: reaction.subjectId,
              parentRunId: child.registration.parentRunId,
              childRunId,
              resultIds: (generated?.length ? generated : retained!.results).map(
                (value) => value.resultId,
              ),
            }));
          await adoptView(reaction, actionId, {
            kind: "page",
            materialRef: release.contacts[0]!.contactRef,
          });
          return result(
            "completed",
            release.contacts.map((value) => value.contactRef),
            {
              view: {
                ...input.view,
                contacts: release.contacts,
                sourceRefs: release.contacts.map((value) => value.contactRef),
                context: {
                  trigger: { kind: "activity_result" },
                  receivedResults: release.contacts.map((value) => ({
                    contactRef: value.contactRef,
                    material: encodeObservationInput({
                      material: decodeObservationInput(value.observation).material,
                    }),
                  })),
                },
              },
            },
          );
        }
        return result("unavailable", [], { yield: true });
      }
      if (action === "search") {
        const task = adopted.decision.delegation;
        if (!task)
          denied(
            "A professional search requires its adopted bounded goal, tools and exact sources",
          );
        const applied = await options.native.readAppliedContext(input.sourceRunId);
        const execution = await options.roles.startExecution({
          requestId: decisionPhaseId(adopted.decisionId, "execution"),
          requestDigest: digestCanonicalJson("reactor.task.v1", {
            decisionRef: adopted.decisionRef,
          }).hex,
          subjectId: reaction.subjectId,
          activityId: reaction.activityId,
          parentRunId: input.sourceRunId,
          adoptedDecisionRef: adopted.decisionRef,
          role: "subject.execution",
          taskTools: task.tools,
          context: {
            adoptedDecisionRef: adopted.decisionRef,
            task: task.goal,
            sourceRefs: task.sourceRefs,
            permittedTools: task.tools,
          },
          contacts: [],
          sourceRefs: task.sourceRefs,
          usage: applied.usage,
        });
        return result("pending", ["role-run:" + execution.runId], { yield: true });
      }
      if (action === "communicate") {
        const expression = await options.decisions.express({
          subjectId: reaction.subjectId,
          activityId: reaction.activityId,
          adopted,
          run: { runId: input.sourceRunId, deadlineAt: reaction.deadlineAt },
        });
        return expression.expression.state === "rendered"
          ? result("completed", ["role-run:" + expression.expression.runId], {
              yield: true,
            })
          : result("rejected", [adopted.decisionRef], { yield: true });
      }
      if (action === "continue") {
        if (adopted.decision.newActivity) {
          const started = await options.decisions.startActivity(adopted, {
            deadlineAt: reaction.deadlineAt,
          });
          return result("completed", ["activity:" + started.activityId], {
            yield: true,
          });
        }
        if (object && object.sourceRef !== "activity:" + reaction.activityId) {
          const candidate = input.view.candidates.find(
            (value) =>
              value.sourceRef === object.sourceRef &&
              value.sourceRevision === object.sourceRevision,
          );
          if (!candidate?.activityId || candidate.activityId === reaction.activityId)
            denied("Choose an actual current Activity directory entry");
          const target = await activateActivity(reaction, candidate, actionId);
          return result("completed", ["activity:" + target.activityId], {
            yield: true,
          });
        }
        return result("completed", ["activity:" + reaction.activityId], {
          yield: true,
        });
      }
      if (action === "wait") {
        await adoptView(reaction, actionId, { kind: "stowed" });
        return result("completed", [adopted.decisionRef], { yield: true });
      }
      if (action === "rest") {
        await adoptView(reaction, actionId, { kind: "stowed" });
        const worldId = (await options.settings()).subject.worldId;
        if (
          !worldId ||
          !(await options.worlds.readLivingState({
            subjectId: reaction.subjectId,
            worldId,
          }))
        )
          return result("completed", [adopted.decisionRef], { yield: true });
        const actual = await options.worlds.adoptAction(
          {
            operationId: actionId,
            subjectId: reaction.subjectId,
            worldId,
            sourceReactionRef: `reaction:${reaction.reactionId}:${reaction.focusRevision}`,
            action: { kind: "rest" },
          },
          (tx) =>
            options.foreground
              .assertCurrentIn(tx, reaction.subjectId, reaction.activityId, reaction)
              .then(() => {}),
        );
        return result(
          actual.status === "pending"
            ? "pending"
            : actual.status === "completed"
              ? "completed"
              : actual.status === "rejected"
                ? "rejected"
                : "unavailable",
          [actual.actionRef, ...actual.eventRefs],
          { yield: true },
        );
      }
      if (!object || object.owner !== "world")
        denied("Choose an actual permitted world object");
      const worldId = (await options.settings()).subject.worldId;
      if (!worldId) return result("unavailable", [], { yield: true });
      const assertReactionIn = (
        tx: Parameters<typeof options.foreground.assertCurrentIn>[0],
      ) =>
        options.foreground
          .assertCurrentIn(tx, reaction.subjectId, reaction.activityId, reaction)
          .then(() => {});
      if (action === "adjust_plan") {
        const change = adopted.decision.calendarChange;
        const state = await options.worlds.read(reaction.subjectId, worldId);
        if (
          !change ||
          !state ||
          object.kind !== "schedule" ||
          state.revision !== Number(object.sourceRevision)
        )
          return result("rejected", [], { yield: true });
        const point = await options.life.worldNow(reaction.subjectId);
        const calendar = await options.worlds.readCalendar({
          subjectId: reaction.subjectId,
          worldId,
          interval: {
            timeDomainRef: point.timeDomainRef,
            start: point.at,
            end: new Date(Date.parse(point.at) + 24 * 3600000).toISOString(),
          },
          view: "planned",
          perspective: "subject",
          displayTimezone: state.definition.timezone,
          limit: 32,
        });
        const schedule = calendar.items.find(
          (value) =>
            `world-schedule:${worldId}:${value.instanceId}` === object.sourceRef,
        )?.planned;
        if (!schedule?.ruleRef) return result("rejected", [], { yield: true });
        const changed = await options.worlds.changeCalendar(
          {
            operationId: actionId,
            subjectId: reaction.subjectId,
            worldId,
            expectedRevision: state.revision,
            ruleId: schedule.ruleRef.ruleId,
            recurrenceId: schedule.ruleRef.recurrenceId,
            ...change,
            reason: adopted.decision.reason,
          },
          { actorMode: "subject", assertCurrentIn: assertReactionIn },
        );
        return result("completed", [`world:${worldId}:revision:${changed.revision}`], {
          yield: true,
        });
      }
      const scheduleId =
        object.kind === "schedule"
          ? object.sourceRef.slice(`world-schedule:${worldId}:`.length)
          : undefined;
      if (action !== "move" && action !== "participate")
        return result("rejected", [], { yield: true });
      if (
        (action === "move" && object.kind !== "place") ||
        (action === "participate" && !scheduleId)
      )
        return result("rejected", [], { yield: true });
      const actual = await options.worlds.adoptAction(
        {
          operationId: actionId,
          subjectId: reaction.subjectId,
          worldId,
          sourceReactionRef: `reaction:${reaction.reactionId}:${reaction.focusRevision}`,
          action:
            action === "move"
              ? { kind: "move", placeRef: object.sourceRef }
              : { kind: "participate", scheduleId: scheduleId! },
        },
        assertReactionIn,
      );
      return result(
        actual.status === "completed"
          ? "completed"
          : actual.status === "pending"
            ? "pending"
            : actual.status === "rejected"
              ? "rejected"
              : "unavailable",
        [actual.actionRef, ...actual.eventRefs],
        { yield: true },
      );
    },
  };
}
