// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connects existing world owners to native roles, formal contacts and one native scheduler.
 * @module world-runtime
 */
import { v5 as uuidv5 } from "uuid";
import { projectWorldDeadline, type NousClient } from "@nous-wave/client";
import {
  encodeCognitionUsage,
  encodeObservationInput,
  decodeObservationInput,
  decodeProjection,
  decodeAcceptedObservation,
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
import type { createSubjectDecisionHandler } from "./subject-decisions.js";
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
  handler: ReturnType<typeof createSubjectDecisionHandler>;
  nous: () => Promise<Pick<NousClient, "clocks" | "runtime">>;
  currentSubject: () => Promise<string>;
  enabled: () => Promise<boolean>;
  bindingFor: (role: SubjectRoleBinding["role"]) => Promise<SubjectRoleBinding>;
  authorize: (activity: LifeActivity) => Promise<void>;
  schedule: NativeWorldSchedule;
  now: () => string;
}) {
  const scheduleNext = async (input: {
    subjectId: string;
    worldId: string;
    activityId: string;
    next: { timeDomainRef: string; at: string } | null;
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
    await options.schedule({
      ...input,
      realAt,
      requestId: uuidv5(
        `${input.subjectId}:${input.worldId}:${input.activityId}:${input.next?.timeDomainRef ?? "paused"}:${input.next?.at ?? "none"}`,
        ns,
      ),
    });
  };
  const reproject = async () => {
    const subjectId = await options.currentSubject();
    const enabled = await options.enabled();
    let afterId: string | undefined;
    const candidates: {
      subjectId: string;
      worldId: string;
      activityId: string;
      next: { timeDomainRef: string; at: string };
    }[] = [];
    let fallback:
      { subjectId: string; worldId: string; activityId: string } | undefined;
    do {
      const page = await options.life.schedule({
        subjectId,
        states: ["active"],
        limit: 128,
        ...(afterId ? { afterId } : {}),
      });
      for (const activity of page.activities) {
        if (!activity.scope) continue;
        await options.authorize(activity);
        for (const source of activity.scope.sourceRefs) {
          const worldId = /^world:([0-9a-f-]{36})$/i.exec(source)?.[1];
          if (!worldId) continue;
          const frame = await options.worlds.prepareAdvance(subjectId, worldId);
          const context = { subjectId, worldId, activityId: activity.activityId };
          fallback ??= context;
          for (const next of [frame.nextOpportunity, activity.nextOpportunity])
            if (enabled && next?.timeDomainRef === frame.world.timeDomainRef)
              candidates.push({ ...context, next });
        }
      }
      afterId = page.nextId ?? undefined;
    } while (afterId);
    candidates.sort((a, b) => Date.parse(a.next.at) - Date.parse(b.next.at));
    if (candidates[0]) await scheduleNext(candidates[0]);
    else if (fallback) await scheduleNext({ ...fallback, next: null });
  };
  return {
    scheduleNext,
    reproject,
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
      const subjectRunId = uuidv5("subject.deliberation", input.requestId);
      const priorSubject = await options.native.readRun(subjectRunId);
      const frozenContacts = priorSubject
        ? new Set(
            priorSubject.registration.contacts.map((contact) => contact.contactRef),
          )
        : undefined;
      const acceptedContact = async (
        runId: string,
        event: Awaited<ReturnType<typeof options.worlds.pendingContacts>>[number],
      ) => {
        const run = await options.native.readRun(runId);
        if (
          !run?.consumerId ||
          run.registration.subjectId !== input.subjectId ||
          run.registration.roleScope.role !== "subject.deliberation" ||
          !run.registration.sourceRefs.includes(event.sourceRef)
        )
          return undefined;
        const exact = run.registration.contacts.find(
          (contact) => contact.contactRef === event.sourceRef,
        );
        if (!exact) return undefined;
        const observation = decodeObservationInput(exact.observation);
        if (
          observation.subjectId !== input.subjectId ||
          observation.sourceClass !== "world_realized" ||
          observation.worldRealized?.worldId !== event.worldId ||
          observation.worldRealized.eventId !== event.eventId ||
          observation.worldRealized.eventRevision !== String(event.eventRevision)
        )
          return undefined;
        const applied = await options.native.readAppliedContext(runId);
        if (
          applied.roleScope.role !== "subject.deliberation" ||
          decodeProjection(applied.projection).consumerId !== run.consumerId ||
          !applied.occurrences.some(
            (item) =>
              item.contactRef === event.sourceRef &&
              decodeAcceptedObservation(item.receipt).occurrenceId,
          )
        )
          return undefined;
        return { contactRef: event.sourceRef };
      };
      const contacts = new Map<string, HostPrepareResponse["contacts"][number]>();
      const binding = await options.bindingFor("subject.deliberation");
      const maxBytes = Math.max(0, Math.floor(binding.inputTokens / 3));
      let selectedBytes = 0;
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
        releaseWorldContact: async (event) => {
          if (frozenContacts && !frozenContacts.has(event.sourceRef))
            return { contactRef: event.sourceRef, selected: false };
          const text = JSON.stringify({
            worldId: event.worldId,
            eventId: event.eventId,
            eventRevision: event.eventRevision,
            interval: event.interval,
            perceptions: event.perceptions,
          });
          const bytes = Buffer.byteLength(text);
          if (contacts.size >= 32 || selectedBytes + bytes > maxBytes)
            return { contactRef: event.sourceRef, selected: false };
          const at = options.now(),
            last = [...event.perceptions]
              .sort((a, b) => Date.parse(a.at.at) - Date.parse(b.at.at))
              .at(-1);
          if (!last) return { contactRef: event.sourceRef, selected: false };
          const selection = await options.worlds.selectContact({
            subjectId: input.subjectId,
            worldId: input.worldId,
            eventId: event.eventId,
            runId: subjectRunId,
          });
          if (!selection.selected || selection.state === "released") {
            if (
              selection.state === "selected" &&
              selection.selectedRunId &&
              (await acceptedContact(selection.selectedRunId, event))
            )
              await options.worlds.acknowledgeContact({
                subjectId: input.subjectId,
                worldId: input.worldId,
                eventId: event.eventId,
                contactRef: selection.contactRef,
                runId: selection.selectedRunId,
              });
            return { contactRef: event.sourceRef, selected: false };
          }
          const observed = timestampFromDate(new Date(at));
          contacts.set(event.sourceRef, {
            contactRef: event.sourceRef,
            observation: encodeObservationInput({
              subjectId: input.subjectId,
              requestId: uuidv5(event.sourceRef + ":contact", ns),
              sourceClass: "world_realized",
              externalObjectRef: "object:heptalogos:" + event.sourceRef,
              actorEntityRef: last.actorRef,
              observedAt: observed,
              occurredTime: {
                timeDomainRef: event.interval.timeDomainRef,
                extent: {
                  value: {
                    case: "interval",
                    value: {
                      start: timestampFromDate(new Date(event.interval.start)),
                      end: timestampFromDate(new Date(event.interval.end)),
                    },
                  },
                },
              },
              worldRealized: {
                worldId: event.worldId,
                eventId: event.eventId,
                eventRevision: String(event.eventRevision),
                producerRef: event.source.producerRef,
                generationMethod: event.source.kind,
                realizedAt: timestampFromDate(new Date(event.recordedAt)),
                worldObserved: {
                  timeDomainRef: last.at.timeDomainRef,
                  at: timestampFromDate(new Date(last.at.at)),
                  recordedAt: observed,
                },
                sharedOriginRefs: [
                  event.source.producerRef,
                  ...event.source.sourceRefs,
                ],
              },
              material: {
                case: "inlineText",
                value: { text, mediaType: "application/json" },
              },
              context: {
                activity_ref: input.activityId,
                world_event_ref: event.sourceRef,
                actual_producer: "heptalogos.world_life",
              },
              admit: false,
            }),
          });
          selectedBytes += bytes;
          return { contactRef: event.sourceRef, selected: true };
        },
        contextFor: async (context) => {
          const selected =
            context.role === "world.planner"
              ? []
              : context.sourceRefs.flatMap((ref) =>
                  contacts.has(ref) ? [contacts.get(ref)!] : [],
                );
          return {
            contacts: selected,
            sourceRefs: [
              `world:${input.worldId}`,
              ...selected.map((contact) => contact.contactRef),
              ...(context.role === "world.planner"
                ? context.sourceRefs.filter((ref) =>
                    activity!.scope!.sourceRefs.includes(ref),
                  )
                : []),
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
        acceptedWorldContact: ({ runId, event }) => acceptedContact(runId, event),
        adoptDeliberation: async (decision) => {
          await options.handler.adopt(decision);
        },
        scheduleNext: reproject,
      });
      return op.advance(input);
    },
  };
}
