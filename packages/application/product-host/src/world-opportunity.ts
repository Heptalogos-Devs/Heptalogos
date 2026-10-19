// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Consumes a channel-independent world opportunity through the existing native roles.
 * @module world-opportunity
 */
import type { createWorldLifeService, createLifeService } from "@heptalogos/subject";
import { type WorldPlannerProposal } from "@heptalogos/subject";
import { managementProblem } from "@heptalogos/management";
import { v5 as uuidv5 } from "uuid";
type Worlds = ReturnType<typeof createWorldLifeService>;
type Point = { timeDomainRef: string; at: string };
type Role = "world.planner";
/** Native identities and official usage/contact construction remain in their existing owner. */
export interface WorldOpportunityOptions<TContact, TUsage> {
  readonly worlds: Worlds;
  readonly life: Pick<ReturnType<typeof createLifeService>, "get">;
  readonly enabled: () => Promise<boolean>;
  readonly invoke: (input: {
    requestId: string;
    subjectId: string;
    activityId: string;
    role: Role;
    deadlineAt?: string;
    context: Record<string, unknown>;
    contacts: readonly TContact[];
    sourceRefs: readonly string[];
    usage: TUsage;
  }) => Promise<{
    runId: string;
    text?: string;
    structuredOutput?: unknown;
    status: string;
    admitted: boolean;
    activityRevision?: number;
    deadlineAt?: string;
  }>;
  readonly contextFor: (input: {
    role: Role;
    subjectId: string;
    activityId: string;
    worldId: string;
    world: Point;
    sourceRefs: readonly string[];
  }) => Promise<{
    contacts: readonly TContact[];
    sourceRefs: readonly string[];
    usage: TUsage;
  }>;
  /** World realization only notifies the one foreground; it never reads events for the Subject. */
  readonly wakeSubject: (input: {
    subjectId: string;
    naturalOpportunity: boolean;
  }) => Promise<unknown>;
  readonly scheduleNext: (input: {
    subjectId: string;
    worldId: string;
    activityId: string;
    next: Point | null;
  }) => Promise<void>;
}
/** The caller authenticates a real service opportunity; this function owns no timers or model loop. */
export function createWorldOpportunity<TContact, TUsage>(
  options: WorldOpportunityOptions<TContact, TUsage>,
) {
  return {
    async advance(input: {
      subjectId: string;
      worldId: string;
      activityId: string;
      requestId: string;
    }) {
      if (!(await options.enabled())) return { status: "disabled" as const };
      const activity = await options.life.get(input.subjectId, input.activityId);
      if (
        !activity?.adoptedBy ||
        !activity.scope ||
        activity.state !== "active" ||
        activity.continuationRequired
      )
        throw managementProblem(
          "world.activity_unavailable",
          "World opportunity has no current adopted Activity",
          "Use an active same-Subject Activity and its actual permissions",
          "conflict",
        );
      const advanced = await options.worlds.advance(input.subjectId, input.worldId);
      const { frame, interval: range } = advanced;
      if (activity.world.timeDomainRef !== frame.world.timeDomainRef)
        throw managementProblem(
          "world.time_domain_unavailable",
          "Activity and world cannot be compared",
          "Use the actual adopted world domain",
          "conflict",
        );
      let perceptibleChanges = advanced.perceptibleChanges;
      const needsPlanner = frame.needsRefinement;
      let plannerRunId: string | undefined;
      const priorPatch = await options.worlds.readRealization(
        input.subjectId,
        uuidv5("world.patch", input.requestId),
      );
      if (needsPlanner && !priorPatch) {
        const context = await options.contextFor({
          ...input,
          role: "world.planner",
          world: frame.world,
          sourceRefs: [
            ...frame.state.definition.informationSourceRefs,
            ...frame.recentEvents.map(
              (event) =>
                `world-event:${input.worldId}:${event.eventId}:${"revision" in event ? event.revision : "eventRevision" in event ? event.eventRevision : 0}`,
            ),
          ],
        });
        const result = await options.invoke({
          ...input,
          requestId: uuidv5("world.planner", input.requestId),
          role: "world.planner",
          context: {
            frame,
            realizationInterval: range,
            outputContract: {
              hostOwnedFields: [
                "operationId",
                "subjectId",
                "worldId",
                "expectedRevision",
                "interval",
                "events[].source.kind",
                "events[].source.producerRef",
              ],
              instructions:
                "Return only the requested events, coverage and optional changed schedule. Keep realized events inside realizationInterval; the Host supplies that patch interval and its identity/producer fields. Preserve existing realized events and propose compatible virtual events for unset scenes. Future arrangements belong only in optional schedule; omit schedule when existing plans suffice, and do not copy unchanged calendar/routine entries. Do not call tools or report real external effects.",
            },
          },
          ...context,
        });
        plannerRunId = result.runId;
        if (result.status !== "terminal" && result.status !== "completed")
          return { status: "planner_pending" as const, plannerRunId };
        const proposal = result.structuredOutput as WorldPlannerProposal | undefined;
        if (!proposal)
          throw managementProblem(
            "world.planner_invalid",
            "World planner did not return a validated patch",
            "Inspect the saved actual role result",
            "conflict",
          );
        const patch = {
          ...proposal,
          operationId: uuidv5("world.patch", input.requestId),
          subjectId: input.subjectId,
          worldId: input.worldId,
          expectedRevision: frame.state.revision,
          interval: range,
          events: proposal.events.map((event) => ({
            ...event,
            source: {
              kind: "world_planner" as const,
              producerRef: result.runId,
              sourceRefs: event.source.sourceRefs.filter((ref) =>
                context.sourceRefs.includes(ref),
              ),
            },
          })),
        };
        const realized = await options.worlds.realize(patch);
        perceptibleChanges = [
          ...perceptibleChanges,
          ...realized.events
            .filter((event) =>
              event.perceptions.some(
                (p) => p.actorRef === frame.state.definition.subjectActorRef,
              ),
            )
            .map(
              (event) =>
                `world-event:${input.worldId}:${event.eventId}:${event.revision}`,
            ),
        ];
      }
      if (perceptibleChanges.length)
        await options.wakeSubject({
          subjectId: input.subjectId,
          naturalOpportunity: true,
        });
      const next = await options.worlds.prepareAdvance(input.subjectId, input.worldId);
      const currentActivity = await options.life.get(input.subjectId, input.activityId);
      const candidates = [next.nextOpportunity, currentActivity?.nextOpportunity]
        .filter((point): point is Point =>
          Boolean(
            point &&
            point.timeDomainRef === next.world.timeDomainRef &&
            Date.parse(point.at) > Date.parse(next.world.at),
          ),
        )
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      const nextOpportunity = candidates[0] ?? null;
      await options.scheduleNext({ ...input, next: nextOpportunity });
      return {
        status: "processed" as const,
        plannerRunId,
        progress: advanced.progress,
        perceptibleChanges,
        nextOpportunity,
      };
    },
  };
}
