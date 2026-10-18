// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connects existing world owners to native roles, formal contacts and one native scheduler.
 * @module world-runtime
 */
import { readActiveLifePage } from "./activity-page.js";
import { ROLE_PROMPTS } from "./role-prompts.js";
import { v5 as uuidv5 } from "uuid";
import { projectWorldDeadline, type NousClient } from "@nous-wave/client";
import {
  encodeCognitionUsage,
  type HostPrepareResponse,
  timestampFromDate,
} from "@nous-wave/client/host-bridge";
import type {
  createWorldLifeService,
  createLifeService,
  createNarrativeService,
  LifeActivity,
} from "@heptalogos/subject";
import type { SubjectRoleBinding } from "@heptalogos/management";
import { managementProblem } from "@heptalogos/management";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import type { createSubjectRoles } from "./subject-roles.js";
import { decisionPhaseId } from "./subject-decisions.js";
import type { createNativeCognitionBridge } from "./native-cognition.js";
import type { NativeWorldSchedule } from "./native-dispatch.js";
import { createWorldOpportunity } from "./world-opportunity.js";
const ns = "b6cb3efa-3bd9-4cc1-bfa4-4a72742b1d13";
function plannerRevision(context: Record<string, unknown>): number | null {
  const frame = context.frame;
  if (!frame || typeof frame !== "object" || !("state" in frame)) return null;
  const state = frame.state;
  return state &&
    typeof state === "object" &&
    "revision" in state &&
    typeof state.revision === "number"
    ? state.revision
    : null;
}

