// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createWorldOpportunity } from "../../src/world-opportunity.js";

describe("world planner proposal adoption", () => {
  it("binds the actual Host identity and elapsed interval before canonical validation", async () => {
    const subjectId = randomUUID(),
      worldId = randomUUID(),
      activityId = randomUUID();
    const domain = `time:world:${worldId}`;
    const frame = {
      world: { timeDomainRef: domain, at: "2026-10-19T03:30:00.000Z" },
      state: { revision: 7, definition: { informationSourceRefs: [] } },
      recentEvents: [],
      schedule: [],
      nextOpportunity: null,
    };
    const realize = vi.fn();
    const opportunity = createWorldOpportunity({
      worlds: {
        completeActions: async () => [],
        prepareAdvance: async () => frame,
        realizationCursor: async () => ({
          timeDomainRef: domain,
          at: "2026-10-19T01:15:00.000Z",
        }),
        advanceRules: async () => {},
        readRealization: async () => undefined,
        realize,
      },
      life: {
        get: async () => ({
          subjectId,
          activityId,
          adoptedBy: "self",
          scope: {},
          state: "active",
          world: frame.world,
        }),
      },
      enabled: async () => true,
      invoke: async () => ({
        runId: randomUUID(),
        text: JSON.stringify({ events: [], coverage: "limited" }),
        status: "completed",
        admitted: true,
      }),
      contextFor: async () => ({ contacts: [], sourceRefs: [], usage: {} }),
      wakeSubject: async () => {},
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
        events: [],
        coverage: "limited",
        interval: {
          timeDomainRef: domain,
          start: "2026-10-19T01:15:00.000Z",
          end: frame.world.at,
        },
      }),
    );
  });
});
