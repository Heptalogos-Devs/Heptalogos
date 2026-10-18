// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createWorldOpportunity } from "../../src/world-opportunity.js";

it("adopts the parsed role result with actual world identity and notifies its new perception", async () => {
  const subjectId = randomUUID(),
    worldId = randomUUID(),
    activityId = randomUUID(),
    eventId = randomUUID();
  const world = { timeDomainRef: "school", at: "2026-10-19T03:30:00.000Z" };
  const interval = {
    timeDomainRef: world.timeDomainRef,
    start: "2026-10-19T03:00:00.000Z",
    end: world.at,
  };
  const frame = {
    world,
    state: {
      revision: 7,
      definition: { subjectActorRef: "self", informationSourceRefs: [] },
    },
    needsRefinement: true,
    recentEvents: [],
    nextOpportunity: null,
  };
  const event = {
    eventId,
    interval,
    source: { sourceRefs: [] },
    perceptions: [{ actorRef: "self" }],
  };
  const realize = vi.fn(async () => ({ events: [{ ...event, revision: 1 }] }));
  const wakeSubject = vi.fn(),
    runId = randomUUID();
  const opportunity = createWorldOpportunity({
    worlds: {
      advance: async () => ({
        frame,
        interval,
        progress: { eventRefs: [], actionRefs: [] },
        perceptibleChanges: [],
      }),
      prepareAdvance: async () => frame,
      readRealization: async () => undefined,
      realize,
    },
    life: {
      get: async () => ({ adoptedBy: "self", scope: {}, state: "active", world }),
    },
    enabled: async () => true,
    invoke: async () => ({
      runId,
      text: "Original role output retained by RoleExecution",
      structuredOutput: { events: [event], coverage: "limited" },
      status: "completed",
      admitted: true,
    }),
    contextFor: async () => ({ contacts: [], sourceRefs: [], usage: {} }),
    wakeSubject,
    scheduleNext: async () => {},
  } as unknown as Parameters<typeof createWorldOpportunity>[0]);
  await opportunity.advance({
    subjectId,
    worldId,
    activityId,
    requestId: randomUUID(),
  });
  expect(realize).toHaveBeenCalledWith(
    expect.objectContaining({
      subjectId,
      worldId,
      expectedRevision: 7,
      interval,
      events: [
        expect.objectContaining({
          source: { kind: "world_planner", producerRef: runId, sourceRefs: [] },
        }),
      ],
    }),
  );
  expect(wakeSubject).toHaveBeenCalledWith({ subjectId, naturalOpportunity: true });
});
