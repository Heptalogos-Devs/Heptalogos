// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adopts an explicitly chosen new Activity through existing Life and WorkContext owners.
 * @module subject-activity-runtime
 */
import type { NousClient } from "@nous-wave/client";
import { decodeCognitionUsage } from "@nous-wave/client/host-bridge";
import type {
  DecisionCommit,
  LifeActivity,
  createLifeService,
  createDeliberationService,
} from "@heptalogos/subject";
import { managementProblem } from "@heptalogos/management";
import type { createNativeCognitionBridge } from "./native-cognition.js";
import { decisionPhaseId } from "./subject-decisions.js";
/** Repeated adoption uses the same concrete proposal and new WorkContext identity. */
export function createSubjectActivityStarter(options: {
  life: ReturnType<typeof createLifeService>;
  decisions: ReturnType<typeof createDeliberationService>;
  native: Pick<ReturnType<typeof createNativeCognitionBridge>, "readAppliedContext">;
  nous: () => Promise<Pick<NousClient, "runtime">>;
  authorize: (activity: LifeActivity) => Promise<void>;
  schedule: (
    activity: LifeActivity,
    adopted: DecisionCommit,
    context: { deadlineAt?: string },
  ) => Promise<void>;
}) {
  return async (
    adopted: DecisionCommit,
    context: { deadlineAt?: string },
  ): Promise<{ activityId: string }> => {
    const saved = await options.decisions.read(adopted.subjectId, adopted.decisionRef);
    if (
      !saved ||
      saved.decisionId !== adopted.decisionId ||
      saved.decision.action !== "continue" ||
      !saved.decision.newActivity
    )
      throw managementProblem(
        "subject.activity_denied",
        "A new Activity has no adopted decision",
        "Use the actual adopted continue choice and newActivity",
        "authorization",
      );
    const parent = await options.life.get(saved.subjectId, saved.activityId);
    if (!parent?.scope || !parent.adoptedBy)
      throw Error("The adopted parent Activity is unavailable");
    await options.authorize(parent);
    const choice = saved.decision.newActivity;
    const purpose = choice.purpose;
    if (!purpose.trim()) throw Error("The adopted learning objective is empty");
    const applied = await options.native.readAppliedContext(saved.sourceRunId);
    const usage = decodeCognitionUsage(applied.usage);
    const work = await (
      await options.nous()
    ).runtime.createWorkContext(
      {
        subjectId: saved.subjectId,
        operationId: decisionPhaseId(saved.decisionId, "new-work-context"),
        purpose,
        unresolvedQuestions: [purpose],
        constraints: {
          decision_ref: saved.decisionRef,
          parent_activity_ref: saved.activityId,
        },
        resumeConditions: [],
        budgetSummary: {},
        cognitionAnchors: usage.sourceRead?.sourceRefs ?? [],
        ...(saved.decision.reason ? { contextText: saved.decision.reason } : {}),
        // H Activity actors are not Nous-owned cognitive EntityRefs.
        entityAnchors: [],
        tagAnchors: [],
      },
      { timeoutMs: 5000 },
    );
    if (
      !work.workContext ||
      work.workContext.subjectId !== saved.subjectId ||
      work.workContext.state !== "open"
    )
      throw Error("The new actual WorkContext is unavailable");
    let activity = await options.life.propose({
      operationId: decisionPhaseId(saved.decisionId, "new-activity"),
      subjectId: saved.subjectId,
      purpose,
      mode: choice?.mode ?? "work",
      window: { notBefore: null, notAfter: null },
      proposedBy: parent.adoptedBy,
      sourceRefs: saved.sourceRefs,
      workContextId: work.workContext.workContextId,
      // The proposal inherits its stable adopted domain anchor. Start reads the actual current world.
      world: parent.world,
      nextOpportunity: parent.world,
      interruptOn: [],
    });
    if (!activity.adoptedBy)
      activity = await options.life.adopt({
        subjectId: saved.subjectId,
        activityId: activity.activityId,
        expectedRevision: activity.revision,
        adoptedBy: parent.adoptedBy,
        scope: parent.scope,
      });
    if (activity.state === "planned")
      activity = await options.life.transition({
        subjectId: saved.subjectId,
        activityId: activity.activityId,
        expectedRevision: activity.revision,
        action: "start",
        reason: `Adopted explicitly by ${saved.decisionRef}`,
      });
    await options.schedule(activity, saved, context);
    return { activityId: activity.activityId };
  };
}
