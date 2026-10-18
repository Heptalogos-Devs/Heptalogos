// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encodeProjection, encodeCognitionUsage } from "@nous-wave/client/host-bridge";
import { createSubjectDecisionHandler } from "../../src/subject-decisions.js";
import { createSubjectReactor } from "../../src/subject-reactor.js";
function expressionFixture() {
  const subjectId = randomUUID(),
    activityId = randomUUID(),
    runId = randomUUID(),
    conversationRef = "conversation:heptalogos:" + randomUUID();
  const work = "work_context:" + randomUUID();
  const saveBrief = vi.fn(),
    invoke = vi.fn();
  const briefForRun = vi.fn(async () => undefined);
  const rejectionForRun = vi.fn(
    async (): Promise<
      { activityId: string; problem: { code: string; detail: string } } | undefined
    > => undefined,
  );
  const handler = createSubjectDecisionHandler({
    native: {
      readRun: async () => ({
        consumerId: "consumer:openclaw:subject",
        registration: {
          subjectId,
          activityId,
          actorEntityRef: "entity:actual",
          sourceRefs: [],
        },
      }),
      readAppliedContext: async () => ({
        usage: encodeCognitionUsage({
          audience: { conversationRef, visibility: "group" },
        }),
        projection: encodeProjection({
          subjectId,
          epistemicView: {},
          segments: [
            {
              sourceRefs: [
                { kind: "work_context", value: work.slice("work_context:".length) },
              ],
            },
          ],
        }),
      }),
    },
    narrative: {
      briefForRun,
      saveBrief,
      rejectionForRun,
      prepareExpression: async () => saveBrief.mock.calls[0]?.[0],
    },
    now: () => "2026-10-17T06:00:00.000Z",
    roles: { invoke },
    deliveryFor: async () => ({ conversationRef }),
  } as unknown as Parameters<typeof createSubjectDecisionHandler>[0]);
  const input = {
    subjectId,
    activityId,
    adopted: {
      subjectId,
      activityId,
      sourceRunId: runId,
      decisionRef: "decision:actual",
      decision: {
        expressionIntent: { cognitionRefs: ["cognition:subject_deliberation"] },
      },
    },
    run: { runId, deadlineAt: "2026-10-17T06:03:00.000Z" },
  } as unknown as Parameters<typeof handler.express>[0];
  return { handler, input, saveBrief, invoke, briefForRun, work, rejectionForRun };
}
describe("known pre-effect expression rejection", () => {
  it("returns the real invalid-cognition problem and exact admitted references without creating a brief or renderer", async () => {
    const f = expressionFixture();
    const value = await f.handler.express(f.input);
    expect(value.expression).toEqual({
      state: "rejected",
      problem: {
        code: "subject.expression_source_denied",
        detail: expect.stringContaining("empty cognitionRefs"),
        availableCognitionRefs: [f.work],
      },
    });
    expect(f.saveBrief).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("recovers only a durable owner-certified no-commit Narrative rejection across a failed native callback", async () => {
    const f = expressionFixture();
    f.input.adopted.decision.expressionIntent!.cognitionRefs = [f.work];
    f.invoke.mockRejectedValueOnce(Error("native callback unavailable"));
    const problem = {
      code: "narrative.review_source_denied",
      detail: "No Narrative or Agency commit; use the adopted brief's exact sources.",
    };
    f.rejectionForRun.mockResolvedValueOnce({
      activityId: f.input.activityId,
      problem,
    });
    expect((await f.handler.express(f.input)).expression).toEqual({
      state: "rejected",
      problem,
    });
    expect(f.saveBrief).toHaveBeenCalledOnce();
    expect(f.invoke).toHaveBeenCalledOnce();
    const unknown = expressionFixture();
    unknown.input.adopted.decision.expressionIntent!.cognitionRefs = [unknown.work];
    unknown.invoke.mockRejectedValueOnce(Error("unknown delivery result"));
    await expect(unknown.handler.express(unknown.input)).rejects.toThrow(
      "unknown delivery result",
    );
  });
  it("does not relabel an unknown custody/storage error as a safe rejection", async () => {
    const f = expressionFixture();
    f.briefForRun.mockRejectedValueOnce(Error("unknown-custody-error"));
    await expect(f.handler.express(f.input)).rejects.toThrow("unknown-custody-error");
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("finishes rejected and presents its real problem on the next step in the same Reaction", async () => {
    const subjectId = randomUUID(),
      activityId = randomUUID(),
      reactionId = randomUUID();
    const world = { timeDomainRef: "time:real", at: "2026-10-17T06:07:48.273Z" };
    const reaction = {
      subjectId,
      activityId,
      reactionId,
      focusRevision: 1,
      stepCount: 0,
      deadlineAt: "2026-10-17T06:10:48.273Z",
      candidate: { candidateRef: "task:actual", priorityClass: "direct" },
      policy: { maxInteractionSteps: 8 },
    };
    const frame = {
      subjectId,
      activityId,
      reactionId,
      focusRevision: 1,
      frameRef: "situation:actual",
      world,
      currentActivityRefs: [],
      objects: [],
      remainingSteps: 8,
      deadlineAt: reaction.deadlineAt,
    };
    const problem = {
      code: "subject.expression_source_denied",
      detail: "Copy an exact admitted reference or use an empty array.",
      availableCognitionRefs: ["work_context:actual"],
    };
    const invoke = vi.fn(async (_input: unknown) => ({
      structuredOutput: {
        action: reaction.stepCount ? "wait" : "communicate",
        reason: "Choose one current action",
      },
    }));
    const finishAction = vi.fn(async (input: Record<string, unknown>) => ({
      ...input,
      reactionId,
      step: reaction.stepCount,
    }));
    const act = vi.fn(async () =>
      reaction.stepCount === 1
        ? { state: "rejected", resultRefs: [], problem }
        : { state: "completed", resultRefs: [], yield: true },
    );
    const app = createSubjectReactor({
      foreground: {
        current: async () => reaction,
        lastAction: async () => undefined,
        bindRun: vi.fn(),
        settleRun: vi.fn(),
        yield: vi.fn(),
        beginAction: async () => {
          reaction.stepCount++;
          return { claimed: true, receipt: { reactionId } };
        },
        finishAction,
      },
      attention: { select: async () => ({ candidates: [] }) },
      readActivity: async () => ({
        state: "active",
        adoptedBy: "actual:actor",
        scope: {},
      }),
      enabled: async () => true,
      now: () => world.at,
      roles: { invoke },
      decisions: { adopt: async () => ({ decisionId: randomUUID() }) },
      prepare: async () => ({
        frame,
        contacts: [],
        context: {},
        sourceRefs: [],
        candidates: [],
        usage: {},
      }),
      act,
      saveContinuation: async () => "activity:actual",
      afterYield: vi.fn(),
    } as unknown as Parameters<typeof createSubjectReactor>[0]);
    expect((await app.wake({ subjectId })).status).toBe("yielded");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(act).toHaveBeenCalledTimes(2);
    expect(finishAction.mock.calls[0]?.[0]).toMatchObject({
      state: "rejected",
      problem,
    });
    expect(invoke.mock.calls[1]?.[0]).toMatchObject({
      context: { previousAction: { state: "rejected", problem } },
    });
  });
});
