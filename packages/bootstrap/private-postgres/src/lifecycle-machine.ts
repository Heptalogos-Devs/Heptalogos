// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Models private PostgreSQL lifecycle legality with XState while leaving
 * authorization and installation ownership to Bootstrap and Host callers.
 * @module lifecycle-machine
 */

import { initialTransition, setup, transition, type SnapshotFrom } from "xstate";
import {
  createProblemError,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

type PrivatePostgresLifecycleState =
  "STOPPED" | "STARTING" | "READY" | "STOPPING" | "UNCERTAIN";

type PrivatePostgresLifecycleDetail =
  | "stopped"
  | "startCommandPending"
  | "startedPendingReady"
  | "ready"
  | "stopping"
  | "startOutcomeUncertain"
  | "runningObservedUncertain"
  | "processUncertain";

/** Describes a legal private PostgreSQL lifecycle event. */
export type PrivatePostgresLifecycleEvent =
  | { readonly type: "START_COMMAND_ISSUED" }
  | { readonly type: "RESTART_COMMAND_ISSUED" }
  | { readonly type: "START_COMMAND_SUCCEEDED" }
  | { readonly type: "START_OUTCOME_UNCERTAIN" }
  | { readonly type: "READY_PROVEN" }
  | { readonly type: "READY_OBSERVED" }
  | { readonly type: "POST_START_PROOF_FAILED" }
  | { readonly type: "STATUS_RUNNING_PROVEN" }
  | { readonly type: "STATUS_STOPPED_PROVEN" }
  | { readonly type: "STOP_COMMAND_ISSUED" }
  | { readonly type: "STOP_OUTCOME_UNCERTAIN" }
  | { readonly type: "UNEXPECTED_PROCESS_EXIT" };

/** Provides state and validated transition operations for a cluster lifecycle. */
export interface PrivatePostgresLifecycleTracker {
  readonly state: PrivatePostgresLifecycleState;
  readonly detail: PrivatePostgresLifecycleDetail;
  /** Reports whether the lifecycle can accept an event in its current detail. */
  can(event: PrivatePostgresLifecycleEvent): boolean;
  /** Advances the lifecycle or raises a typed invalid-transition Problem. */
  send(event: PrivatePostgresLifecycleEvent): void;
}

const lifecycleMachine = setup({
  types: {
    events: {} as PrivatePostgresLifecycleEvent,
  },
}).createMachine({
  id: "private-postgres-lifecycle",
  initial: "stopped",
  states: {
    stopped: {
      on: {
        START_COMMAND_ISSUED: "startCommandPending",
        READY_OBSERVED: "ready",
      },
    },
    startCommandPending: {
      on: {
        START_COMMAND_SUCCEEDED: "startedPendingReady",
        START_OUTCOME_UNCERTAIN: "startOutcomeUncertain",
      },
    },
    startedPendingReady: {
      on: {
        READY_PROVEN: "ready",
        POST_START_PROOF_FAILED: "processUncertain",
      },
    },
    ready: {
      on: {
        RESTART_COMMAND_ISSUED: "startCommandPending",
        STOP_COMMAND_ISSUED: "stopping",
        UNEXPECTED_PROCESS_EXIT: "processUncertain",
      },
    },
    stopping: {
      on: {
        STATUS_STOPPED_PROVEN: "stopped",
        STOP_OUTCOME_UNCERTAIN: "processUncertain",
      },
    },
    startOutcomeUncertain: {
      on: {
        STATUS_RUNNING_PROVEN: "runningObservedUncertain",
      },
    },
    runningObservedUncertain: {
      on: {
        STOP_COMMAND_ISSUED: "stopping",
      },
    },
    processUncertain: {
      on: {
        STATUS_RUNNING_PROVEN: "runningObservedUncertain",
        STATUS_STOPPED_PROVEN: "stopped",
      },
    },
  },
});

type LifecycleSnapshot = SnapshotFrom<typeof lifecycleMachine>;

const semanticStateByDetail: Readonly<
  Record<PrivatePostgresLifecycleDetail, PrivatePostgresLifecycleState>
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

function detailOf(snapshot: LifecycleSnapshot): PrivatePostgresLifecycleDetail {
  return snapshot.value as PrivatePostgresLifecycleDetail;
}

function invalidTransition(
  detail: PrivatePostgresLifecycleDetail,
  event: PrivatePostgresLifecycleEvent,
): ProblemError {
  return createProblemError({
    problemCode: "private-postgres.lifecycle.invalid_transition",
    category: "conflict",
    retryClass: "manual",
    title: "Private PostgreSQL lifecycle transition is invalid",
    detail: `The private PostgreSQL lifecycle cannot accept ${event.type} while it is ${detail}`,
  });
}

/** Creates the XState-backed private PostgreSQL lifecycle tracker. */
export function createPrivatePostgresLifecycleTracker(): PrivatePostgresLifecycleTracker {
  let snapshot = initialTransition(lifecycleMachine)[0];

  return {
    get state() {
      return semanticStateByDetail[detailOf(snapshot)];
    },
    get detail() {
      return detailOf(snapshot);
    },
    can(event) {
      return snapshot.can(event);
    },
    send(event) {
      const detail = detailOf(snapshot);
      if (!snapshot.can(event)) {
        throw invalidTransition(detail, event);
      }
      snapshot = transition(lifecycleMachine, snapshot, event)[0];
    },
  };
}
