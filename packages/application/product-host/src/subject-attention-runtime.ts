// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Collects notification metadata from actual product owners for the single Subject selector.
 * @module subject-attention-runtime
 */
import { digestCanonicalJson } from "@heptalogos/foundation-contracts";
import type { PersistenceService } from "@heptalogos/persistence";
import {
  effectiveReactorPolicy,
  managementProblem,
  type ProductSettings,
} from "@heptalogos/management";
import {
  createSubjectAttentionService,
  type createLifeService,
  type createWorldLifeService,
  type createWorldProfileService,
  type createNarrativeService,
  type SubjectAttentionCandidate,
} from "@heptalogos/subject";
import type { MessagingService } from "@heptalogos/messaging";
import type { createNativeCognitionBridge } from "./native-cognition.js";
/** Collection reads metadata only; content and experience remain behind explicit actions. */
export function createSubjectAttentionRuntime(options: {
  persistence: PersistenceService;
  settings: () => Promise<ProductSettings>;
  life: Pick<ReturnType<typeof createLifeService>, "get" | "schedule" | "worldNow">;
  worlds: Pick<
    ReturnType<typeof createWorldLifeService>,
    "pendingContacts" | "prepareAdvance"
  >;
  profiles: Pick<ReturnType<typeof createWorldProfileService>, "entryNotice">;
  narrative: Pick<ReturnType<typeof createNarrativeService>, "pendingCommitments">;
  native: Pick<
    ReturnType<typeof createNativeCognitionBridge>,
    "readyResults" | "hasAcceptedSource"
  >;
  messaging: Pick<MessagingService, "resolveConversations" | "notices">;
  now: () => string;
}) {
  return createSubjectAttentionService({
    persistence: options.persistence,
    now: options.now,
    policy: async () => effectiveReactorPolicy(await options.settings()),
    candidates: async (input) => {
      const settings = await options.settings();
      if (settings.subject.id !== input.subjectId || !settings.subject.enabled)
        return { candidates: [], more: false };
      const manualActivity = input.manualActivityId
        ? await options.life.get(input.subjectId, input.manualActivityId)
        : undefined;
      if (
        input.manualActivityId &&
        (!manualActivity ||
          manualActivity.subjectId !== input.subjectId ||
          manualActivity.state !== "active" ||
          manualActivity.continuationRequired ||
          !manualActivity.adoptedBy ||
          !manualActivity.adoptedAt ||
          !manualActivity.scope ||
          !manualActivity.workContextId)
      )
        throw managementProblem(
          "reactor.activity_unavailable",
          "The requested task cannot receive attention",
          "Resume the existing adopted Activity under its current scope",
          "conflict",
          "after-change",
        );
      const progress = new Map(
        input.positions.map((position) => [position.sourceKey, position]),
      );
      const activities = manualActivity ? [manualActivity] : [];
      let afterId: string | undefined;
      if (!manualActivity)
        do {
          const page = await options.life.schedule({
            subjectId: input.subjectId,
            states: ["active"],
            limit: 128,
            ...(afterId ? { afterId } : {}),
          });
          activities.push(...page.activities);
          afterId = page.nextId ?? undefined;
        } while (afterId);
      const candidates: SubjectAttentionCandidate[] = [];
      if (!activities.length) {
        const revision = digestCanonicalJson("subject.enabled-life.v1", {
          subject: settings.subject,
          reactor: settings.reactor ?? null,
        }).hex;
        candidates.push({
          subjectId: input.subjectId,
          candidateRef: "subject-life:" + input.subjectId + ":" + revision,
          sourceOwner: "life",
          sourceKey: "subject-life",
          sourceRef: "subject-policy:" + input.subjectId,
          sourceRevision: revision,
          kind: "schedule",
          ...(settings.subject.worldId ? { worldId: settings.subject.worldId } : {}),
          priorityClass: "background",
          availableAt: options.now(),
          related: true,
          metadata: { label: "已启用主体，可开始安排自己的生活" },
        });
      }
      const world = await options.life.worldNow(input.subjectId);
      const current = settings.subject.worldId
        ? await options.worlds.prepareAdvance(input.subjectId, settings.subject.worldId)
        : undefined;
      const policy = current?.currentPolicy;
      if (
        manualActivity &&
        policy &&
        current?.state.schedule.find((item) => item.scheduleId === policy.scheduleId)
          ?.activityId !== manualActivity.activityId &&
        (!policy.policy.interruptEvents.includes("important") ||
          policy.nextInterruptAt.timeDomainRef !== world.timeDomainRef ||
          Date.parse(world.at) < Date.parse(policy.nextInterruptAt.at))
      )
        return { candidates: [], more: false };
      if (manualActivity)
        candidates.push({
          subjectId: input.subjectId,
          candidateRef: `manual-activity:${manualActivity.activityId}:${manualActivity.revision}`,
          sourceOwner: "life",
          sourceKey: "life:" + manualActivity.activityId,
          sourceRef: "activity:" + manualActivity.activityId,
          sourceRevision: String(manualActivity.revision),
          kind: "explicit_subject_intent",
          activityId: manualActivity.activityId,
          priorityClass: "important",
          availableAt: manualActivity.updatedAt,
          related: true,
          metadata: { label: ("恢复原任务：" + manualActivity.purpose).slice(0, 1024) },
        });
      const socialAllowed =
        !policy ||
        (policy.policy.interruptEvents.includes("social") &&
          policy.nextInterruptAt.timeDomainRef === world.timeDomainRef &&
          Date.parse(world.at) >= Date.parse(policy.nextInterruptAt.at));
      const qq = settings.qq;
      if (!manualActivity && qq && socialAllowed) {
        const canonical = await options.messaging.resolveConversations({
          conversations: qq.conversations
            .filter((grant) => grant.receive && grant.observe)
            .map((grant) => ({
              platform: "qq",
              accountId: qq.accountId,
              kind: grant.kind,
              conversationId: grant.conversationId,
            })),
        });
        const notices = await options.messaging.notices({
          selfAccountId: qq.accountId,
          perConversationLimit: Math.min(
            64,
            input.perSourceLimit * input.messageBatchLimit,
          ),
          conversations: canonical.conversationIds.map((conversationId) => {
            const position = progress.get(
              "messaging:" + conversationId,
            )?.sourcePosition;
            return {
              conversationId,
              ...(position && /^[0-9]+$/.test(position)
                ? { afterSequence: position }
                : {}),
            };
          }),
        });
        if (input.naturalOpportunity) {
          const emptySources = canonical.conversationIds.filter(
            (conversationId) =>
              progress.get("messaging:" + conversationId)?.sourcePosition &&
              !notices.notices.some(
                (notice) => notice.conversationId === conversationId,
              ),
          );
          if (emptySources.length)
            notices.notices.push(
              ...(
                await options.messaging.notices({
                  selfAccountId: qq.accountId,
                  perConversationLimit: Math.min(
                    64,
                    input.perSourceLimit * input.messageBatchLimit,
                  ),
                  conversations: emptySources.map((conversationId) => ({
                    conversationId,
                  })),
                })
              ).notices,
            );
        }
        const groups = new Map<string, typeof notices.notices>();
        for (const notice of notices.notices) {
          const batch = groups.get(notice.conversationId) ?? [];
          batch.push(notice);
          groups.set(notice.conversationId, batch);
        }
        for (const [conversationId, notices] of groups) {
          const conversationRef = "conversation:heptalogos:" + conversationId;
          for (let i = 0; i < notices.length; i += input.messageBatchLimit) {
            const batch = notices.slice(i, i + input.messageBatchLimit),
              first = batch[0]!,
              last = batch.at(-1)!;
            const direct = batch.some((notice) => notice.direct),
              mention = batch.some((notice) => notice.mention),
              reply = batch.some((notice) => notice.reply);
            candidates.push({
              subjectId: input.subjectId,
              candidateRef: "notice:" + first.pendingRef,
              sourceOwner: "messaging",
              sourceKey: "messaging:" + conversationId,
              sourceRef: "message:" + first.messageRef,
              sourceRevision: digestCanonicalJson(
                "attention.message-batch.v1",
                batch.map((notice) => notice.messageRef),
              ).hex,
              sourcePosition: last.sequence,
              kind: "message",
              priorityClass: direct || mention || reply ? "direct" : "background",
              availableAt: first.receivedAt,
              related: false,
              metadata: {
                label: direct
                  ? "私聊有未读消息"
                  : mention
                    ? "群聊有人提及你"
                    : reply
                      ? "群聊有人回复你"
                      : "群聊有未读消息",
                conversationRef,
                messageRefs: batch.map((notice) => notice.messageRef),
                unreadCount: first.unreadCount,
                direct,
                mention,
                reply,
              },
            });
          }
        }
      }
      let ready = await options.native.readyResults({
        subjectId: input.subjectId,
        limit: manualActivity ? 128 : Math.min(128, input.perSourceLimit),
        ...(!manualActivity && progress.get("role-results")?.sourcePosition
          ? { afterRunId: progress.get("role-results")!.sourcePosition! }
          : {}),
      });
      if (
        !manualActivity &&
        input.naturalOpportunity &&
        !ready.runs.length &&
        progress.get("role-results")?.sourcePosition
      )
        ready = await options.native.readyResults({
          subjectId: input.subjectId,
          limit: Math.min(128, input.perSourceLimit),
        });
      if (manualActivity) {
        const runs = ready.runs.filter(
          (run) => run.activityId === manualActivity.activityId,
        );
        while (ready.more && ready.nextRunId && runs.length < input.perSourceLimit) {
          ready = await options.native.readyResults({
            subjectId: input.subjectId,
            limit: 128,
            afterRunId: ready.nextRunId,
          });
          runs.push(
            ...ready.runs.filter((run) => run.activityId === manualActivity.activityId),
          );
        }
        ready = {
          ...ready,
          runs: runs.slice(0, input.perSourceLimit),
          more: ready.more || runs.length > input.perSourceLimit,
        };
      }
      for (const run of ready.runs)
        candidates.push({
          subjectId: input.subjectId,
          candidateRef: "role-result:" + run.runId,
          sourceOwner: "role_result",
          sourceKey: "role-results",
          sourceRef: "role-run:" + run.runId,
          sourceRevision: run.runId + ":" + run.terminalAt,
          sourcePosition: run.runId,
          kind: "activity_result",
          activityId: run.activityId,
          priorityClass: "background",
          availableAt: run.terminalAt,
          related: activities.some(
            (activity) => activity.activityId === run.activityId,
          ),
          metadata: { label: "已委派的资料或工具工作有结果可查看" },
        });
      if (manualActivity) return { candidates, more: ready.more };
      // World due comparisons use its declared domain; no real-time substitution is permitted.
      const worldActivities = new Map<
        string,
        (typeof activities)[number] | undefined
      >();
      for (const activity of activities) {
        for (const ref of activity.scope?.sourceRefs ?? []) {
          const id = /^world:([0-9a-f-]{36})$/i.exec(ref)?.[1];
          if (id && !worldActivities.has(id)) worldActivities.set(id, activity);
        }
        const due = activity.nextOpportunity;
        if (
          due &&
          due.timeDomainRef === world.timeDomainRef &&
          Date.parse(due.at) <= Date.parse(world.at)
        )
          candidates.push({
            subjectId: input.subjectId,
            candidateRef:
              "activity-node:" +
              activity.activityId +
              ":" +
              digestCanonicalJson("attention.life-opportunity.v1", due).hex,
            sourceOwner: "life",
            sourceKey: "life:" + activity.activityId,
            sourceRef: "activity:" + activity.activityId,
            sourceRevision: digestCanonicalJson("attention.life-opportunity.v1", due)
              .hex,
            kind: "schedule",
            activityId: activity.activityId,
            priorityClass: "important",
            availableAt: activity.updatedAt,
            related: true,
            metadata: { label: "已采纳活动到达自然处理节点" },
          });
        for (const commitment of (
          await options.narrative.pendingCommitments(
            input.subjectId,
            activity.activityId,
          )
        ).commitments) {
          if (
            commitment.due.timeDomainRef !== world.timeDomainRef ||
            Date.parse(commitment.due.at) > Date.parse(world.at)
          )
            continue;
          candidates.push({
            subjectId: input.subjectId,
            candidateRef: "commitment:" + commitment.commitmentId,
            sourceOwner: "life",
            sourceKey: "commitments:" + activity.activityId,
            sourceRef: "commitment:" + commitment.commitmentId,
            sourceRevision: commitment.commitmentId,
            kind: "schedule",
            activityId: activity.activityId,
            priorityClass: "important",
            availableAt: activity.updatedAt,
            related: true,
            metadata: { label: "已承担的约定到达处理时刻" },
          });
        }
      }
      if (settings.subject.worldId && !worldActivities.has(settings.subject.worldId))
        worldActivities.set(settings.subject.worldId, undefined);
      for (const [worldId, activity] of worldActivities) {
        const entry = await options.profiles.entryNotice(input.subjectId, worldId);
        if (
          entry &&
          entry.timeDomainRef === world.timeDomainRef &&
          !(await options.native.hasAcceptedSource(
            input.subjectId,
            entry.entrySourceRef,
          ))
        )
          candidates.push({
            subjectId: input.subjectId,
            candidateRef: entry.entrySourceRef,
            sourceOwner: "world",
            sourceKey: "world-profile:" + worldId,
            sourceRef: entry.entrySourceRef,
            sourceRevision: entry.entrySourceRef,
            kind: "world_entry",
            ...(activity ? { activityId: activity.activityId } : {}),
            worldId,
            priorityClass: "important",
            availableAt: entry.entryRecordedAt,
            related: true,
            metadata: { label: "已采用的世界入场设定可查看" },
          });
        const key = "world:" + worldId,
          position = progress.get(key)?.sourcePosition;
        let events = await options.worlds.pendingContacts(
          input.subjectId,
          worldId,
          input.perSourceLimit,
          position,
        );
        if (input.naturalOpportunity && position && !events.length)
          events = await options.worlds.pendingContacts(
            input.subjectId,
            worldId,
            input.perSourceLimit,
          );
        for (const event of events) {
          if (event.interval.timeDomainRef !== world.timeDomainRef) continue;
          candidates.push({
            subjectId: input.subjectId,
            candidateRef: event.sourceRef,
            sourceOwner: "world",
            sourceKey: key,
            sourceRef: event.sourceRef,
            sourceRevision: event.sourceRef,
            sourcePosition: event.eventId,
            kind: "world_event",
            ...(activity ? { activityId: activity.activityId } : {}),
            worldId,
            priorityClass: "background",
            availableAt: event.recordedAt,
            related: !!activity,
            metadata: { label: "当前世界有可见变化" },
          });
        }
      }
      // The Attention owner ranks all collected metadata before applying its
      // global/per-source caps; collector order cannot hide a known direct item.
      return { candidates, more: ready.more };
    },
  });
}
