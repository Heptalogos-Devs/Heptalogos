// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createPrivatePostgresLifecycleTracker,
  type PrivatePostgresLifecycleEvent,
  type PrivatePostgresLifecycleTracker,
} from "../../src/lifecycle-machine.js";

const ALL_EVENTS = [
  { type: "START_COMMAND_ISSUED" },
  { type: "RESTART_COMMAND_ISSUED" },
  { type: "START_COMMAND_SUCCEEDED" },
  { type: "START_OUTCOME_UNCERTAIN" },
  { type: "READY_PROVEN" },
  { type: "READY_OBSERVED" },
  { type: "POST_START_PROOF_FAILED" },
  { type: "STATUS_RUNNING_PROVEN" },
  { type: "STATUS_STOPPED_PROVEN" },
  { type: "STOP_COMMAND_ISSUED" },
  { type: "STOP_OUTCOME_UNCERTAIN" },
  { type: "UNEXPECTED_PROCESS_EXIT" },
] as const satisfies readonly PrivatePostgresLifecycleEvent[];

const BEFORE_RUNNING_NOISE = ALL_EVENTS.filter(
  (event) => event.type !== "STATUS_RUNNING_PROVEN",
);
const BEFORE_STOP_NOISE = ALL_EVENTS.filter(
  (event) => event.type !== "STOP_COMMAND_ISSUED",
);
const BEFORE_STOPPED_NOISE = ALL_EVENTS.filter(
  (event) =>
    event.type !== "STATUS_STOPPED_PROVEN" && event.type !== "STOP_OUTCOME_UNCERTAIN",
);
const BEFORE_GENERIC_STOPPED_NOISE = ALL_EVENTS.filter(
  (event) =>
    event.type !== "STATUS_RUNNING_PROVEN" && event.type !== "STATUS_STOPPED_PROVEN",
);

const SEMANTIC_STATE_BY_DETAIL: Readonly<
  Record<string, "STOPPED" | "STARTING" | "READY" | "STOPPING" | "UNCERTAIN">
> = {
  stopped: "STOPPED",
  startCommandPending: "STARTING",
  startedPendingReady: "STARTING",
  ready: "READY",
  stopping: "STOPPING",
  startOutcomeUncertain: "UNCERTAIN",
  runningObservedUncertain: "UNCERTAIN",
  processUncertain: "UNCERTAIN",
};

function expectTracker(
  tracker: PrivatePostgresLifecycleTracker,
  state: string,
  detail: string,
): void {
  expect(tracker.state).toBe(state);
  expect(tracker.detail).toBe(detail);
}

function enterAmbiguousStart(tracker: PrivatePostgresLifecycleTracker): void {
  tracker.send({ type: "START_COMMAND_ISSUED" });
  tracker.send({ type: "START_OUTCOME_UNCERTAIN" });
}

function rejectNoise(
  tracker: PrivatePostgresLifecycleTracker,
  events: readonly PrivatePostgresLifecycleEvent[],
): void {
  for (const event of events) {
    const before = { state: tracker.state, detail: tracker.detail };
    expect(tracker.can(event)).toBe(false);
    expect(() => tracker.send(event)).toThrowError();
    expect(tracker.state).toBe(before.state);
    expect(tracker.detail).toBe(before.detail);
  }
}

