// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Enforces Host/lifecycle/profile admission and maps a WorkQueue dispatch to
 * the static DBOS workflow without moving canonical WorkItem Authority.
 * @module port
 */

import {
  parseInstant,
  parseWorkItemId,
  ProblemError,
  type DurableCodeVersion,
  type Instant,
} from "@heptalogos/foundation-contracts";
import type { HostDurableExecutionAuthority } from "@heptalogos/host-ownership";
import {
  createDispatchAttemptId,
  dispatchAttemptIdToWorkflowId,
  isWorkQueueProfilePartitioned,
  parseDispatchAttemptId,
  type DurableDispatchPort,
  type DurableDispatchRequest,
  type WorkQueueProfileCatalog,
} from "@heptalogos/work-queue";
import type { DurableExecutionRuntime } from "../contracts.js";
import {
  createDbosStaticDispatcher,
  type DbosDispatchStartRequest,
  type DbosStaticDispatcher,
} from "./dispatcher.js";
import { assertDurableExecutionDispatchOpen } from "../runtime/runtime.js";
import { durableExecutionProblem } from "../problems.js";

/** Public inputs for creating a lifecycle-bound durable dispatch port. */
export interface DurableDispatchPortOptions {
  readonly authority: HostDurableExecutionAuthority;
  readonly lifecycle: Pick<DurableExecutionRuntime, "state">;
  readonly durableCodeVersion: DurableCodeVersion;
  readonly profiles: WorkQueueProfileCatalog;
  /** Supplies the canonical current wall-clock Instant for delay projection. */
  readonly now: () => Instant;
}

function invalidRequest(detail: string, cause?: unknown): never {
  throw durableExecutionProblem(
    "durable.execution.dispatch.invalid_request",
    detail,
    cause,
  );
}

function validateRequest(request: DurableDispatchRequest): void {
  if (parseWorkItemId(request.workItemId) === undefined) {
    invalidRequest("workItemId must be a valid WorkItemId");
  }
  if (!Number.isSafeInteger(request.dispatchRevision) || request.dispatchRevision < 1) {
    invalidRequest("dispatchRevision must be a positive safe integer");
  }
  if (parseDispatchAttemptId(request.dispatchAttemptId) === undefined) {
    invalidRequest("dispatchAttemptId must be a valid DispatchAttemptId");
  }
  if (
    createDispatchAttemptId(request.workItemId, request.dispatchRevision) !==
    request.dispatchAttemptId
  ) {
    invalidRequest("dispatchAttemptId does not match WorkItemId and dispatchRevision");
  }
  if (
    !Number.isSafeInteger(request.priority) ||
    request.priority < 1 ||
    request.priority > 2_147_483_647
  ) {
    invalidRequest("priority must be between 1 and 2147483647");
  }
  if (request.partitionKey !== undefined) {
    if (
      typeof request.partitionKey !== "string" ||
      request.partitionKey.trim().length === 0 ||
      new TextEncoder().encode(request.partitionKey).byteLength > 256
    ) {
      invalidRequest("partitionKey must be non-empty and at most 256 UTF-8 bytes");
    }
  }
  if (
    request.notBefore !== undefined &&
    parseInstant(request.notBefore) === undefined
  ) {
    invalidRequest("notBefore must be a canonical Instant");
  }
}

function delaySeconds(notBefore: Instant | undefined, now: () => Instant): number {
  if (notBefore === undefined) return 0;
  const current = now();
  const parsedCurrent = parseInstant(current);
  const parsedNotBefore = parseInstant(notBefore);
  if (parsedCurrent === undefined || parsedNotBefore === undefined) {
    invalidRequest("dispatch time values must be canonical Instants");
  }
  const deltaMilliseconds = Date.parse(parsedNotBefore) - Date.parse(parsedCurrent);
  return Math.max(0, Math.ceil(deltaMilliseconds / 1000));
}

function startRequest(
  request: DurableDispatchRequest,
  profileId: string,
  durableCodeVersion: DurableCodeVersion,
  now: () => Instant,
): DbosDispatchStartRequest {
  const partitionKey = request.partitionKey;
  return {
    workItemId: request.workItemId,
    dispatchRevision: request.dispatchRevision,
    options: {
      workflowID: dispatchAttemptIdToWorkflowId(request.dispatchAttemptId),
      queueName: `heptalogos.queue.${profileId}`,
      enqueueOptions: {
        priority: request.priority,
        delaySeconds: delaySeconds(request.notBefore, now),
        applicationVersion: durableCodeVersion,
        ...(partitionKey === undefined ? {} : { queuePartitionKey: partitionKey }),
      },
    },
  };
}

function createPort(
  options: DurableDispatchPortOptions,
  dispatcher: DbosStaticDispatcher,
): DurableDispatchPort {
  return Object.freeze({
    async dispatch(request: DurableDispatchRequest): Promise<void> {
      assertDurableExecutionDispatchOpen(options.lifecycle.state, options.authority);
      validateRequest(request);
      const profile = options.profiles.get(request.queueProfileId);
      if (profile === undefined) {
        throw durableExecutionProblem(
          "durable.execution.dispatch.profile_missing",
          `No WorkQueue profile is registered for '${String(request.queueProfileId)}'`,
        );
      }
      const partitioned = isWorkQueueProfilePartitioned(profile);
      if (partitioned && request.partitionKey === undefined) {
        throw durableExecutionProblem(
          "durable.execution.dispatch.partition_required",
          "Partitioned WorkQueue profiles require a partitionKey",
        );
      }
      if (!partitioned && request.partitionKey !== undefined) {
        throw durableExecutionProblem(
          "durable.execution.dispatch.partition_not_supported",
          "Unpartitioned WorkQueue profiles do not accept a partitionKey",
        );
      }

      try {
        await dispatcher.dispatch(
          startRequest(
            request,
            String(profile.profileId),
            options.durableCodeVersion,
            options.now,
          ),
        );
      } catch (error) {
        if (error instanceof ProblemError) throw error;
        throw durableExecutionProblem(
          "durable.execution.dispatch.failed",
          "DBOS could not enqueue the durable WorkItem dispatch",
          error,
        );
      }
    },
  });
}

/** Creates a durable dispatch port backed by the process-global DBOS workflow. */
export function createDurableDispatchPort(
  options: DurableDispatchPortOptions,
): DurableDispatchPort {
  return createPort(options, createDbosStaticDispatcher());
}

/** Tests only: injects the DBOS start seam while retaining dispatch admission rules. */
export function createDurableDispatchPortForTests(
  options: DurableDispatchPortOptions,
  dispatcher: DbosStaticDispatcher,
): DurableDispatchPort {
  return createPort(options, dispatcher);
}