/** No provider loop, timer or private cognition persistence is introduced here. */
export function createWorldRuntime(options: {
  worlds: ReturnType<typeof createWorldLifeService>;
  life: ReturnType<typeof createLifeService>;
  narrative: ReturnType<typeof createNarrativeService>;
  roles: ReturnType<typeof createSubjectRoles>;
  native: Pick<
    ReturnType<typeof createNativeCognitionBridge>,
    "readRun" | "readAppliedContext" | "readDispatch"
  >;
  wakeSubject: (input: {
    subjectId: string;
    naturalOpportunity: boolean;
  }) => Promise<unknown>;
  nous: () => Promise<Pick<NousClient, "clocks" | "runtime">>;
  currentSubject: () => Promise<string>;
  enabled: () => Promise<boolean>;
  bindingFor: (role: SubjectRoleBinding["role"]) => Promise<SubjectRoleBinding>;
  authorize: (activity: LifeActivity) => Promise<void>;
  reproject: () => Promise<void>;
  now: () => string;
}) {
  const projectNext = async (input: {
    subjectId: string;
    worldId: string;
    activityId: string;
    next: { timeDomainRef: string; at: string } | null;
    requestId?: string;
  }) => {
    let realAt: string | null = null;
    if (input.next) {
      const clock = await (
        await options.nous()
      ).clocks.readClock({ subjectId: input.subjectId }, { timeoutMs: 5000 });
      if (!clock.now)
        throw managementProblem(
          "world.clock_unavailable",
          "World clock is unavailable",
          "Read the actual official clock mapping",
          "unavailable",
        );
      const deadline = projectWorldDeadline(clock, {
        ...clock.now,
        timeDomainRef: input.next.timeDomainRef,
        at: timestampFromDate(new Date(input.next.at)),
      });
      if (deadline.kind === "unmapped")
        throw managementProblem(
          "world.clock_unavailable",
          "World deadline has no current real mapping",
          "Use the actual current time domain",
          "unavailable",
        );
      if (deadline.kind === "due")
        realAt = new Date(
          Math.max(deadline.at.getTime(), Date.parse(options.now()) + 1000),
        ).toISOString();
    }
    return {
      subjectId: input.subjectId,
      worldId: input.worldId,
      activityId: input.activityId,
      realAt,
      requestId:
        input.requestId ??
        uuidv5(
          `${input.subjectId}:${input.worldId}:${input.activityId}:${input.next?.timeDomainRef ?? "paused"}:${input.next?.at ?? "none"}`,
          ns,
        ),
    };
  };
  const nextOpportunity = async (): Promise<
    Parameters<NativeWorldSchedule>[0] | null
  > => {
    const subjectId = await options.currentSubject();
    const enabled = await options.enabled();
    let afterId: string | undefined;
    const candidates: {
      subjectId: string;
      worldId: string;
      activityId: string;
      next: { timeDomainRef: string; at: string };
      requestId?: string;
    }[] = [];
    let fallback:
      { subjectId: string; worldId: string; activityId: string } | undefined;
    do {
      const page = await readActiveLifePage(options.life, subjectId, afterId);
      for (const activity of page.activities) {
        if (!activity.scope) continue;
        await options.authorize(activity);
        for (const source of activity.scope.sourceRefs) {
          const worldId = /^world:([0-9a-f-]{36})$/i.exec(source)?.[1];
          if (!worldId) continue;
          const frame = await options.worlds.prepareAdvance(subjectId, worldId);
          const context = { subjectId, worldId, activityId: activity.activityId };
          fallback ??= context;
          // Bootstrap one unset scene through the same declaration. Its durable patch
          // suppresses repeats; subsequent work follows actual calendar/action nodes.
          const initialRequestId = uuidv5(
            "initial-world-opportunity:" + ROLE_PROMPTS["world.planner"].id,
            worldId,
          );
          if (
            enabled &&
            frame.needsRefinement &&
            !(await options.worlds.readRealization(
              subjectId,
              uuidv5("world.patch", initialRequestId),
            ))
          )
            candidates.push({
              ...context,
              next: frame.world,
              requestId: initialRequestId,
            });
          const pendingActions = await options.worlds.readPendingActions(
            subjectId,
            worldId,
            64,
          );
          for (const next of [
            frame.nextOpportunity,
            activity.nextOpportunity,
            ...pendingActions.map((action) => action.nextOpportunity),
          ])
            if (enabled && next?.timeDomainRef === frame.world.timeDomainRef)
              candidates.push({ ...context, next });
        }
      }
      afterId = page.nextId ?? undefined;
    } while (afterId);
    candidates.sort((a, b) => Date.parse(a.next.at) - Date.parse(b.next.at));
    if (candidates[0]) return projectNext(candidates[0]);
    if (fallback) return projectNext({ ...fallback, next: null });
    return null;
  };
  return {
    nextOpportunity,
    async advance(input: {
      subjectId: string;
      worldId: string;
      activityId: string;
      requestId: string;
    }) {
      if (input.subjectId !== (await options.currentSubject()))
        throw managementProblem(
          "world.scope_denied",
          "World names another Subject",
          "Use the current actual binding",
          "authorization",
        );
      let activity = await options.life.get(input.subjectId, input.activityId);
      if (!activity)
        throw managementProblem(
          "world.activity_unavailable",
          "The world Activity is unavailable",
          "Use the adopted actual Activity",
          "unavailable",
        );
      await options.authorize(activity);
      if (activity.state === "active" && activity.continuationRequired)
        activity = await options.life.transition({
          subjectId: input.subjectId,
          activityId: input.activityId,
          expectedRevision: activity.revision,
          action: "resume",
          reason:
            "Reconsidered the same adopted world Activity after recovery; no uncertain effect is replayed",
        });
      if (!activity.workContextId)
        throw managementProblem(
          "world.work_context_unavailable",
          "World life requires its actual WorkContext",
          "Adopt a formal open WorkContext",
          "unavailable",
        );
      const work = await (
        await options.nous()
      ).runtime.getWorkContext(
        { subjectId: input.subjectId, workContextId: activity.workContextId },
        { timeoutMs: 5000 },
      );
      if (work.workContext?.state !== "open")
        throw managementProblem(
          "world.work_context_unavailable",
          "The actual WorkContext is not open",
          "Resume the owned work context explicitly",
          "unavailable",
        );
      const plannerDispatch = await options.native.readDispatch(
        input.subjectId,
        uuidv5("world.planner", input.requestId),
      );
      const plannerResult = plannerDispatch?.result;
      const frozenPlannerDeadline =
        plannerResult &&
        typeof plannerResult === "object" &&
        "deadlineAt" in plannerResult &&
        typeof plannerResult.deadlineAt === "string"
          ? plannerResult.deadlineAt
          : undefined;
      const op = createWorldOpportunity<
        HostPrepareResponse["contacts"][number],
        HostPrepareResponse["usage"]
      >({
        worlds: options.worlds,
        life: options.life,
        enabled: options.enabled,
        invoke: (request) =>
          options.roles.invoke({
            ...request,
            taskTools: [],
            deadlineAt: request.deadlineAt ?? frozenPlannerDeadline,
            contacts: [...request.contacts],
            sourceRefs: [...request.sourceRefs],
            requestDigest: digestCanonicalJson("host.world-role.v1", {
              rootRequest: input.requestId,
              subjectId: input.subjectId,
              activityId: input.activityId,
              worldId: input.worldId,
              role: request.role,
              plannerRevision:
                request.role === "world.planner"
                  ? plannerRevision(request.context)
                  : null,
            } as CanonicalJsonValue).hex,
          }),
        contextFor: async (context) => {
          return {
            contacts: [],
            sourceRefs: [
              `world:${input.worldId}`,
              ...context.sourceRefs.filter((ref) =>
                activity!.scope!.sourceRefs.includes(ref),
              ),
            ],
            usage: encodeCognitionUsage({
              agentInstanceId: decisionPhaseId(input.requestId, context.role),
              purpose:
                context.role === "world.planner"
                  ? "world_authoring"
                  : "subject_deliberation",
              intent: activity!.purpose,
              audience: { visibility: "internal" },
              participants: [],
              worldId: input.worldId,
              sourceRead: {
                subjectId: input.subjectId,
                sourceRefs: [{ kind: "work_context", value: activity!.workContextId! }],
                originConversationRefs: [],
              },
            }),
          };
        },
        wakeSubject: options.wakeSubject,
        scheduleNext: options.reproject,
      });
      return op.advance(input);
    },
  };
}