describe("private PostgreSQL lifecycle transition mechanics", () => {
  it("accepts a fully validated already-running observation as READY", () => {
    const tracker = createPrivatePostgresLifecycleTracker();

    tracker.send({ type: "READY_OBSERVED" });
    expectTracker(tracker, "READY", "ready");
  });

  it("allows a stopped cluster to become ready only after command success and readiness proof", () => {
    const tracker = createPrivatePostgresLifecycleTracker();

    expectTracker(tracker, "STOPPED", "stopped");
    tracker.send({ type: "START_COMMAND_ISSUED" });
    expectTracker(tracker, "STARTING", "startCommandPending");
    tracker.send({ type: "START_COMMAND_SUCCEEDED" });
    expectTracker(tracker, "STARTING", "startedPendingReady");
    tracker.send({ type: "READY_PROVEN" });
    expectTracker(tracker, "READY", "ready");
  });

  it("allows a ready cluster to restart through the same pending and readiness stages", () => {
    const tracker = createPrivatePostgresLifecycleTracker();

    tracker.send({ type: "START_COMMAND_ISSUED" });
    tracker.send({ type: "START_COMMAND_SUCCEEDED" });
    tracker.send({ type: "READY_PROVEN" });
    tracker.send({ type: "RESTART_COMMAND_ISSUED" });
    expectTracker(tracker, "STARTING", "startCommandPending");
    tracker.send({ type: "START_COMMAND_SUCCEEDED" });
    tracker.send({ type: "READY_PROVEN" });
    expectTracker(tracker, "READY", "ready");
  });

  it("allows a ready cluster to stop only after a positive stopped observation", () => {
    const tracker = createPrivatePostgresLifecycleTracker();

    tracker.send({ type: "START_COMMAND_ISSUED" });
    tracker.send({ type: "START_COMMAND_SUCCEEDED" });
    tracker.send({ type: "READY_PROVEN" });
    tracker.send({ type: "STOP_COMMAND_ISSUED" });
    expectTracker(tracker, "STOPPING", "stopping");
    tracker.send({ type: "STATUS_STOPPED_PROVEN" });
    expectTracker(tracker, "STOPPED", "stopped");
  });

  it("does not treat one stopped observation as quiescence after an ambiguous start", () => {
    const tracker = createPrivatePostgresLifecycleTracker();

    tracker.send({ type: "START_COMMAND_ISSUED" });
    tracker.send({ type: "START_OUTCOME_UNCERTAIN" });
    expectTracker(tracker, "UNCERTAIN", "startOutcomeUncertain");
    expect(tracker.can({ type: "STATUS_STOPPED_PROVEN" })).toBe(false);

    let thrown: unknown;
    try {
      tracker.send({ type: "STATUS_STOPPED_PROVEN" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      problem: {
        problemCode: "private-postgres.lifecycle.invalid_transition",
        category: "conflict",
        retryClass: "manual",
      },
    });
    expectTracker(tracker, "UNCERTAIN", "startOutcomeUncertain");
  });

  it("never reaches STOPPED from delayed-start uncertainty without positive RUNNING proof", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...BEFORE_RUNNING_NOISE), { maxLength: 50 }),
        (events) => {
          const tracker = createPrivatePostgresLifecycleTracker();
          enterAmbiguousStart(tracker);
          rejectNoise(tracker, events);
          expect(tracker.state).not.toBe("STOPPED");
        },
      ),
    );
  });

  it("requires the ordered RUNNING, stop, and STOPPED cleanup proof", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...BEFORE_RUNNING_NOISE), { maxLength: 50 }),
        fc.array(fc.constantFrom(...BEFORE_STOP_NOISE), { maxLength: 50 }),
        fc.array(fc.constantFrom(...BEFORE_STOPPED_NOISE), { maxLength: 50 }),
        (beforeRunning, beforeStop, beforeStopped) => {
          const tracker = createPrivatePostgresLifecycleTracker();
          enterAmbiguousStart(tracker);
          rejectNoise(tracker, beforeRunning);

          tracker.send({ type: "STATUS_RUNNING_PROVEN" });
          expectTracker(tracker, "UNCERTAIN", "runningObservedUncertain");
          rejectNoise(tracker, beforeStop);

          tracker.send({ type: "STOP_COMMAND_ISSUED" });
          expectTracker(tracker, "STOPPING", "stopping");
          rejectNoise(tracker, beforeStopped);

          tracker.send({ type: "STATUS_STOPPED_PROVEN" });
          expectTracker(tracker, "STOPPED", "stopped");
        },
      ),
    );
  });

  it("keeps generic process uncertainty recoverable from positive STOPPED", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...BEFORE_GENERIC_STOPPED_NOISE), {
          maxLength: 50,
        }),
        (events) => {
          const tracker = createPrivatePostgresLifecycleTracker();
          tracker.send({ type: "START_COMMAND_ISSUED" });
          tracker.send({ type: "START_COMMAND_SUCCEEDED" });
          tracker.send({ type: "POST_START_PROOF_FAILED" });
          expectTracker(tracker, "UNCERTAIN", "processUncertain");
          rejectNoise(tracker, events);

          tracker.send({ type: "STATUS_STOPPED_PROVEN" });
          expectTracker(tracker, "STOPPED", "stopped");
        },
      ),
    );
  });

  it("projects every reachable internal detail to its declared semantic state", () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_EVENTS), { maxLength: 50 }),
        (events) => {
          const tracker = createPrivatePostgresLifecycleTracker();
          expect(tracker.state).toBe(SEMANTIC_STATE_BY_DETAIL[tracker.detail]);
          for (const event of events) {
            if (tracker.can(event)) {
              tracker.send(event);
            } else {
              const before = { state: tracker.state, detail: tracker.detail };
              expect(() => tracker.send(event)).toThrowError();
              expect(tracker.state).toBe(before.state);
              expect(tracker.detail).toBe(before.detail);
            }
            expect(tracker.state).toBe(SEMANTIC_STATE_BY_DETAIL[tracker.detail]);
          }
        },
      ),
    );
  });
});
