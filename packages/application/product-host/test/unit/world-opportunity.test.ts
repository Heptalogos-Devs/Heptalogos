// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createWorldOpportunity,
  type WorldOpportunityOptions,
} from "../../src/world-opportunity.js";
describe("world opportunity provider admission boundary", () => {
  it("keeps world events pending until actual Subject contact receipts and excludes unselected visible data", async () => {
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
        state: { revision: 1 },
        world,
        schedule: [
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
    let admitted = false;
    const invoke = vi.fn(async () => ({
      runId: randomUUID(),
      status: "completed",
      text: "continue",
      admitted,
    }));
    const acceptedWorldContact = vi.fn(async () => ({
      contactRef: "contact:accepted",
    }));
    const adoptDeliberation = vi.fn(async () => {}),
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
      releaseWorldContact: async () => ({
        contactRef: "contact:candidate",
        selected: true,
      }),
      acceptedWorldContact,
      adoptDeliberation,
      scheduleNext,
    } as unknown as WorldOpportunityOptions<never, object>;
    const opportunity = createWorldOpportunity(options),
      request = { subjectId, worldId, activityId, requestId: randomUUID() };
    await expect(opportunity.advance(request)).rejects.toMatchObject({
      problem: { problemCode: "world.contact_not_admitted" },
    });
    expect(acknowledgeContact).not.toHaveBeenCalled();
    expect(acceptedWorldContact).not.toHaveBeenCalled();
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("unselected view content");
    admitted = true;
    expect(
      (await opportunity.advance({ ...request, requestId: randomUUID() })).status,
    ).toBe("processed");
    expect(acknowledgeContact).toHaveBeenCalledWith({
      subjectId,
      worldId,
      eventId,
      contactRef: "contact:accepted",
      runId: expect.any(String),
    });
    expect(adoptDeliberation).toHaveBeenCalledOnce();
    expect(scheduleNext).toHaveBeenCalledOnce();
    // An adopted patch remains the paid planner result even when a later frame lacks future slots.
    vi.spyOn(worlds, "readRealization").mockResolvedValue({ operationId: "adopted" });
    const prepared = await worlds.prepareAdvance();
    vi.spyOn(worlds, "prepareAdvance").mockResolvedValue({ ...prepared, schedule: [] });
    invoke.mockClear();
    await opportunity.advance({ ...request, requestId: randomUUID() });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ role: "subject.deliberation" }),
    );
  });
});
