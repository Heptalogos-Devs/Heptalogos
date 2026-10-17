// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Consumes a channel-independent world opportunity through the existing native roles.
 * @module world-opportunity
 */
import type { createWorldLifeService, createLifeService } from "@heptalogos/subject";
import { realizeWorldSchema } from "@heptalogos/subject";
import type { Static } from "@heptalogos/schema-runtime/typebox";
import { compileSchema } from "@heptalogos/schema-runtime";
import { managementProblem } from "@heptalogos/management";
import { v5 as uuidv5 } from "uuid";
type Worlds = ReturnType<typeof createWorldLifeService>;
type Point = { timeDomainRef: string; at: string };
type Role = "world.planner";
/** A distant calendar entry does not establish the Subject's present scene. */
export function hasCurrentWorldScene(
  schedule: readonly { interval: { start: string; end: string } }[],
  at: string,
): boolean {
  return schedule.some(
    (item) =>
      Date.parse(item.interval.start) <= Date.parse(at) &&
      Date.parse(item.interval.end) > Date.parse(at),
  );
}
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
    result?: unknown;
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
      await options.worlds.completeActions({
        subjectId: input.subjectId,
        worldId: input.worldId,
        limit: 32,
      });
      let frame = await options.worlds.prepareAdvance(input.subjectId, input.worldId);
      if (activity.world.timeDomainRef !== frame.world.timeDomainRef)
        throw managementProblem(
          "world.time_domain_unavailable",
          "Activity and world cannot be compared",
          "Use the actual adopted world domain",
          "conflict",
        );
      const cursor = await options.worlds.realizationCursor(
        input.subjectId,
        input.worldId,
      );
      const end = frame.world.at;
      const start = new Date(
        Math.max(
          cursor && cursor.timeDomainRef === frame.world.timeDomainRef
            ? Date.parse(cursor.at)
            : Date.parse(end) - 86400000,
          Date.parse(end) - 31 * 86400000,
        ),
      ).toISOString();
      const range = { timeDomainRef: frame.world.timeDomainRef, start, end };
      if (Date.parse(start) < Date.parse(end))
        await options.worlds.advanceRules(input.subjectId, input.worldId, range);
      frame = await options.worlds.prepareAdvance(input.subjectId, input.worldId);
      // A choice or an unset scene needs the world author; ordinary fixed routines do not.
      const needsPlanner =
        !hasCurrentWorldScene(frame.schedule, end) ||
        frame.schedule.some(
          (item) =>
            Date.parse(item.interval.end) <= Date.parse(end) &&
            !frame.recentEvents.some(
              (event) => "scheduleId" in event && event.scheduleId === item.scheduleId,
            ),
        );
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
            outputContract: {
              schema: realizeWorldSchema,
              hostOwnedFields: [
                "operationId",
                "subjectId",
                "worldId",
                "expectedRevision",
                "events[].source.kind",
                "events[].source.producerRef",
              ],
              instructions:
                "Return a WorldPatch with interval, events, coverage and optional replacement schedule for the next 24 world hours. The realized interval must end no later than frame.world; future arrangements belong only in schedule. Only propose compatible virtual events; do not report real external effects. Host identity and actual producer fields are supplied by the Host, never granted by this proposal.",
            },
          },
          ...context,
        });
        plannerRunId = result.runId;
        if (result.status !== "terminal" && result.status !== "completed")
          return { status: "planner_pending" as const, plannerRunId };
        let candidate: unknown = result.result;
        if (result.text) {
          try {
            candidate = JSON.parse(result.text);
          } catch {
            throw managementProblem(
              "world.planner_invalid",
              "World planner did not return a patch",
              "Inspect the saved actual role result",
              "conflict",
            );
          }
        }
        const fields =
          candidate && typeof candidate === "object"
            ? (candidate as Record<string, unknown>)
            : {};
        const patch = {
          ...fields,
          operationId: uuidv5("world.patch", input.requestId),
          subjectId: input.subjectId,
          worldId: input.worldId,
          expectedRevision: frame.state.revision,
        };
        const validation =
          compileSchema<Static<typeof realizeWorldSchema>>(realizeWorldSchema).validate(
            patch,
          );
        if (!validation.ok)
          throw managementProblem(
            "world.planner_invalid",
            "World planner patch is invalid",
            "Inspect the exact world output contract",
            "conflict",
          );
        await options.worlds.realize({
          ...validation.value,
          events: validation.value.events.map((event) => ({
            ...event,
            source: {
              kind: "world_planner" as const,
              producerRef: result.runId,
              sourceRefs: event.source.sourceRefs.filter((ref) =>
                context.sourceRefs.includes(ref),
              ),
            },
          })),
        });
      }
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

        nextOpportunity,
      };
    },
  };
}
