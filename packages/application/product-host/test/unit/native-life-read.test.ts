// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { encodeProjection } from "@nous-wave/client/host-bridge";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  createBoundLifeReader,
  type BoundLifeReadBinding,
} from "../../src/native-life-read.js";
import {
  nativeLifeReadActionSchema,
  type NativeLifeReadAction,
} from "../../src/native-life-contracts.js";
describe("actual bound native life reads", () => {
  it("returns only known or actually admitted Subject-visible events and pins claims to the caller's actual audience", async () => {
    const subjectId = randomUUID(),
      worldId = randomUUID(),
      activityId = randomUUID(),
      knownId = randomUUID(),
      pendingId = randomUUID();
    const audience = "conversation:heptalogos:" + randomUUID();
    const root = `world:${worldId}`,
      pendingRef = `world-event:${worldId}:${pendingId}:1`;
    const interval = {
      timeDomainRef: "school",
      start: "2026-10-16T00:00:00Z",
      end: "2026-10-16T01:00:00Z",
    };
    const query = vi.fn(async (_input: unknown) => ({
      view: "subject",
      revision: 1,
      nextEventId: null,
      events: [
        { eventId: knownId, eventRevision: 1, content: "Known math class" },
        { eventId: pendingId, eventRevision: 1, content: "Pending new scene" },
      ],
    }));
    const claimsTo = vi.fn(async (_input: unknown) => ({
      more: false,
      claims: [
        { claimId: knownId, conversationRef: audience, content: "I was in class" },
        {
          claimId: pendingId,
          conversationRef: "private:another-audience",
          content: "Private different account statement",
        },
      ],
    }));
    const explainStatement = vi.fn(async (_subject: string, _message: string) => ({
      claims: [
        {
          claimId: knownId,
          conversationRef: audience,
          content: "Same platform id in this audience",
        },
        {
          claimId: pendingId,
          conversationRef: "private:another-audience",
          content: "Do not reveal",
        },
      ],
    }));
    const read = createBoundLifeReader({
      worlds: {
        query,
        resolveSourceRefs: async (input: { sourceRefs: readonly string[] }) => [
          ...input.sourceRefs,
        ],
        releasedEventIds: async () => [knownId],
      },
      narrative: { claimsTo, explainStatement },
      messaging: {
        messageSources: vi.fn(async () => ({
          sources: [
            {
              messageRef: knownId,
              conversationId: audience.slice("conversation:heptalogos:".length),
              lifecycle: "present",
            },
          ],
        })),
        prepareRead: vi.fn(async () => ({
          materials: [
            {
              messageId: knownId,
              conversationId: audience.slice("conversation:heptalogos:".length),
              nativeMessageId: "actual-native-platform-id",
            },
          ],
          omitted: [],
        })),
      },
    } as unknown as Parameters<typeof createBoundLifeReader>[0]);
    const binding: BoundLifeReadBinding = {
      subjectId,
      activityId,
      nativeRunId: "native:actual-running",
      role: "subject.deliberation",
      sourceRefs: [root],
      audienceConversationRef: audience,
      world: { timeDomainRef: "school", at: interval.end },
    };
    const action: NativeLifeReadAction = { action: "lifeAt", worldId, interval };
    const history = await read(binding, action);
    expect(JSON.stringify(history)).toContain("Known math class");
    expect(JSON.stringify(history)).not.toContain("Pending new scene");
    expect(query.mock.calls[0]?.[0]).toMatchObject({
      subjectId,
      worldId,
      view: "subject",
    });
    expect(
      JSON.stringify(
        await read({ ...binding, sourceRefs: [root, pendingRef] }, action),
      ),
    ).toContain("Pending new scene");
    const claims = await read(binding, { action: "claimsTo" });
    expect(JSON.stringify(claims)).not.toContain("Private different account");
    expect(claimsTo.mock.calls[0]?.[0]).toMatchObject({
      subjectId,
      conversationRef: audience,
    });
    expect(
      JSON.stringify(
        await read(binding, {
          action: "explainStatement",
          messageRef: "platform-lossless-id",
        }),
      ),
    ).not.toContain("Do not reveal");
    await read(binding, {
      action: "explainStatement",
      messageRef: `message:${knownId}`,
    });
    expect(explainStatement.mock.calls.at(-1)).toEqual([
      subjectId,
      "actual-native-platform-id",
    ]);
    await expect(
      read({ ...binding, audienceConversationRef: undefined }, { action: "claimsTo" }),
    ).rejects.toMatchObject({ problem: { problemCode: "life.scope_denied" } });
    expect(
      compileSchema<NativeLifeReadAction>(nativeLifeReadActionSchema).validate({
        action: "claimsTo",
        audience: "model-forged-audience",
      }).ok,
    ).toBe(false);
  });
  it("uses only the exact admitted epistemic snapshot and refuses a different Subject", async () => {
    const binding: BoundLifeReadBinding = {
      subjectId: randomUUID(),
      activityId: randomUUID(),
      nativeRunId: "native:actual",
      role: "subject.deliberation",
      sourceRefs: [],
      world: { timeDomainRef: "school", at: "2026-10-16T01:00:00Z" },
    };
    const read = createBoundLifeReader({
      worlds: {},
      narrative: {},
      messaging: {},
    } as unknown as Parameters<typeof createBoundLifeReader>[0]);
    expect((await read(binding, { action: "epistemic" })).data.available).toBe(false);
    const projection = encodeProjection({
      subjectId: randomUUID(),
      projectionId: "actual-projection",
    });
    await expect(
      read({ ...binding, admittedProjection: projection }, { action: "epistemic" }),
    ).rejects.toMatchObject({ problem: { problemCode: "life.scope_denied" } });
  });
});
