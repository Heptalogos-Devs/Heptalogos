// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Encapsulates Host lease lifecycle transitions with XState while projecting
 * only Heptalogos ownership and fence semantics to the package boundary.
 * @module host-lease-machine
 */

import { initialTransition, setup, transition, type SnapshotFrom } from "xstate";
import {
  createProblemError,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

/** Enumerates Host lease lifecycle states exposed by the adapter. */
export type HostLeaseLifecycleState =
  "ACQUIRING" | "ACTIVE" | "FENCED" | "CLOSING" | "CLOSED";

/** Describes a legal Host lease lifecycle event. */
export type HostLeaseLifecycleEvent =
  | { readonly type: "LEASE_ACQUIRED" }
  | { readonly type: "ACQUISITION_FAILED" }
  | { readonly type: "LEASE_LOST" }
  | { readonly type: "CLOSE_REQUESTED" }
  | { readonly type: "CLOSE_FAILED" }
  | { readonly type: "CLOSED" };

/** Provides state queries and validated transitions for a Host lease. */
export interface HostLeaseLifecycleTracker {
  readonly state: HostLeaseLifecycleState;
  /** Reports whether an event is legal in the current lease state. */
  can(event: HostLeaseLifecycleEvent): boolean;
  /** Advances the lifecycle or throws a typed transition Problem. */
  send(event: HostLeaseLifecycleEvent): void;
}

const hostLeaseMachine = setup({
  types: {
    events: {} as HostLeaseLifecycleEvent,
  },
}).createMachine({
  id: "host-lease-lifecycle",
  initial: "acquiring",
  states: {
    acquiring: {
      on: {
        LEASE_ACQUIRED: "active",
        ACQUISITION_FAILED: "closed",
        LEASE_LOST: "fenced",
        CLOSE_REQUESTED: "closing",
      },
    },
    active: {
      on: {
        LEASE_LOST: "fenced",
        CLOSE_REQUESTED: "closing",
      },
    },
    fenced: {
      on: {
        CLOSE_REQUESTED: "closing",
      },
    },
    closing: {
      on: {
        CLOSE_FAILED: "fenced",
        CLOSED: "closed",
      },
    },
    closed: {},
  },
});

type HostLeaseSnapshot = SnapshotFrom<typeof hostLeaseMachine>;

function stateOf(snapshot: HostLeaseSnapshot): HostLeaseLifecycleState {
  const detail = snapshot.value as string;
  const stateByDetail: Readonly<Record<string, HostLeaseLifecycleState>> = {
    acquiring: "ACQUIRING",
    active: "ACTIVE",
    fenced: "FENCED",
    closing: "CLOSING",
    closed: "CLOSED",
  };
  return stateByDetail[detail];
}

function invalidTransition(
  state: HostLeaseLifecycleState,
  event: HostLeaseLifecycleEvent,
): ProblemError {
  return createProblemError({
    problemCode: "host-ownership.lifecycle.invalid_transition",
    category: "conflict",
    retryClass: "manual",
    title: "Host ownership lifecycle transition is invalid",
    detail: `The Host ownership lifecycle cannot accept ${event.type} while it is ${state}`,
  });
}

function advanceHostLeaseSnapshot(
  snapshot: HostLeaseSnapshot,
  event: HostLeaseLifecycleEvent,
): HostLeaseSnapshot {
  return transition(hostLeaseMachine, snapshot, event)[0];
}

function sendHostLeaseEvent(
  snapshot: HostLeaseSnapshot,
  event: HostLeaseLifecycleEvent,
): HostLeaseSnapshot {
  const state = stateOf(snapshot);
  if (!snapshot.can(event)) throw invalidTransition(state, event);
  return advanceHostLeaseSnapshot(snapshot, event);
}

/** Creates the XState-backed Host lease lifecycle tracker. */
export function createHostLeaseLifecycleTracker(): HostLeaseLifecycleTracker {
  let snapshot = initialTransition(hostLeaseMachine)[0];

  return {
    get state() {
      return stateOf(snapshot);
    },
    can(event) {
      return snapshot.can(event);
    },
    send(event) {
      snapshot = sendHostLeaseEvent(snapshot, event);
    },
  };
}
