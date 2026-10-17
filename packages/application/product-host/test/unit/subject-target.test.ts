// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { decodeCognitionUsage } from "@nous-wave/client/host-bridge";
import { describe, expect, it, vi } from "vitest";
import type { SituationFrame, SituationObject } from "@heptalogos/subject";
import { resolveSituationTarget } from "../../src/subject-target.js";
import { createSubjectReactor } from "../../src/subject-reactor.js";
import { createSubjectSituationRuntime } from "../../src/subject-situation.js";
const conversationRef = "conversation:heptalogos:01a142a0-7f48-7151-b028-073acc90d80f";
const conversation: SituationObject = {
  handle: "object:" + randomUUID(),
  owner: "messaging",
  kind: "conversation",
  sourceRef: conversationRef,
  sourceRevision: "directory",
  label: "Granted test group",
  state: "available",
  actions: ["inspect", "open", "communicate"],
};
function frame(objects = [conversation]): SituationFrame {
  return {
    subjectId: randomUUID(),
    activityId: randomUUID(),
    reactionId: randomUUID(),
    focusRevision: 1,
    frameRef: "situation:current",
    world: { timeDomainRef: "time:real", at: "2026-10-17T05:15:59.828Z" },
    currentActivityRefs: [],
    objects,
    remainingSteps: 8,
    deadlineAt: "2026-10-17T05:18:59.828Z",
  };
}
describe("one current Situation target resolver", () => {
  it("resolves the actual failed open/public-conversation decision to the same object as its handle", () => {
    const view = frame();
    expect(resolveSituationTarget(view, { action: "open" }).problem).toContain(
      "target_required",
    );
    for (const target of [conversationRef, conversation.handle])
      expect(resolveSituationTarget(view, { action: "open", target })).toEqual({
        object: conversation,
      });
    for (const target of [
      "conversation:unseen",
      conversationRef + "," + conversation.handle,
      "测试群",
    ])
      expect(
        resolveSituationTarget(view, { action: "open", target }).problem,
      ).toContain("target_not_visible");
    expect(
      resolveSituationTarget(view, { action: "move", target: conversationRef }).problem,
    ).toContain("action_unavailable");
  });
  it("bounds failure feedback to directory metadata without echoing an unknown target body", () => {
    const value = { ...conversation, handle: "object:" + "h".repeat(2040) };
    const view = frame(Array.from({ length: 128 }, () => value));
    const problem = resolveSituationTarget(view, {
      action: "open",
      target: "unlisted-private-text".repeat(90),
    }).problem!;
    expect(problem.length).toBeLessThan(1900);
    expect(problem).not.toContain("unlisted-private-text");
    expect(problem).not.toContain(conversation.label);
    expect(JSON.parse(problem).choices).toHaveLength(0);
  });
  it("uses the current duplicate projection without merging affordances, and rejects distinct-owner/object ambiguity", () => {
    const current = {
      ...conversation,
      handle: "object:current",
      sourceRevision: "current",
      actions: ["inspect"] as SituationObject["actions"],
    };
    const view = { ...frame([conversation, current]), currentHandle: current.handle };
    expect(
      resolveSituationTarget(view, { action: "inspect", target: conversationRef }),
    ).toEqual({ object: current });
    expect(
      resolveSituationTarget(view, { action: "communicate", target: conversationRef })
        .problem,
    ).toContain("action_unavailable");
    expect(
      resolveSituationTarget(frame([conversation, current]), {
        action: "open",
        target: conversationRef,
      }),
    ).toEqual({ object: conversation });
    for (const other of [
      { ...current, owner: "world" as const },
      { ...current, kind: "notification" as const },
    ])
      expect(
        resolveSituationTarget(frame([conversation, other]), {
          action: "inspect",
          target: conversationRef,
        }).problem,
      ).toContain("target_ambiguous");
    expect(
      resolveSituationTarget(frame(), { action: "open", target: "object:expired" })
        .problem,
    ).toContain("target_not_visible");
  });
  it.each([true, false])(
    "routes actual public-reference choices to the existing action owner (visible=%s)",
    async (visible) => {
      const view = frame();
      const reaction = {
        ...view,
        state: "active",
        stepCount: 0,
        startedAt: view.world.at,
        policy: {
          maxInteractionSteps: 8,
          reactionDeadlineMs: 180000,
          workerConcurrency: 2,
        },
        candidate: { candidateRef: "notice:current", priorityClass: "direct" },
      };
      const act = vi.fn(async (_input: unknown) => ({
        state: "completed",
        resultRefs: [],
        continuationRef: "activity:continued",
        yield: true,
      }));
      const saveContinuation = vi.fn(async (_input: unknown) => "activity:continued");
      const target = visible
        ? conversationRef
        : "conversation:not-in-current-directory";
      const adopt = vi.fn(async () => ({
        decisionId: randomUUID(),
        decision: { action: "open", target },
      }));
      const app = createSubjectReactor({
        foreground: {
          current: async () => reaction,
          lastAction: async () => undefined,
          bindRun: vi.fn(),
          settleRun: vi.fn(),
          yield: vi.fn(),
          beginAction: async () => ({
            claimed: true,
            receipt: { reactionId: reaction.reactionId },
          }),
          finishAction: async () => ({
            state: "completed",
            action: { action: "open", target },
          }),
        },
        attention: { select: async () => ({ candidates: [] }) },
        readActivity: async () => ({
          state: "active",
          continuationRequired: false,
          scope: {},
          adoptedBy: "actual:actor",
        }),
        roles: {
          invoke: async () => ({
            text: JSON.stringify({ action: "open", target, reason: "查看实际动画" }),
          }),
        },
        decisions: { adopt },
        enabled: async () => true,
        now: () => view.world.at,
        prepare: async () => ({
          frame: view,
          contacts: [],
          sourceRefs: [],
          candidates: [],
          context: {},
          usage: {},
        }),
        act,
        saveContinuation,
        afterYield: vi.fn(),
      } as unknown as Parameters<typeof createSubjectReactor>[0]);
      await app.wake({ subjectId: view.subjectId });
      if (visible) {
        expect(act).toHaveBeenCalledOnce();
        expect(act.mock.calls[0]?.[0]).toMatchObject({ object: conversation });
        expect(adopt).toHaveBeenCalledOnce();
      } else {
        expect(act).not.toHaveBeenCalled();
        expect(adopt).not.toHaveBeenCalled();
        expect(saveContinuation.mock.calls[0]?.[0]).toMatchObject({
          reason: expect.stringContaining('"code":"target_not_visible"'),
        });
        expect(saveContinuation.mock.calls[0]?.[0]).toMatchObject({
          reason: expect.stringContaining('"choices"'),
        });
      }
    },
  );
  it("keeps the adopted Task identity, WorkContext, purpose and exact scope through open, prepare and read without a magic audience constraint", async () => {
    const initial = frame(),
      messageId = randomUUID(),
      workContextId = randomUUID();
    const activity = {
      activityId: initial.activityId,
      subjectId: initial.subjectId,
      revision: 1,
      state: "active",
      adoptedBy: "actual:actor",
      workContextId,
      sourceRefs: ["message:" + messageId],
      purpose: "View only this exact animation and reply once",
      scope: {
        conversations: [{ conversationRef, operations: ["observe", "send"] }],
        sourceRefs: ["message:" + messageId],
        tools: [],
        maxRunMs: 600000,
      },
    };
    const snapshot = structuredClone(activity);
    const resolveActivity = vi.fn(async (_candidate: unknown) => {
      throw Error("must not replace the Task");
    });
    const material = {
      contacts: [],
      sourceRefs: ["message:" + messageId],
      messageRefs: [messageId],
      usage: {},
      context: {},
    };
    const prepareRead = vi.fn(async (_input: unknown) => material);
    const reaction = {
      ...initial,
      stepCount: 0,
      candidate: {
        subjectId: initial.subjectId,
        sourceOwner: "cognition",
        candidateRef: "current",
        sourceRevision: "1",
      },
      policy: { maxInteractionSteps: 8 },
    };
    const candidate = {
      subjectId: initial.subjectId,
      sourceOwner: "messaging",
      candidateRef: "notice:exact",
      sourceRevision: "1",
      sourceRef: "message:" + messageId,
      kind: "message",
      metadata: {
        label: "One unread message",
        conversationRef,
        messageRefs: [messageId],
      },
    };
    const messageSources = vi.fn(async (_input: unknown) => ({
      sources: [
        {
          messageRef: messageId,
          conversationId: conversationRef.slice("conversation:heptalogos:".length),
          lifecycle: "present",
        },
      ],
    }));
    const runtime = createSubjectSituationRuntime({
      life: { get: async () => activity, worldNow: async () => initial.world },
      settings: async () => ({
        subject: {},
        qq: {
          accountId: "bot",
          conversations: [
            {
              receive: true,
              observe: true,
              kind: "group",
              conversationId: "1101497265",
            },
          ],
        },
      }),
      messaging: {
        messageSources,
        notices: async () => ({
          notices: [{ messageRef: "neighbor-unread-not-adopted" }],
        }),
        resolveConversations: async () => ({
          conversationIds: [conversationRef.slice("conversation:heptalogos:".length)],
        }),
      },
      resolveActivity,
      foreground: { current: async () => reaction },
      native: {
        readyResults: async () => ({ runs: [] }),
        readTaskPerceptions: async () => ({
          sourceRefs: [],
          accepted: [],
          cognitionRefs: [],
        }),
      },
      activities: { prepare: prepareRead },
      now: () => initial.world.at,
      nous: async () => ({
        runtime: {
          getWorkContext: async () => ({
            workContext: {
              subjectId: initial.subjectId,
              workContextId,
              state: "open",
              constraints: { conversation_ref: conversationRef },
            },
          }),
        },
      }),
    } as unknown as Parameters<typeof createSubjectSituationRuntime>[0]);
    const prepared = await runtime.prepare({
      reaction,
      candidates: [],
    } as unknown as Parameters<typeof runtime.prepare>[0]);
    expect(decodeCognitionUsage(prepared.usage).audience?.conversationRef).toBe(
      conversationRef,
    );
    expect(messageSources.mock.calls[0]?.[0]).toEqual({
      messageRefs: [messageId],
      conversationIds: [conversationRef.slice("conversation:heptalogos:".length)],
    });
    expect(
      prepared.frame.objects.find((object) => object.sourceRef === candidate.sourceRef),
    ).toMatchObject({ kind: "message", state: "available", actions: ["read"] });
    const inspected = await runtime.act({
      reaction,
      frame: prepared.frame,
      adopted: { decisionId: randomUUID(), decision: { action: "inspect" } },
      view: prepared,
      actionId: randomUUID(),
    } as unknown as Parameters<typeof runtime.act>[0]);
    expect(
      inspected.view?.candidates.some(
        (value) => value.sourceRef === "message:neighbor-unread-not-adopted",
      ),
    ).toBe(false);
    const opened = await runtime.act({
      reaction,
      frame: prepared.frame,
      object: resolveSituationTarget(prepared.frame, {
        action: "open",
        target: conversationRef,
      }).object!,
      adopted: {
        decisionId: randomUUID(),
        decision: { action: "open", target: conversationRef },
      },
      view: prepared,
      actionId: randomUUID(),
    } as unknown as Parameters<typeof runtime.act>[0]);
    expect(opened).toMatchObject({
      state: "completed",
      yield: false,
      resultRefs: [conversationRef, "activity:" + activity.activityId],
    });
    const afterOpen = await runtime.prepare({
      reaction,
      candidates: [],
      lastAction: {
        state: "completed",
        action: { action: "open", target: conversationRef },
        resultRefs: opened.resultRefs,
      },
    } as unknown as Parameters<typeof runtime.prepare>[0]);
    expect(afterOpen.frame.activityId).toBe(activity.activityId);
    expect(afterOpen.frame.currentHandle).toBe(
      afterOpen.frame.objects.find((object) => object.sourceRef === conversationRef)
        ?.handle,
    );
    expect(decodeCognitionUsage(afterOpen.usage).audience?.conversationRef).toBe(
      conversationRef,
    );
    const read = await runtime.act({
      reaction,
      frame: afterOpen.frame,
      object: afterOpen.frame.objects.find(
        (object) => object.sourceRef === candidate.sourceRef,
      ),
      adopted: {
        decisionId: randomUUID(),
        decision: { action: "read", target: candidate.sourceRef },
      },
      view: afterOpen,
      actionId: randomUUID(),
    } as unknown as Parameters<typeof runtime.act>[0]);
    expect(read.state).toBe("completed");
    expect(prepareRead.mock.calls[0]?.[0]).toMatchObject({
      subjectId: activity.subjectId,
      activityId: activity.activityId,
      conversationRef,
      messageRefs: [messageId],
    });
    expect(read.view?.sourceRefs).toEqual(activity.scope.sourceRefs);
    await expect(
      runtime.act({
        reaction,
        frame: afterOpen.frame,
        object: {
          ...conversation,
          kind: "notification",
          sourceRef: "message:neighbor",
          sourceRevision: "1",
        },
        adopted: { decisionId: randomUUID(), decision: { action: "read" } },
        view: {
          ...afterOpen,
          candidates: [
            {
              ...candidate,
              sourceRef: "message:neighbor",
              metadata: { ...candidate.metadata, messageRefs: ["neighbor"] },
            },
          ],
        },
        actionId: randomUUID(),
      } as unknown as Parameters<typeof runtime.act>[0]),
    ).rejects.toThrow("Choose only this Task's explicitly adopted message materials");
    expect(prepareRead).toHaveBeenCalledOnce();
    expect(resolveActivity).not.toHaveBeenCalled();
    expect(activity).toEqual(snapshot);
    activity.scope.conversations.push({
      conversationRef: "conversation:heptalogos:" + randomUUID(),
      operations: ["observe"],
    });
    const unopened = await runtime.prepare({
      reaction,
      candidates: [],
    } as unknown as Parameters<typeof runtime.prepare>[0]);
    expect(decodeCognitionUsage(unopened.usage).audience?.visibility).toBe("internal");
    const openedAgain = await runtime.prepare({
      reaction,
      candidates: [],
      lastAction: {
        state: "completed",
        action: { action: "open", target: conversationRef },
        resultRefs: opened.resultRefs,
      },
    } as unknown as Parameters<typeof runtime.prepare>[0]);
    expect(decodeCognitionUsage(openedAgain.usage).audience?.conversationRef).toBe(
      conversationRef,
    );
  });
  it("rejects a current Task's missing observe grant and uses the separate resolver only for a truly different audience", async () => {
    const view = frame();
    const activity = {
      activityId: view.activityId,
      subjectId: view.subjectId,
      state: "active",
      adoptedBy: "actual:actor",
      workContextId: randomUUID(),
      scope: {
        conversations: [{ conversationRef, operations: ["send"] }],
        sourceRefs: [],
        tools: [],
      },
    };
    const resolveActivity = vi.fn(async (_candidate: unknown) => {
      throw Error("separate audience resolver");
    });
    const runtime = createSubjectSituationRuntime({
      life: { get: async () => activity },
      settings: async () => ({
        subject: {},
        qq: {
          accountId: "bot",
          conversations: [
            {
              receive: true,
              observe: true,
              kind: "group",
              conversationId: "1101497265",
            },
          ],
        },
      }),
      messaging: {
        resolveConversations: async () => ({
          conversationIds: [conversationRef.slice("conversation:heptalogos:".length)],
        }),
      },
      resolveActivity,
      now: () => view.world.at,
    } as unknown as Parameters<typeof createSubjectSituationRuntime>[0]);
    const input = {
      reaction: { subjectId: view.subjectId, activityId: view.activityId },
      frame: view,
      object: conversation,
      adopted: {
        decisionId: randomUUID(),
        decision: { action: "open", target: conversationRef },
      },
      view: { candidates: [] },
      actionId: randomUUID(),
    } as unknown as Parameters<typeof runtime.act>[0];
    await expect(runtime.act(input)).rejects.toThrow(
      "The current Activity does not permit observing this conversation",
    );
    expect(resolveActivity).not.toHaveBeenCalled();
    activity.scope.conversations = [];
    await expect(runtime.act(input)).rejects.toThrow("separate audience resolver");
    expect(resolveActivity.mock.calls[0]?.[0]).toMatchObject({
      metadata: { conversationRef },
    });
  });
  it("advertises communication only for the current conversation's send grant", async () => {
    const view = frame();
    const water = "conversation:heptalogos:" + randomUUID();
    const activity = {
      activityId: view.activityId,
      subjectId: view.subjectId,
      revision: 1,
      sourceRefs: [],
      purpose: "Read only the exact granted materials",
      workContextId: randomUUID(),
      scope: {
        conversations: [
          { conversationRef, operations: ["observe", "send"] },
          { conversationRef: water, operations: ["observe"] },
        ],
        sourceRefs: [],
      },
    };
    const runtime = createSubjectSituationRuntime({
      native: {
        readTaskPerceptions: async () => ({
          sourceRefs: [],
          accepted: [],
          cognitionRefs: [],
        }),
      },
      life: { get: async () => activity, worldNow: async () => view.world },
      settings: async () => ({ subject: {} }),
      nous: async () => ({
        runtime: {
          getWorkContext: async () => ({
            workContext: {
              subjectId: view.subjectId,
              workContextId: activity.workContextId,
              state: "open",
              constraints: {},
            },
          }),
        },
      }),
    } as unknown as Parameters<typeof createSubjectSituationRuntime>[0]);
    const actual = await runtime.prepare({
      reaction: {
        ...view,
        stepCount: 0,
        candidate: {
          subjectId: view.subjectId,
          sourceOwner: "cognition",
          candidateRef: "current",
          sourceRevision: "1",
        },
        policy: { maxInteractionSteps: 8 },
      },
      candidates: [],
    } as unknown as Parameters<typeof runtime.prepare>[0]);
    expect(
      actual.frame.objects.find((object) => object.sourceRef === conversationRef)
        ?.actions,
    ).toContain("communicate");
    const observed = actual.frame.objects.find((object) => object.sourceRef === water)!;
    expect(observed.actions).toEqual(["inspect", "open"]);
    expect(
      resolveSituationTarget(actual.frame, { action: "communicate", target: water })
        .problem,
    ).toContain("action_unavailable");
  });
});
