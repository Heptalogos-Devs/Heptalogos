// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createWorldOpportunity,
  type WorldOpportunityOptions,
} from "../../src/world-opportunity.js";
describe("world realization stays outside the subjective foreground", () => {
  it("notifies the single Reactor without selecting or perceiving world contacts", async () => {
    const subjectId = randomUUID(),
      worldId = randomUUID(),
      activityId = randomUUID(),
      eventId = randomUUID();
    const world = { timeDomainRef: "school", at: "2026-10-16T03:00:00.000Z" };
    const event = {
      sourceRef: `world-event:${worldId}:${eventId}:1`,
      eventId,
      eventRevision: 1,
      worldId,
      interval: {
        timeDomainRef: "school",
        start: "2026-10-16T02:00:00.000Z",
        end: "2026-10-16T02:30:00.000Z",
      },
      recordedAt: "2026-10-16T03:00:00.000Z",
      source: { kind: "rule" as const, producerRef: "rule:actual", sourceRefs: [] },
      perceptions: [
        {
          actorRef: "self",
          kind: "seen" as const,
          at: world,
          content: "I attended class",
        },
      ],
    };
    const acknowledgeContact = vi.fn(async () => ({ contactRef: "contact:accepted" }));
    const worlds = {
      prepareAdvance: async () => ({
        state: { revision: 1, definition: { informationSourceRefs: [] } },
        world,
        schedule: [
          {
            interval: {
              start: "2026-10-16T02:30:00.000Z",
              end: "2026-10-16T03:30:00.000Z",
            },
          },
          {
            interval: {
              start: "2026-10-16T04:00:00.000Z",
              end: "2026-10-16T04:30:00.000Z",
            },
          },
        ],
        recentEvents: [],
        nextOpportunity: { ...world, at: "2026-10-16T04:00:00.000Z" },
      }),
      readRealization: async (): Promise<unknown> => undefined,
      realizationCursor: async () => world,
      advanceRules: vi.fn(),
      completeActions: vi.fn(async () => []),
      pendingContacts: async () => [event],
      releasedEventIds: async () => [],
      query: async () => ({
        revision: 1,
        view: "subject",
        events: [
          { eventId, content: "selected class" },
          { eventId: randomUUID(), content: "unselected view content" },
        ],
      }),
      acknowledgeContact,
    };
    const invoke = vi.fn(async () => {
      throw Error(
        "A preserved world patch or fixed routine must not launch a new paid role",
      );
    });
    const wakeSubject = vi.fn(async () => {}),
      scheduleNext = vi.fn(async () => {});
    const options = {
      worlds,
      life: {
        get: async () => ({
          subjectId,
          activityId,
          world,
          adoptedBy: "self",
          scope: {},
          state: "active",
          continuationRequired: false,
          nextOpportunity: null,
        }),
      },
      enabled: async () => true,
      invoke,
      contextFor: async () => ({
        contacts: [],
        sourceRefs: [event.sourceRef],
        usage: {},
      }),
      wakeSubject,
      scheduleNext,
    } as unknown as WorldOpportunityOptions<never, object>;
    const opportunity = createWorldOpportunity(options),
      request = { subjectId, worldId, activityId, requestId: randomUUID() };
    expect((await opportunity.advance(request)).status).toBe("processed");
    expect(acknowledgeContact).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    expect(wakeSubject).toHaveBeenCalledWith({ subjectId, naturalOpportunity: true });
    expect(scheduleNext).toHaveBeenCalledOnce();
    // A saved paid planner patch never launches another planner when its caller resumes.
    vi.spyOn(worlds, "readRealization").mockResolvedValue({ operationId: "adopted" });
    const prepared = await worlds.prepareAdvance();
    vi.spyOn(worlds, "prepareAdvance").mockResolvedValue({ ...prepared, schedule: [] });
    await opportunity.advance({ ...request, requestId: randomUUID() });
    expect(invoke).not.toHaveBeenCalled();
    expect(acknowledgeContact).not.toHaveBeenCalled();
    // Tomorrow's calendar does not establish today's missing scene.
    vi.spyOn(worlds, "readRealization").mockResolvedValue(undefined);
    vi.spyOn(worlds, "prepareAdvance").mockResolvedValue({
      ...prepared,
      schedule: [
        {
          interval: {
            start: "2026-10-16T04:00:00.000Z",
            end: "2026-10-16T04:30:00.000Z",
          },
        },
      ],
    });
    await expect(
      opportunity.advance({ ...request, requestId: randomUUID() }),
    ).rejects.toThrow("must not launch");
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ role: "world.planner" }),
    );
  });
});
