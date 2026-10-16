// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { createLifeService } from "../../src/life.js";

it("rests without selecting raw inputs, and prevents a continuous fresh stream from starving old pending messages", async () => {
  const life = createLifeService({
    persistence: {} as never,
    now: () => "2026-10-16T01:00:00.000Z",
    worldNow: async () => ({ timeDomainRef: "real", at: "2026-10-16T01:00:00.000Z" }),
    scopeAuthority: async () => ({
      conversations: [],
      tools: [],
      sourceRefs: [],
      maxRunMs: 1000,
    }),
  });
  const candidates = [
    {
      messageRef: "old",
      conversationRef: "qq:old",
      receivedAt: "2026-10-16T00:00:00.000Z",
      direct: false,
      mention: false,
      reply: false,
    },
    {
      messageRef: "new-direct",
      conversationRef: "qq:new",
      receivedAt: "2026-10-16T01:00:00.000Z",
      direct: true,
      mention: false,
      reply: false,
    },
  ];
  const input = {
    subjectId: "00000000-0000-4000-8000-000000000000",
    activityId: null,
    candidates,
    resting: false,
    naturalOpportunity: false,
    maxItems: 1,
    maxWaitMs: 60_000,
  };
  expect((await life.takeAttention({ ...input, resting: true })).messageRefs).toEqual(
    [],
  );
  expect((await life.takeAttention(input)).messageRefs).toEqual(["old"]);
});
