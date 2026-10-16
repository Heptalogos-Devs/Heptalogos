// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Resolves the Subject's own adopted life without turning incoming messages into assignments.
 * @module subject-activity-resolver
 */
import { v5 as uuidv5 } from "uuid";
import { digestCanonicalJson } from "@heptalogos/foundation-contracts";
import type { NousClient } from "@nous-wave/client";
import type { ProductSettings } from "@heptalogos/management";
import type { IdentityService } from "@heptalogos/identity";
import type {
  createLifeService,
  ActivityScope,
  LifeActivity,
  SubjectAttentionCandidate,
} from "@heptalogos/subject";
const ns = "08e59641-8ff7-43da-bf53-a154d7ad12b7";
const purpose = "自己的生活、活动与许可范围内自主交往";
/** The Host supplies actual current authority; model text cannot create grants. */
export function createSubjectActivityResolver(options: {
  settings: () => Promise<ProductSettings>;
  identity: Pick<IdentityService, "ensureSubjectEntity">;
  life: ReturnType<typeof createLifeService>;
  nous: () => Promise<{ runtime: Pick<NousClient["runtime"], "createWorkContext"> }>;
  scopeFor: (
    subjectId: string,
    actor: string,
    worldId?: string,
  ) => Promise<ActivityScope>;
  authorize: (activity: LifeActivity) => Promise<void>;
}) {
  const ready = async (activity: LifeActivity) => {
    await options.authorize(activity);
    if (activity.state === "active" && activity.continuationRequired) {
      try {
        return await options.life.transition({
          subjectId: activity.subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          action: "resume",
          reason:
            "Reconsidered the same own life under current authority; retained results are not replayed",
        });
      } catch (error) {
        const current = await options.life.get(activity.subjectId, activity.activityId);
        if (!current || current.state !== "active" || current.continuationRequired)
          throw error;
        await options.authorize(current);
        return current;
      }
    }
    return activity.state === "active" ? activity : undefined;
  };
  return async (
    candidate: SubjectAttentionCandidate,
  ): Promise<LifeActivity | undefined> => {
    const settings = await options.settings(),
      subjectId = settings.subject.id;
    if (!subjectId || subjectId !== candidate.subjectId || !settings.subject.enabled)
      return undefined;
    const audience = candidate.metadata.conversationRef;
    if (candidate.activityId && !audience) {
      const activity = await options.life.get(subjectId, candidate.activityId);
      if (
        activity?.state === "active" &&
        activity.adoptedBy &&
        activity.scope &&
        activity.workContextId
      )
        return ready(activity);
    }
    const worldId = candidate.worldId ?? settings.subject.worldId;
    const actor = (await options.identity.ensureSubjectEntity({ subjectId })).entityRef;
    const allowed = await options.scopeFor(subjectId, actor, worldId);
    const scope: ActivityScope = {
      ...allowed,
      conversations: allowed.conversations.filter(
        (grant) => !audience || grant.conversationRef === audience,
      ),
      sourceRefs:
        worldId && allowed.sourceRefs.includes("world:" + worldId)
          ? ["world:" + worldId]
          : [],
    };
    if (
      audience &&
      !scope.conversations.some((grant) => grant.operations.includes("observe"))
    )
      return undefined;
    const scopeId = digestCanonicalJson("subject.own-life-scope.v1", {
      ...scope,
      conversations: [...scope.conversations].sort((a, b) =>
        a.conversationRef.localeCompare(b.conversationRef),
      ),
      tools: [...scope.tools].sort(),
      sourceRefs: [...scope.sourceRefs].sort(),
    }).hex;
    const operationId = uuidv5(
      subjectId +
        ":" +
        (worldId ?? "no-world") +
        ":" +
        (audience ?? "internal") +
        ":" +
        scopeId,
      ns,
    );
    let activity = await options.life.readOperation(subjectId, operationId);
    if (!activity) {
      const context = await (
        await options.nous()
      ).runtime.createWorkContext(
        {
          subjectId,
          operationId: uuidv5("work-context", operationId),
          purpose,
          contextText: "这是主体自己的持续生活与交往；通知不是已经接受的他人任务。",
          unresolvedQuestions: [],
          constraints: {
            role: "subject",
            intent_source: "operator_run_policy",
            audience_ref: audience ?? "internal",
          },
          resumeConditions: [],
          budgetSummary: {},
          cognitionAnchors: [],
          entityAnchors: [actor],
          tagAnchors: [],
        },
        { timeoutMs: 5000 },
      );
      if (
        !context.workContext ||
        context.workContext.subjectId !== subjectId ||
        context.workContext.state !== "open"
      )
        throw Error("The actual own-life WorkContext is unavailable");
      const world = await options.life.worldNow(subjectId);
      try {
        activity = await options.life.propose({
          operationId,
          subjectId,
          purpose,
          mode: "work",
          window: { notBefore: null, notAfter: null },
          proposedBy: actor,
          sourceRefs: worldId ? ["world:" + worldId] : [],
          workContextId: context.workContext.workContextId,
          world,
          nextOpportunity: null,
          interruptOn: ["direct", "mention", "reply"],
        });
      } catch (error) {
        const saved = await options.life.readOperation(subjectId, operationId);
        if (
          !saved ||
          saved.purpose !== purpose ||
          saved.proposedBy !== actor ||
          saved.workContextId !== context.workContext.workContextId ||
          saved.world.timeDomainRef !== world.timeDomainRef
        )
          throw error;
        activity = saved;
      }
    }
    if (activity.purpose !== purpose || activity.proposedBy !== actor) return undefined;
    if (!activity.adoptedBy && activity.state === "planned") {
      try {
        activity = await options.life.adopt({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          adoptedBy: actor,
          scope,
        });
      } catch (error) {
        const current = await options.life.get(subjectId, activity.activityId);
        if (!current || current.adoptedBy !== actor) throw error;
        activity = current;
      }
    }
    if (activity.state === "planned" && activity.adoptedBy) {
      try {
        activity = await options.life.transition({
          subjectId,
          activityId: activity.activityId,
          expectedRevision: activity.revision,
          action: "start",
          reason:
            "Begin the Subject's own explicitly enabled life, without accepting an incoming assignment",
        });
      } catch (error) {
        const current = await options.life.get(subjectId, activity.activityId);
        if (!current || current.state !== "active" || current.adoptedBy !== actor)
          throw error;
        activity = current;
      }
    }
    return ready(activity);
  };
}
