// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from "vitest";
import { selectNativeOpportunity } from "../../src/native-dispatch.js";
import { v5 as uuidv5 } from "uuid";
import { ROLE_PROMPTS } from "../../src/role-prompts.js";
import { createWorldRuntime } from "../../src/world-runtime.js";

const subjectId = "10000000-0000-4000-8000-000000000001";
const worldId = "10000000-0000-4000-8000-000000000002";
const activityId = "10000000-0000-4000-8000-000000000003";
const domain = `time:world:${worldId}`;
const at = "2026-10-19T01:30:00.000Z";
const point = { timeDomainRef: domain, at };

describe("one native opportunity projection", () => {
  it("preserves the world callback when world work is earliest or tied", () => {
    const world = {
      subjectId,
      worldId,
      activityId,
      realAt: at,
      requestId: "world-request",
    };
    const foreground = { subjectId, realAt: at, requestId: "reactor-request" };
    expect(selectNativeOpportunity(world, foreground)).toBe(world);
    expect(
      selectNativeOpportunity(world, {
        ...foreground,
        realAt: "2026-10-19T01:31:00.000Z",
      }),
    ).toBe(world);
    expect(selectNativeOpportunity(world, { ...foreground, realAt: null })).toBe(world);
    const earlier = { ...foreground, realAt: "2026-10-19T01:29:00.000Z" };
    expect(selectNativeOpportunity(world, earlier)).toBe(earlier);
    expect(selectNativeOpportunity(null, foreground)).toBe(foreground);
  });
  it("returns the due world's identity without writing a competing native declaration", async () => {
    const reproject = vi.fn(async () => {});
    let initialSettled = true;
    let pending = true;
    let currentScene = false;
    const future = { ...point, at: "2026-10-19T02:30:00.000Z" };
    const runtime = createWorldRuntime({
      worlds: {
        prepareAdvance: async () => ({
          world: point,
          schedule: [
            ...(currentScene
              ? [
                  {
                    interval: {
                      start: "2026-10-19T01:00:00.000Z",
                      end: "2026-10-19T02:00:00.000Z",
                    },
                  },
                ]
              : []),
            { interval: { start: future.at, end: "2026-10-19T03:00:00.000Z" } },
          ],
          nextOpportunity: future,
        }),
        readRealization: async () =>
          initialSettled ? { operationId: "settled-initial-scene" } : undefined,
        readPendingActions: async () => (pending ? [{ nextOpportunity: point }] : []),
      },
      life: {
        schedule: async () => ({
          activities: [
            { subjectId, activityId, scope: { sourceRefs: [`world:${worldId}`] } },
          ],
          nextId: null,
        }),
      },
      currentSubject: async () => subjectId,
      enabled: async () => true,
      authorize: async () => {},
      nous: async () => ({
        clocks: {
          readClock: async () => ({
            rate: 1,
            revision: 1n,
            timeDomainRef: domain,
            now: {
              timeDomainRef: domain,
              at: { seconds: BigInt(Date.parse(at) / 1000), nanos: 0 },
              recordedAt: { seconds: BigInt(Date.parse(at) / 1000), nanos: 0 },
            },
          }),
        },
      }),
      reproject,
      now: () => at,
    } as unknown as Parameters<typeof createWorldRuntime>[0]);
    const projection = await runtime.nextOpportunity();
    expect(projection).toMatchObject({
      subjectId,
      worldId,
      activityId,
      realAt: "2026-10-19T01:30:01.000Z",
    });
    expect(projection?.requestId).toBeTypeOf("string");
    expect(await runtime.nextOpportunity()).toEqual(projection);
    pending = false;
    initialSettled = false;
    const initial = await runtime.nextOpportunity();
    expect(initial).toMatchObject({
      subjectId,
      worldId,
      activityId,
      realAt: "2026-10-19T01:30:01.000Z",
    });
    expect(initial?.requestId).not.toBe(projection?.requestId);
    expect(initial?.requestId).toBe(
      uuidv5("initial-world-opportunity:" + ROLE_PROMPTS["world.planner"].id, worldId),
    );
    expect(initial?.requestId).not.toBe(uuidv5("initial-world-opportunity", worldId));
    // A pending/failed attempt has no receipt: the same identity is retained.
    expect(await runtime.nextOpportunity()).toEqual(initial);
    currentScene = true;
    expect(await runtime.nextOpportunity()).toMatchObject({ realAt: future.at });
    currentScene = false;
    initialSettled = true;
    expect(await runtime.nextOpportunity()).toMatchObject({ realAt: future.at });
    expect(reproject).not.toHaveBeenCalled();
  });
});
