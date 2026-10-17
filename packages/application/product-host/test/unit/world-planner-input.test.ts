// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createWorldRuntime } from "../../src/world-runtime.js";

describe("world planner proposal authority and interval", () => {
  it("passes no tools and the actual elapsed realization range despite future calendar entries", async () => {
    const subjectId = randomUUID(),
      worldId = randomUUID(),
      activityId = randomUUID();
    const domain = `time:world:${worldId}`;
    const world = { timeDomainRef: domain, at: "2026-10-19T03:30:00.000Z" };
    const cursor = { ...world, at: "2026-10-19T01:15:00.000Z" };
    const invoke = vi.fn(async () => {
      throw Error("captured-real-role-input");
    });
    const runtime = createWorldRuntime({
      worlds: {
        completeActions: async () => [],
        prepareAdvance: async () => ({
          world,
          state: { revision: 4, definition: { informationSourceRefs: [] } },
          recentEvents: [],
          schedule: [
            {
              interval: {
                start: "2026-10-20T02:00:00.000Z",
                end: "2026-10-20T02:50:00.000Z",
              },
            },
          ],
        }),
        realizationCursor: async () => cursor,
        advanceRules: async () => {},
        readRealization: async () => undefined,
      },
      life: {
        get: async () => ({
          subjectId,
          activityId,
          world,
          adoptedBy: "self",
          state: "active",
          scope: { sourceRefs: [`world:${worldId}`], tools: ["heptalogos_life"] },
          workContextId: randomUUID(),
        }),
      },
      native: { readDispatch: async () => undefined },
      roles: { invoke },
      enabled: async () => true,
      authorize: async () => {},
      currentSubject: async () => subjectId,
      nous: async () => ({
        runtime: { getWorkContext: async () => ({ workContext: { state: "open" } }) },
      }),
    } as unknown as Parameters<typeof createWorldRuntime>[0]);
    await expect(
      runtime.advance({ subjectId, worldId, activityId, requestId: randomUUID() }),
    ).rejects.toThrow("captured-real-role-input");
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "world.planner",
        taskTools: [],
        context: expect.objectContaining({
          realizationInterval: {
            timeDomainRef: domain,
            start: cursor.at,
            end: world.at,
          },
          outputContract: expect.objectContaining({
            instructions: expect.stringContaining("Future arrangements"),
          }),
        }),
      }),
    );
  });
});
