// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createHostLeaseLifecycleTracker,
  type HostLeaseLifecycleEvent,
} from "../../src/host-lease-machine.js";

const EVENTS: readonly HostLeaseLifecycleEvent[] = [
  { type: "LEASE_ACQUIRED" },
  { type: "ACQUISITION_FAILED" },
  { type: "LEASE_LOST" },
  { type: "CLOSE_REQUESTED" },
  { type: "CLOSE_FAILED" },
  { type: "CLOSED" },
];

describe("Host lease lifecycle mechanics", () => {
  it("requires one successful acquisition before ACTIVE and closes explicitly", () => {
    const tracker = createHostLeaseLifecycleTracker();

    expect(tracker.state).toBe("ACQUIRING");
    tracker.send({ type: "LEASE_ACQUIRED" });
    expect(tracker.state).toBe("ACTIVE");
    tracker.send({ type: "CLOSE_REQUESTED" });
    expect(tracker.state).toBe("CLOSING");
    tracker.send({ type: "CLOSED" });
    expect(tracker.state).toBe("CLOSED");
  });

  it("fences on lease loss and never returns to ACTIVE", () => {
    const tracker = createHostLeaseLifecycleTracker();
    tracker.send({ type: "LEASE_ACQUIRED" });
    tracker.send({ type: "LEASE_LOST" });

    expect(tracker.state).toBe("FENCED");
    expect(tracker.can({ type: "LEASE_ACQUIRED" })).toBe(false);
    expect(() => tracker.send({ type: "LEASE_ACQUIRED" })).toThrowError();
    expect(tracker.state).toBe("FENCED");
  });

  it("does not reactivate a closed or failed acquisition tracker", () => {
    const failed = createHostLeaseLifecycleTracker();
    failed.send({ type: "ACQUISITION_FAILED" });
    expect(failed.state).toBe("CLOSED");
    expect(failed.can({ type: "LEASE_ACQUIRED" })).toBe(false);

    const closed = createHostLeaseLifecycleTracker();
    closed.send({ type: "CLOSE_REQUESTED" });
    closed.send({ type: "CLOSED" });
    expect(closed.can({ type: "LEASE_ACQUIRED" })).toBe(false);
  });

  it("fences when closing has an uncertain outcome", () => {
    const tracker = createHostLeaseLifecycleTracker();
    tracker.send({ type: "LEASE_ACQUIRED" });
    tracker.send({ type: "CLOSE_REQUESTED" });
    tracker.send({ type: "CLOSE_FAILED" });

    expect(tracker.state).toBe("FENCED");
    expect(tracker.can({ type: "LEASE_ACQUIRED" })).toBe(false);
  });

  it("allows at most one activation transition across arbitrary event sequences", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...EVENTS), { maxLength: 50 }), (events) => {
        const tracker = createHostLeaseLifecycleTracker();
        let activations = 0;
        for (const event of events) {
          if (!tracker.can(event)) continue;
          if (event.type === "LEASE_ACQUIRED") activations += 1;
          tracker.send(event);
        }
        expect(activations).toBeLessThanOrEqual(1);
      }),
    );
  });
});
