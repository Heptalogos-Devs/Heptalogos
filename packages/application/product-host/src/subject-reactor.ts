// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** One bounded foreground across notifications, virtual actions and professional result viewing.
 * @module subject-reactor
 */
import {
  resolveSituationTarget,
  allowsUntargetedSituationAction,
} from "./subject-target.js";
import {
  digestCanonicalJson,
  createUuidV7Id,
  ProblemError,
} from "@heptalogos/foundation-contracts";
import { Type } from "@heptalogos/schema-runtime/typebox";
import { compileSchema } from "@heptalogos/schema-runtime";
import { managementProblem } from "@heptalogos/management";
import {
  captureActivityOpportunity,
  situationFrameSchema,
  type SituationFrame,
  type SituationObject,
  type SubjectReaction,
  type DecisionCommit,
  type DeliberationDecision,
  type ReactorActionReceipt,
  type SubjectAttentionCandidate,
  type LifeActivity,
  type createSubjectReactorService,
  type createSubjectAttentionService,
} from "@heptalogos/subject";
import {
  isFailedRoleDispatch,
  type RoleInvocation,
  type createSubjectRoles,
} from "./subject-roles.js";
import {
  decisionPhaseId,
  type createSubjectDecisionHandler,
} from "./subject-decisions.js";
import type { createNativeCognitionBridge } from "./native-cognition.js";
/** Scheduler credentials authenticate a wake; it carries references, never source content or grants. */
export const reactorOpportunityInputSchema = Type.Object(
  {
    subjectId: Type.String({ format: "uuid" }),
    requestId: Type.String({ format: "uuid" }),
    worldId: Type.Optional(Type.String({ format: "uuid" })),
    activityId: Type.Optional(Type.String({ format: "uuid" })),
  },
  { additionalProperties: false },
);
/** Actual scheduling outcome, independent of whether a provider call was selected. */
export const reactorOpportunityResultSchema = Type.Object(
  {
    status: Type.Union([
      Type.Literal("disabled"),
      Type.Literal("idle"),
      Type.Literal("busy"),
      Type.Literal("yielded"),
      Type.Literal("processed"),
    ]),
    reactionId: Type.Optional(Type.String({ format: "uuid" })),
    runId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
/** The source owner supplies actual contacts only after an explicit read action. */
export interface ReactorPreparedView {
  readonly frame: SituationFrame;
  /** Trusted binding directory; never model-authored action arguments. */
  readonly candidates: readonly SubjectAttentionCandidate[];
  readonly contacts: RoleInvocation["contacts"];
  readonly sourceRefs: readonly string[];
  readonly messageRefs?: readonly string[];
  readonly usage: RoleInvocation["usage"];
  readonly context: Readonly<Record<string, unknown>>;
}
/** Actual action outcomes retain owner references, not copied model history. */
export interface ReactorActionOutcome {
  readonly state: Exclude<ReactorActionReceipt["state"], "started">;
  readonly resultRefs: readonly string[];
  readonly problem?: ReactorActionReceipt["problem"];
  readonly view?: ReactorPreparedView;
  readonly yield?: boolean;
  readonly continuationRef: string;
}
function denied(detail: string): never {
  throw managementProblem(
    "reactor.action_denied",
    "Subject action cannot proceed",
    detail,
    "conflict",
    "after-change",
  );
}
/** Organizes only short Subject interaction; native tools and long tasks keep their own owners. */
export function createSubjectReactor(options: {
  readonly foreground: ReturnType<typeof createSubjectReactorService>;
  readonly attention: Pick<ReturnType<typeof createSubjectAttentionService>, "select">;
  readonly resolveActivity: (
    candidate: SubjectAttentionCandidate,
  ) => Promise<LifeActivity | undefined>;
  readonly roles: ReturnType<typeof createSubjectRoles>;
  readonly decisions: ReturnType<typeof createSubjectDecisionHandler>;
  readonly native: Pick<ReturnType<typeof createNativeCognitionBridge>, "readDispatch">;
  readonly worldNow: (subjectId: string) => Promise<LifeActivity["world"]>;
  readonly readActivity: (
    subjectId: string,
    activityId: string,
  ) => Promise<LifeActivity | undefined>;
  readonly enabled: () => Promise<boolean>;
  readonly now: () => string;
  readonly prepare: (input: {
    reaction: SubjectReaction;
    candidates: readonly SubjectAttentionCandidate[];
    lastAction?: ReactorActionReceipt;
  }) => Promise<ReactorPreparedView>;
  readonly act: (input: {
    reaction: SubjectReaction;
    frame: SituationFrame;
    object?: SituationObject;
    adopted: DecisionCommit;
    sourceRunId: string;
    view: ReactorPreparedView;
    actionId: string;
  }) => Promise<ReactorActionOutcome>;
  /** Saves meaningful continuation in its existing Life/WorkContext owner before relinquishing foreground. */
  readonly afterYield: (subjectId: string) => Promise<void>;
  readonly saveContinuation: (input: {
    reaction: SubjectReaction;
    reason: string;
    lastAction?: ReactorActionReceipt;
  }) => Promise<string>;
}) {
  const yieldReaction = async (
    reaction: SubjectReaction,
    reason: string,
    lastAction?: ReactorActionReceipt,
    revoke = false,
  ) => {
    const continuationRef = await options.saveContinuation({
      reaction,
      reason,
      ...(lastAction ? { lastAction } : {}),
    });
    await options.foreground.yield({
      subjectId: reaction.subjectId,
      activityId: reaction.activityId,
      focus: reaction,
      reason,
      continuationRef,
      ...(revoke ? { revoke: true } : {}),
    });
    await options.afterYield(reaction.subjectId);
    return { status: "yielded" as const, reactionId: reaction.reactionId };
  };
  return {
    /** Every trusted opportunity uses this entry; no channel/world caller invokes a second subjective loop. */
    async wake(input: {
      subjectId: string;
      naturalOpportunity?: boolean;
      requestId?: string;
      manualActivityId?: string;
    }): Promise<{
      status: "disabled" | "idle" | "busy" | "yielded" | "processed";
      reactionId?: string;
      runId?: string;
    }> {
      const claimRequestId =
        input.requestId ?? createUuidV7Id("SubjectReactionRequestId");
      let reaction = await options.foreground.current(input.subjectId);
      const enabled = await options.enabled();
      if (!enabled) {
        if (reaction)
          await options.foreground.yield({
            subjectId: reaction.subjectId,
            activityId: reaction.activityId,
            focus: reaction,
            continuationRef: `activity:${reaction.activityId}`,
            reason: "subject_disabled",
            revoke: true,
          });
        return { status: "disabled" };
      }
      if (reaction) {
        const activity = await options.readActivity(
          reaction.subjectId,
          reaction.activityId,
        );
        if (
          !activity ||
          activity.state !== "active" ||
          activity.continuationRequired ||
          !activity.scope ||
          !activity.adoptedBy
        ) {
          await options.foreground.yield({
            subjectId: reaction.subjectId,
            activityId: reaction.activityId,
            focus: reaction,
            continuationRef: `activity:${reaction.activityId}`,
            reason: "activity_authority_stopped",
            revoke: true,
          });
          reaction = undefined;
        }
      }
      if (
        input.manualActivityId &&
        reaction &&
        reaction.activityId !== input.manualActivityId
      )
        return {
          status: "busy",
          reactionId: reaction.reactionId,
          ...(reaction.currentRunId ? { runId: reaction.currentRunId } : {}),
        };
      const selection = await options.attention.select({
        subjectId: input.subjectId,
        ...(input.manualActivityId ? { manualActivityId: input.manualActivityId } : {}),
        ...(reaction
          ? {
              currentFocus: {
                reactionId: reaction.reactionId,
                activityId: reaction.activityId,
                focusRevision: reaction.focusRevision,
                candidateRef: reaction.candidate.candidateRef,
                priorityClass: reaction.candidate.priorityClass,
              },
            }
          : {}),
        naturalOpportunity: input.naturalOpportunity ?? false,
      });
      if (input.manualActivityId && !selection.candidates.length)
        return {
          status: "busy",
          ...(reaction ? { reactionId: reaction.reactionId } : {}),
        };
      const lastAction = reaction
        ? await options.foreground.lastAction(input.subjectId, reaction.reactionId)
        : undefined;
      if (reaction && Date.parse(options.now()) >= Date.parse(reaction.deadlineAt))
        return yieldReaction(reaction, "reaction_deadline", lastAction, true);
      if (reaction?.currentRunId || lastAction?.state === "started") {
        // Reconciliation is exact; a live or uncertain call is never replaced with a new paid request.
        const saved = reaction?.currentRunId
          ? await options.native.readDispatch(input.subjectId, reaction.currentRunId)
          : undefined;
        if (
          reaction?.currentRunId &&
          isFailedRoleDispatch(saved, reaction.currentRunId)
        ) {
          const failedRunId = reaction.currentRunId;
          reaction = await options.foreground.settleRun({
            subjectId: reaction.subjectId,
            activityId: reaction.activityId,
            focus: reaction,
            runId: failedRunId,
          });
          return {
            ...(await yieldReaction(
              reaction,
              "native_role_failed:" + failedRunId,
              lastAction,
            )),
            runId: failedRunId,
          };
        }
        if (
          (!saved && lastAction?.state !== "completed") ||
          (saved && saved.state !== "completed") ||
          lastAction?.state === "started"
        )
          return {
            status: "busy",
            reactionId: reaction!.reactionId,
            ...(reaction?.currentRunId ? { runId: reaction.currentRunId } : {}),
          };
      }
      if (reaction?.currentRunId && selection.switchRequested) {
        reaction = await options.foreground.settleRun({
          subjectId: reaction.subjectId,
          activityId: reaction.activityId,
          focus: reaction,
          runId: reaction.currentRunId,
        });
      }
      if (reaction && selection.switchRequested) {
        const continuationRef = await options.saveContinuation({
          reaction,
          reason: "attention_switch",
          ...(lastAction ? { lastAction } : {}),
        });
        const nextActivity = await options.resolveActivity(selection.switchRequested);
        if (!nextActivity) return { status: "busy", reactionId: reaction.reactionId };
        const opportunity = captureActivityOpportunity(
          { ...nextActivity, mode: "work" },
          await options.worldNow(input.subjectId),
        );
        const next = await options.foreground.claim({
          ...(opportunity ? { opportunity } : {}),
          subjectId: input.subjectId,
          activityId: nextActivity.activityId,
          requestId: claimRequestId,
          candidateRef: selection.switchRequested.candidateRef,
          explanationRef: selection.explanationRef,
          replace: {
            reactionId: reaction.reactionId,
            focusRevision: reaction.focusRevision,
            continuationRef,
          },
        });
        if (!next.claimed)
          return { status: "idle", reactionId: next.reaction.reactionId };
        reaction = next.reaction;
      }
      if (!reaction) {
        if (!selection.selected) return { status: "idle" };
        const activity = await options.resolveActivity(selection.selected);
        if (!activity) return { status: "idle" };
        const opportunity = captureActivityOpportunity(
          { ...activity, mode: "work" },
          await options.worldNow(input.subjectId),
        );
        const claim = await options.foreground.claim({
          ...(opportunity ? { opportunity } : {}),
          subjectId: input.subjectId,
          activityId: activity.activityId,
          requestId: claimRequestId,
          candidateRef: selection.selected.candidateRef,
          explanationRef: selection.explanationRef,
        });
        if (!claim.claimed)
          return { status: "idle", reactionId: claim.reaction.reactionId };
        reaction = claim.reaction;
      }
      let previous = await options.foreground.lastAction(
        input.subjectId,
        reaction.reactionId,
      );
      let view = await options.prepare({
        reaction,
        candidates: selection.candidates,
        ...(previous ? { lastAction: previous } : {}),
      });
      let runId: string | undefined;
      while (
        (reaction.stepCount < reaction.policy.maxInteractionSteps ||
          view.contacts.length > 0) &&
        Date.parse(options.now()) < Date.parse(reaction.deadlineAt)
      ) {
        const frame = compileSchema<SituationFrame>(situationFrameSchema).validate(
          view.frame,
        );
        if (
          !frame.ok ||
          frame.value.subjectId !== reaction.subjectId ||
          frame.value.activityId !== reaction.activityId ||
          frame.value.reactionId !== reaction.reactionId ||
          frame.value.focusRevision !== reaction.focusRevision
        )
          denied("Use the actual current SituationFrame and foreground qualification");
        runId = decisionPhaseId(
          reaction.reactionId,
          "deliberation:" + reaction.stepCount,
        );
        await options.foreground.bindRun({
          subjectId: reaction.subjectId,
          activityId: reaction.activityId,
          focus: reaction,
          runId,
        });
        let result: Awaited<ReturnType<typeof options.roles.invoke>>;
        try {
          result = await options.roles.invoke({
            requestId: runId,
            requestDigest: digestCanonicalJson("reactor.subject-phase.v1", {
              reactionId: reaction.reactionId,
              focusRevision: reaction.focusRevision,
              step: reaction.stepCount,
            }).hex,
            subjectId: reaction.subjectId,
            activityId: reaction.activityId,
            role: "subject.deliberation",
            foreground: {
              reactionId: reaction.reactionId,
              focusRevision: reaction.focusRevision,
            },
            deadlineAt: reaction.deadlineAt,
            contacts: view.contacts,
            sourceRefs: view.sourceRefs,
            messageRefs: view.messageRefs,
            usage: view.usage,
            context: {
              ...view.context,
              situation: frame.value,
              previousAction: previous ?? null,
            },
          });
        } catch (error) {
          const saved = await options.native.readDispatch(reaction.subjectId, runId);
          if (!isFailedRoleDispatch(saved, runId)) throw error;
          reaction = await options.foreground.settleRun({
            subjectId: reaction.subjectId,
            activityId: reaction.activityId,
            focus: reaction,
            runId,
          });
          return {
            ...(await yieldReaction(reaction, "native_role_failed:" + runId, previous)),
            runId,
          };
        }
        await options.foreground.settleRun({
          subjectId: reaction.subjectId,
          activityId: reaction.activityId,
          focus: reaction,
          runId,
        });
        if (result.outputProblem)
          return {
            ...(await yieldReaction(
              reaction,
              `role_output_blocked:${runId}:${result.outputProblem.code}`,
              previous,
            )),
            runId,
          };
        if (reaction.stepCount >= reaction.policy.maxInteractionSteps)
          return {
            ...(await yieldReaction(
              reaction,
              "read_admitted_at_action_boundary",
              previous,
            )),
            runId,
          };
        const proposed = result.structuredOutput as DeliberationDecision | undefined;
        if (!proposed)
          return {
            ...(await yieldReaction(reaction, "invalid_decision:" + runId, previous)),
            runId,
          };
        const target =
          proposed.target || !allowsUntargetedSituationAction(proposed.action)
            ? resolveSituationTarget(frame.value, proposed)
            : undefined;
        if (target?.problem)
          return {
            ...(await yieldReaction(
              reaction,
              "invalid_target:" + runId + ":" + target.problem,
              previous,
            )),
            runId,
          };
        const object = target?.object;
        const adopted = await options.decisions.adopt({
          subjectId: reaction.subjectId,
          activityId: reaction.activityId,
          requestId: runId,
          run: result,
        });
        const actionId = decisionPhaseId(adopted.decisionId, "interaction");
        const reservation = await options.foreground.beginAction({
          subjectId: reaction.subjectId,
          activityId: reaction.activityId,
          focus: reaction,
          actionId,
          action: {
            action: proposed.action,
            ...(proposed.target ? { target: proposed.target } : {}),
          },
        });
        if (!reservation.claimed)
          return { status: "busy", reactionId: reaction.reactionId, runId };
        // Owners validate permissions and exact revisions again; model choices cannot construct source identities.
        let actual: ReactorActionOutcome;
        try {
          actual = await options.act({
            reaction,
            frame: frame.value,
            ...(object ? { object } : {}),
            adopted,
            sourceRunId: runId,
            view,
            actionId,
          });
        } catch (error) {
          if (
            !(error instanceof ProblemError) ||
            error.problem.problemCode !== "role.output_blocked"
          )
            throw error;
          actual = {
            state: "rejected",
            resultRefs: [],
            yield: true,
            continuationRef: "activity:" + reaction.activityId,
            problem: {
              code: error.problem.problemCode,
              detail: (error.problem.detail ?? error.problem.title).slice(0, 512),
            },
          };
        }
        previous = await options.foreground.finishAction({
          subjectId: reaction.subjectId,
          actionId,
          state: actual.state,
          resultRefs: actual.resultRefs,
          ...(actual.problem ? { problem: actual.problem } : {}),
        });
        reaction = (await options.foreground.current(input.subjectId))!;
        if (!reaction || reaction.reactionId !== reservation.receipt.reactionId)
          return { status: "processed", runId };
        if (actual.yield || ["wait", "rest"].includes(proposed.action))
          return {
            ...(await yieldReaction(reaction, "subject_" + proposed.action, previous)),
            runId,
          };
        const considered = await options.attention.select({
          subjectId: reaction.subjectId,
          ...(input.manualActivityId
            ? { manualActivityId: input.manualActivityId }
            : {}),
          currentFocus: {
            reactionId: reaction.reactionId,
            activityId: reaction.activityId,
            focusRevision: reaction.focusRevision,
            candidateRef: reaction.candidate.candidateRef,
            priorityClass: reaction.candidate.priorityClass,
          },
        });
        if (considered.switchRequested)
          return {
            ...(await yieldReaction(reaction, "attention_switch", previous)),
            runId,
          };
        view =
          actual.view ??
          (await options.prepare({
            reaction,
            candidates: considered.candidates,
            lastAction: previous,
          }));
        const viewed =
          actual.state === "completed" && proposed.action === "read"
            ? object?.handle
            : undefined;
        view = {
          ...view,
          frame: {
            ...view.frame,
            frameRef:
              "situation:" +
              decisionPhaseId(reaction.reactionId, "frame:" + reaction.stepCount),
            remainingSteps: Math.max(
              0,
              reaction.policy.maxInteractionSteps - reaction.stepCount,
            ),
            ...(viewed ? { currentHandle: viewed } : {}),
            objects: view.frame.objects.map((value) =>
              value.handle === viewed ? { ...value, state: "viewed" as const } : value,
            ),
          },
        };
      }
      return {
        ...(await yieldReaction(
          reaction,
          "interaction_budget",
          previous,
          !!reaction.currentRunId,
        )),
        ...(runId ? { runId } : {}),
      };
    },
  };
}
