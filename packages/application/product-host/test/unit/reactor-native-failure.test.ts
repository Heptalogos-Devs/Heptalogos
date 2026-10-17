// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSubjectReactor } from "../../src/subject-reactor.js";
import { createSubjectRoles, isFailedRoleDispatch } from "../../src/subject-roles.js";

function fixture(state: string, fresh = false, nativeStatus = "error") {
  const subjectId = randomUUID(),
    activityId = randomUUID(),
    reactionId = randomUUID();
  let runId: string = randomUUID();
  const at = "2026-10-17T07:59:52.000Z";
  let reaction = {
    subjectId,
    activityId,
    reactionId,
    focusRevision: 1,
    ...(!fresh ? { currentRunId: runId } : {}),
    stepCount: 0,
    deadlineAt: "2026-10-17T08:02:47.926Z",
    candidate: { candidateRef: "task:actual", priorityClass: "direct" },
    policy: { maxInteractionSteps: 8 },
  };
  const invoke = vi.fn(async (input: { requestId: string }) => {
    runId = input.requestId;
    throw Error("role failed or uncertain");
  });
  const settleRun = vi.fn(async () => {
    reaction = { ...reaction, currentRunId: undefined };
    return reaction;
  });
  const yieldForeground = vi.fn();
  const prepare = vi.fn(async () => ({
    frame: {
      subjectId,
      activityId,
      reactionId,
      focusRevision: 1,
      frameRef: "situation:actual",
      world: { timeDomainRef: "time:real", at },
      currentActivityRefs: [],
      objects: [],
      remainingSteps: 8,
      deadlineAt: reaction.deadlineAt,
    },
    contacts: [],
    context: {},
    sourceRefs: [],
    candidates: [],
    usage: {},
  }));
  const app = createSubjectReactor({
    foreground: {
      current: async () => reaction,
      lastAction: async () => undefined,
      bindRun: vi.fn(),
      settleRun,
      yield: yieldForeground,
    },
    attention: { select: async () => ({ candidates: [] }) },
    readActivity: async () => ({
      state: "active",
      adoptedBy: "actual:actor",
      scope: {},
    }),
    enabled: async () => true,
    now: () => at,
    roles: { invoke },
    prepare,
    native: {
      readDispatch: async () => ({
        state,
        result: {
          kind: "subject_role_result",
          nativeResult: { runId, status: nativeStatus },
        },
      }),
    },
    saveContinuation: async () => "activity:actual:revision:27",
    afterYield: vi.fn(),
  } as unknown as Parameters<typeof createSubjectReactor>[0]);
  return { app, subjectId, invoke, settleRun, yieldForeground, prepare };
}

describe("known native role failure releases its exact foreground", () => {
  it.each(["completed", "failed"])(
    "settles retained %s failure before the reaction deadline",
    async (state) => {
      const f = fixture(state);
      expect((await f.app.wake({ subjectId: f.subjectId })).status).toBe("yielded");
      expect(f.settleRun).toHaveBeenCalledOnce();
      expect(f.yieldForeground).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: expect.stringContaining("native_role_failed:"),
        }),
      );
      expect(f.invoke).not.toHaveBeenCalled();
      expect(f.prepare).not.toHaveBeenCalled();
    },
  );
  it("settles a freshly returned final failure without dispatching another role", async () => {
    const f = fixture("failed", true);
    expect((await f.app.wake({ subjectId: f.subjectId })).status).toBe("yielded");
    expect(f.invoke).toHaveBeenCalledOnce();
    expect(f.settleRun).toHaveBeenCalledOnce();
  });
  it.each(["dispatching", "uncertain"])("keeps %s work busy", async (state) => {
    const f = fixture(state);
    expect((await f.app.wake({ subjectId: f.subjectId })).status).toBe("busy");
    expect(f.settleRun).not.toHaveBeenCalled();
    expect(f.yieldForeground).not.toHaveBeenCalled();
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("does not classify a wait timeout or another run's result as terminal failure", () => {
    const saved = (runId: string, status: string) => ({
      state: "completed",
      result: { kind: "subject_role_result", nativeResult: { runId, status } },
    });
    expect(isFailedRoleDispatch(saved("actual", "timeout"), "actual")).toBe(false);
    expect(isFailedRoleDispatch(saved("other", "error"), "actual")).toBe(false);
    expect(isFailedRoleDispatch(undefined, "actual")).toBe(false);
  });
  it("returns a retained native failure without launching another role", async () => {
    const runId = randomUUID();
    const dispatch = vi.fn();
    const roles = createSubjectRoles({
      dispatch,
      native: {
        readDispatch: async () => ({
          state: "completed",
          requestDigest: "same-request",
          result: {
            kind: "subject_role_result",
            nativeResult: { runId, status: "error" },
          },
        }),
      },
    } as unknown as Parameters<typeof createSubjectRoles>[0]);
    await expect(
      roles.invoke({
        requestId: runId,
        requestDigest: "same-request",
        subjectId: randomUUID(),
      } as Parameters<typeof roles.invoke>[0]),
    ).rejects.toThrow("saved exact native role ended in failure");
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("preserves transport uncertainty when a fresh invocation throws", async () => {
    const f = fixture("uncertain", true);
    await expect(f.app.wake({ subjectId: f.subjectId })).rejects.toThrow(
      "role failed or uncertain",
    );
    expect(f.settleRun).not.toHaveBeenCalled();
    expect(f.yieldForeground).not.toHaveBeenCalled();
  });
});
