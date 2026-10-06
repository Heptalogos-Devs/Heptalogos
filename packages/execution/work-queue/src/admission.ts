// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates WorkItem admission against canonical identity, payload, generation,
 * and revision rules before durable work enters reconciliation.
 * @module admission
 */

import {
  parseInstant,
  type CanonicalJsonValue,
  type ContinuityEpochId,
  type Instant,
  type MicroSystemId,
  type ContributionId,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionContext,
  LineageContextRefV1,
} from "@heptalogos/execution-lineage";
import type {
  DurableDispatchRequest,
  ResourceAdmissionClassId,
  WorkCreationAdmissionDecision,
  WorkConfigurationBinding,
  WorkDispatchAdmissionDecision,
  WorkHandlerTarget,
  WorkItem,
  WorkQueueProfileId,
} from "./contracts.js";
import { workQueueProblem } from "./problems.js";

/** Inputs checked before a new durable WorkItem is admitted to the queue. */
export interface WorkAdmissionRequest {
  readonly execution: ExecutionContext;
  readonly target: WorkHandlerTarget;
  readonly payload: CanonicalJsonValue;
  readonly queueProfileId: WorkQueueProfileId;
  readonly resourceAdmissionClass: ResourceAdmissionClassId;
  readonly partitionKey?: string;
  readonly priority: number;
  readonly notBefore?: Instant;
  readonly dedupKey?: string;
  readonly configurationBinding: WorkConfigurationBinding;
  readonly createdContinuityEpochId: ContinuityEpochId;
  readonly lineageContextRef: LineageContextRefV1;
  readonly handlerMicroSystemId: MicroSystemId;
  readonly handlerContributionId: ContributionId;
}

/** Policy boundary that may allow, delay, throttle, or reject queue work. */
export interface WorkAdmissionPort {
  /** Decide whether creation may proceed and at what earliest time. */
  beforeCreate(
    input: WorkAdmissionRequest,
  ): WorkCreationAdmissionDecision | Promise<WorkCreationAdmissionDecision>;
  /** Decide whether a ready WorkItem may be dispatched now. */
  beforeDispatch(
    input: WorkDispatchAdmissionRequest,
  ): WorkDispatchAdmissionDecision | Promise<WorkDispatchAdmissionDecision>;
}

/** Inputs checked immediately before a durable dispatch attempt is started. */
export interface WorkDispatchAdmissionRequest {
  readonly execution: ExecutionContext;
  readonly workItem: WorkItem;
  readonly dispatch: DurableDispatchRequest;
  readonly now: Instant;
}

function assertReasonCode(reasonCode: unknown): void {
  if (
    typeof reasonCode !== "string" ||
    reasonCode.trim().length === 0 ||
    new TextEncoder().encode(reasonCode).byteLength > 256
  ) {
    throw workQueueProblem(
      "work.admission.invalid_decision",
      "WorkAdmission decision reasonCode must be a bounded non-empty string",
    );
  }
}

function assertNotBefore(value: unknown, decision: string): Instant {
  const parsed = parseInstant(value);
  if (parsed === undefined) {
    throw workQueueProblem(
      "work.admission.invalid_decision",
      `${decision} requires a canonical notBefore Instant`,
    );
  }
  return parsed;
}

function laterInstant(left: Instant | undefined, right: Instant): Instant {
  if (left === undefined) return right;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

/** Apply creation policy while preserving the later of requested and policy times. */
export function applyWorkAdmissionDecision(
  requestedNotBefore: Instant | undefined,
  decision: WorkCreationAdmissionDecision,
): Instant | undefined {
  if (typeof decision !== "object" || decision === null) {
    throw workQueueProblem(
      "work.admission.invalid_decision",
      "WorkAdmission returned no decision object",
    );
  }
  switch (decision.decision) {
    case "ALLOW":
      return requestedNotBefore;
    case "DELAY":
      assertReasonCode(decision.reasonCode);
      return laterInstant(
        requestedNotBefore,
        assertNotBefore(decision.notBefore, "DELAY"),
      );
    case "THROTTLE":
      assertReasonCode(decision.reasonCode);
      if (decision.notBefore === undefined) {
        throw workQueueProblem(
          "work.admission.invalid_decision",
          "THROTTLE requires an explicit notBefore Instant during creation",
        );
      }
      return laterInstant(
        requestedNotBefore,
        assertNotBefore(decision.notBefore, "THROTTLE"),
      );
    case "REJECT_OPTIONAL":
      assertReasonCode(decision.reasonCode);
      throw workQueueProblem(
        "work.admission.rejected_optional",
        `WorkAdmission rejected optional work: ${decision.reasonCode}`,
      );
    case "REJECT_NEW_WORK":
      assertReasonCode(decision.reasonCode);
      throw workQueueProblem(
        "work.admission.rejected_new_work",
        `WorkAdmission rejected new work: ${decision.reasonCode}`,
      );
    default:
      throw workQueueProblem(
        "work.admission.invalid_decision",
        "WorkAdmission returned an unsupported decision",
      );
  }
}

/** Convert dispatch policy into an executable admission decision. */
export function applyWorkDispatchAdmissionDecision(
  decision: WorkDispatchAdmissionDecision,
): boolean {
  if (typeof decision !== "object" || decision === null) {
    throw workQueueProblem(
      "work.admission.invalid_decision",
      "WorkAdmission returned no dispatch decision object",
    );
  }
  switch (decision.decision) {
    case "ALLOW":
      return true;
    case "DELAY":
    case "THROTTLE":
      assertReasonCode(decision.reasonCode);
      return false;
    default:
      throw workQueueProblem(
        "work.admission.invalid_decision",
        "WorkAdmission returned an unsupported dispatch decision",
      );
  }
}
