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
type WorldContact = Awaited<ReturnType<Worlds["pendingContacts"]>>[number];
type Point = { timeDomainRef: string; at: string };
type Role = "world.planner" | "subject.deliberation";
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
  readonly releaseWorldContact: (
    input: WorldContact & { subjectId: string; activityId: string },
  ) => Promise<{ contactRef: string; selected: boolean }>;
  /** Maps a world point to a real due instant through the official clock mapping, then replaces the one native life schedule. */
  readonly acceptedWorldContact: (input: {
    runId: string;
    event: WorldContact;
  }) => Promise<{ contactRef: string } | undefined>;
  /** Life/Agency owns actual choices, delegation and expression after the role returns. */
  readonly adoptDeliberation: (input: {
    subjectId: string;
    worldId: string;
    activityId: string;
    requestId: string;
    world: Point;
    run: {
      runId: string;
      text?: string;
      result?: unknown;
      status: string;
      activityRevision?: number;
      deadlineAt?: string;
    };
  }) => Promise<void>;
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
      const selectedRefs: string[] = [];
      const selectedEvents = new Map<string, WorldContact>();
      const pending = await options.worlds.pendingContacts(
        input.subjectId,
        input.worldId,
      );
      for (const event of pending) {
        const selection = await options.releaseWorldContact({
          ...event,
          subjectId: input.subjectId,
          activityId: input.activityId,
        });
        if (!selection.selected) continue;
        selectedRefs.push(event.sourceRef);
        selectedEvents.set(event.eventId, event);
      }
      // A choice or an unset scene needs the world author; ordinary fixed routines do not.
      const needsPlanner =
        !frame.schedule.some(
          (item) => Date.parse(item.interval.start) > Date.parse(end),
        ) ||
        frame.schedule.some(
          (item) =>
            Date.parse(item.interval.end) <= Date.parse(end) &&
            !frame.recentEvents.some(
              (event) => "scheduleId" in event && event.scheduleId === item.scheduleId,
            ),
        );
      let plannerRunId: string | undefined;
      let deadlineAt: string | undefined;
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
        deadlineAt = result.deadlineAt;
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
        for (const event of await options.worlds.pendingContacts(
          input.subjectId,
          input.worldId,
        )) {
          if (selectedEvents.has(event.eventId)) continue;
          const selection = await options.releaseWorldContact({
            ...event,
            subjectId: input.subjectId,
            activityId: input.activityId,
          });
          if (!selection.selected) continue;
          selectedRefs.push(event.sourceRef);
          selectedEvents.set(event.eventId, event);
        }
      }
      const subjectView = await options.worlds.query({
        subjectId: input.subjectId,
        worldId: input.worldId,
        interval: {
          timeDomainRef: frame.world.timeDomainRef,
          start: new Date(Date.parse(end) - 2 * 3600000).toISOString(),
          end,
        },
        view: "subject",
        knowledgeAtWorldTime: frame.world,
        limit: 128,
      });
      const released = await options.worlds.releasedEventIds(
        input.subjectId,
        input.worldId,
        [...new Set(subjectView.events.map((event) => event.eventId))],
      );
      const admittedOrSelected = new Set([...released, ...selectedEvents.keys()]);
      const safeSubjectView = {
        ...subjectView,
        events: subjectView.events.filter((event) =>
          admittedOrSelected.has(event.eventId),
        ),
      };
      const context = await options.contextFor({
        ...input,
        role: "subject.deliberation",
        world: frame.world,
        sourceRefs: selectedRefs,
      });
      const deliberation = await options.invoke({
        ...input,
        requestId: uuidv5("subject.deliberation", input.requestId),
        role: "subject.deliberation",
        deadlineAt,
        context: {
          activity,
          world: frame.world,
          worldSubject: safeSubjectView,
          worldContactCoverage: {
            selectedEvents: selectedEvents.size,
            limited: pending.some((event) => !selectedEvents.has(event.eventId)),
          },
          choices: [
            "continue_activity",
            "observe",
            "defer",
            "decline",
            "ask",
            "communicate",
            "learn",
            "delegate",
            "initiate_activity",
            "rest",
          ],
        },
        ...context,
      });
      if (deliberation.admitted !== true)
        throw managementProblem(
          "world.contact_not_admitted",
          "Subject has not actually perceived these world events",
          "Keep pending until real native consumer admission and accepted contact receipts exist",
          "conflict",
        );
      for (const event of selectedEvents.values()) {
        const receipt = await options.acceptedWorldContact({
          runId: deliberation.runId,
          event,
        });
        if (!receipt)
          throw managementProblem(
            "world.contact_receipt_missing",
            "World perception has no actual accepted contact",
            "Inspect the admitted Subject run receipt and retry its existing handoff",
            "conflict",
          );
        await options.worlds.acknowledgeContact({
          subjectId: input.subjectId,
          worldId: input.worldId,
          eventId: event.eventId,
          contactRef: receipt.contactRef,
        });
      }
      await options.adoptDeliberation({
        ...input,
        world: frame.world,
        run: deliberation,
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
        deliberationRunId: deliberation.runId,
        nextOpportunity,
      };
    },
  };
}
