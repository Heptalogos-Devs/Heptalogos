// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Derives deterministic dispatch-attempt identities from canonical WorkItem
 * inputs so retries and duplicate dispatches remain idempotently addressable.
 * @module attempt-identity
 */

import {
  asContentDigest,
  digestCanonicalJson,
  parseContentDigest,
  type WorkItemId,
} from "@heptalogos/foundation-contracts";
import type { DispatchAttemptId } from "./contracts.js";
import { workQueueProblem } from "./problems.js";

const ATTEMPT_DOMAIN = "heptalogos/work-dispatch-attempt/v1";

function assertDispatchRevision(dispatchRevision: number): void {
  if (
    !Number.isSafeInteger(dispatchRevision) ||
    dispatchRevision < 1 ||
    dispatchRevision > Number.MAX_SAFE_INTEGER
  ) {
    throw workQueueProblem(
      "work_queue.invalid_attempt_identity",
      "dispatchRevision must be a positive safe integer",
    );
  }
}

/** Derive the stable attempt identity for one WorkItem dispatch revision. */
export function createDispatchAttemptId(
  workItemId: WorkItemId,
  dispatchRevision: number,
): DispatchAttemptId {
  assertDispatchRevision(dispatchRevision);
  return asContentDigest(
    "DispatchAttemptId",
    digestCanonicalJson(ATTEMPT_DOMAIN, {
      workItemId,
      dispatchRevision,
    }),
  );
}

/** Parse an untrusted attempt identity without manufacturing a digest. */
export function parseDispatchAttemptId(value: unknown): DispatchAttemptId | undefined {
  return parseContentDigest("DispatchAttemptId", value);
}

/** Map an attempt digest to the workflow identity used by the execution engine. */
export function dispatchAttemptIdToWorkflowId(
  dispatchAttemptId: DispatchAttemptId,
): string {
  return `heptalogos.work.${dispatchAttemptId}`;
}
