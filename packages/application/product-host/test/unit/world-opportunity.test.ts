// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createWorldOpportunity } from "../../src/world-opportunity.js";

it("keeps an unchanged autonomous interval free of planner and foreground calls", async () => {
  const subjectId = randomUUID(),
    worldId = randomUUID(),
    activityId = randomUUID();
  const world = { timeDomainRef: "school", at: "2026-10-18T12:00:00.000Z" };
  const nextOpportunity = { ...world, at: "2026-10-18T14:00:00.000Z" };
  const frame = {
    world,
    state: { revision: 1 },
    needsRefinement: false,
    nextOpportunity,
  };
  const invoke = vi.fn(),
    wakeSubject = vi.fn(),
    scheduleNext = vi.fn();
  const opportunity = createWorldOpportunity({
    worlds: {
      advance: async () => ({
        frame,
        interval: { ...world, start: world.at, end: world.at },
        progress: { eventRefs: [], actionRefs: [] },
        perceptibleChanges: [],
      }),
      readRealization: async () => undefined,
      prepareAdvance: async () => frame,
    },
    life: {
      get: async () => ({ adoptedBy: "self", scope: {}, state: "active", world }),
    },
    enabled: async () => true,
    invoke,
    wakeSubject,
    scheduleNext,
  } as unknown as Parameters<typeof createWorldOpportunity>[0]);
  const result = await opportunity.advance({
    subjectId,
    worldId,
    activityId,
    requestId: randomUUID(),
  });
  expect(result).toMatchObject({
    status: "processed",
    perceptibleChanges: [],
    nextOpportunity,
  });
  expect(invoke).not.toHaveBeenCalled();
  expect(wakeSubject).not.toHaveBeenCalled();
  expect(scheduleNext).toHaveBeenCalledWith(
    expect.objectContaining({ next: nextOpportunity }),
  );
});
