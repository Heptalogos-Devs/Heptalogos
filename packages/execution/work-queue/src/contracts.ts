// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines canonical WorkItem, dispatch, retry, handler, and repository contracts
 * without coupling durable work to DBOS or a particular execution engine.
 * @module contracts
 */

import type {
  CanonicalJsonValue,
  ContentDigest,
  ContinuityEpochId,
  Instant,
  WorkItemId,
} from "@heptalogos/foundation-contracts";
import { parseMicroSystemId } from "@heptalogos/foundation-contracts";
import type { LineageContextRefV1 } from "@heptalogos/execution-lineage";
import type {
  ResourceAdmissionClassId as RuntimeResourceAdmissionClassId,
  WorkHandlerConfigurationBindingPolicy,
  WorkHandlerRestoreReplayClass,
  WorkHandlerTarget,
  WorkQueueProfileId as RuntimeWorkQueueProfileId,
} from "@heptalogos/runtime-kernel";
import { workQueueProblem } from "./problems.js";

/** Runtime-owned queue profile identity used by durable work. */
export type WorkQueueProfileId = RuntimeWorkQueueProfileId;
/** Runtime-owned resource admission class identity used by queue policy. */
export type ResourceAdmissionClassId = RuntimeResourceAdmissionClassId;

/** Bounds one DBOS-backed WorkQueue profile's start-rate mechanics. */
export interface WorkQueueRateLimit {
  readonly limitPerPeriod: number;
  readonly periodSeconds: number;
}

/** Bounds execution for one partition of a WorkQueue profile. */
export interface WorkQueuePartitionLimits {
  readonly concurrency?: number;
  readonly workerConcurrency?: number;
  readonly rateLimit?: WorkQueueRateLimit;
}

/** Immutable product scheduling policy projected to the durable engine. */
export interface WorkQueueProfileDefinition {
  readonly profileId: WorkQueueProfileId;
  readonly globalConcurrency?: number;
  readonly workerConcurrency?: number;
  readonly rateLimit?: WorkQueueRateLimit;
  readonly partition?: WorkQueuePartitionLimits;
  readonly minPollingIntervalMs: number;
}

/** Provides the Host-composed immutable WorkQueue profile catalog. */
export interface WorkQueueProfileCatalog {
  /** Returns a profile by its semantic identity. */
  get(profileId: WorkQueueProfileId): WorkQueueProfileDefinition | undefined;
  /** Returns all profiles in deterministic composition order. */
  list(): readonly WorkQueueProfileDefinition[];
}

function profileProblem(detail: string): never {
  throw workQueueProblem("work.queue.profile_invalid", detail);
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    return profileProblem(`${field} must be a positive safe integer`);
  }
  return value as number;
}

function optionalPositiveSafeInteger(
  value: unknown,
  field: string,
): number | undefined {
  return value === undefined ? undefined : positiveSafeInteger(value, field);
}

function cloneRateLimit(
  value: WorkQueueRateLimit | undefined,
  field: string,
): WorkQueueRateLimit | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return profileProblem(`${field} must be an object`);
  }
  return Object.freeze({
    limitPerPeriod: positiveSafeInteger(
      value.limitPerPeriod,
      `${field}.limitPerPeriod`,
    ),
    periodSeconds: positiveSafeInteger(value.periodSeconds, `${field}.periodSeconds`),
  });
}

function cloneDefinition(
  definition: WorkQueueProfileDefinition,
): WorkQueueProfileDefinition {
  if (
    typeof definition !== "object" ||
    definition === null ||
    Array.isArray(definition)
  ) {
    return profileProblem("profile definition must be an object");
  }
  if (parseMicroSystemId(definition.profileId) === undefined) {
    return profileProblem("profileId must be a normalized namespaced identifier");
  }
  const globalConcurrency = optionalPositiveSafeInteger(
    definition.globalConcurrency,
    "globalConcurrency",
  );
  const workerConcurrency = optionalPositiveSafeInteger(
    definition.workerConcurrency,
    "workerConcurrency",
  );
  const rateLimit = cloneRateLimit(definition.rateLimit, "rateLimit");
  const minPollingIntervalMs = positiveSafeInteger(
    definition.minPollingIntervalMs,
    "minPollingIntervalMs",
  );
  if (
    globalConcurrency !== undefined &&
    workerConcurrency !== undefined &&
    workerConcurrency > globalConcurrency
  ) {
    return profileProblem("workerConcurrency cannot exceed globalConcurrency");
  }

  let partition: WorkQueuePartitionLimits | undefined;
  if (definition.partition !== undefined) {
    if (
      typeof definition.partition !== "object" ||
      definition.partition === null ||
      Array.isArray(definition.partition)
    ) {
      return profileProblem("partition must be an object");
    }
    const concurrency = optionalPositiveSafeInteger(
      definition.partition.concurrency,
      "partition.concurrency",
    );
    const partitionWorkerConcurrency = optionalPositiveSafeInteger(
      definition.partition.workerConcurrency,
      "partition.workerConcurrency",
    );
    const partitionRateLimit = cloneRateLimit(
      definition.partition.rateLimit,
      "partition.rateLimit",
    );
    if (
      globalConcurrency !== undefined &&
      concurrency !== undefined &&
      concurrency > globalConcurrency
    ) {
      return profileProblem("partition.concurrency cannot exceed globalConcurrency");
    }
    if (
      concurrency !== undefined &&
      partitionWorkerConcurrency !== undefined &&
      partitionWorkerConcurrency > concurrency
    ) {
      return profileProblem(
        "partition.workerConcurrency cannot exceed partition.concurrency",
      );
    }
    if (
      workerConcurrency !== undefined &&
      partitionWorkerConcurrency !== undefined &&
      partitionWorkerConcurrency > workerConcurrency
    ) {
      return profileProblem(
        "partition.workerConcurrency cannot exceed workerConcurrency",
      );
    }
    if (
      globalConcurrency !== undefined &&
      partitionWorkerConcurrency !== undefined &&
      partitionWorkerConcurrency > globalConcurrency
    ) {
      return profileProblem(
        "partition.workerConcurrency cannot exceed globalConcurrency",
      );
    }
    partition = Object.freeze({
      ...(concurrency === undefined ? {} : { concurrency }),
      ...(partitionWorkerConcurrency === undefined
        ? {}
        : { workerConcurrency: partitionWorkerConcurrency }),
      ...(partitionRateLimit === undefined ? {} : { rateLimit: partitionRateLimit }),
    });
  }

  return Object.freeze({
    profileId: definition.profileId,
    ...(globalConcurrency === undefined ? {} : { globalConcurrency }),
    ...(workerConcurrency === undefined ? {} : { workerConcurrency }),
    ...(rateLimit === undefined ? {} : { rateLimit }),
    ...(partition === undefined ? {} : { partition }),
    minPollingIntervalMs,
  });
}

/** Creates the immutable, fail-closed WorkQueue profile catalog. */
export function createWorkQueueProfileCatalog(
  definitions: readonly WorkQueueProfileDefinition[],
): WorkQueueProfileCatalog {
  if (!Array.isArray(definitions)) {
    return profileProblem("profile definitions must be an array");
  }
  const normalized = definitions.map(cloneDefinition);
  const byId = new Map<WorkQueueProfileId, WorkQueueProfileDefinition>();
  for (const definition of normalized) {
    if (byId.has(definition.profileId)) {
      return profileProblem(`profileId is duplicated: ${definition.profileId}`);
    }
    byId.set(definition.profileId, definition);
  }
  const list = Object.freeze(normalized);
  return Object.freeze({
    get(profileId: WorkQueueProfileId) {
      return byId.get(profileId);
    },
    list() {
      return list;
    },
  });
}

/** Returns whether a profile has any configured DBOS partition limit. */
export function isWorkQueueProfilePartitioned(
  profile: WorkQueueProfileDefinition,
): boolean {
  const partition = profile.partition;
  return (
    partition !== undefined &&
    (partition.concurrency !== undefined ||
      partition.workerConcurrency !== undefined ||
      partition.rateLimit !== undefined)
  );
}

export type {
  WorkHandlerConfigurationBindingPolicy,
  WorkHandlerRestoreReplayClass,
  WorkHandlerTarget,
};

/** Stable failure classes that determine retry and terminal behavior. */
export type WorkRetryClass =
  | "transient"
  | "rate-limited"
  | "dependency-unavailable"
  | "not-configured"
  | "policy-blocked"
  | "invalid"
  | "permanent"
  | "external-effect-uncertain";

/** Durable lifecycle states for one WorkItem. */
export type WorkItemState =
  | "PENDING"
  | "RUNNING"
  | "WAITING_DEPENDENCY"
  | "RETRY_WAIT"
  | "WAITING_RESTORE_RECONCILIATION"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "SUPERSEDED";

/** Selects whether a handler attempt resolves current or pinned configuration. */
export type WorkConfigurationBinding =
  | {
      readonly policy: "LATEST_COMPATIBLE_AT_ATTEMPT";
      readonly configRevisionRef?: undefined;
    }
  | {
      readonly policy: "CONFIG_PINNED";
      readonly configRevisionRef: string;
    };

/** Durable success outcome containing the bounded handler value. */
export interface WorkItemOutcomeSucceeded {
  readonly schemaVersion: 1;
  readonly kind: "SUCCEEDED";
  readonly value: CanonicalJsonValue;
}

/** Durable failure outcome with the classifier's retry category and reason. */
export interface WorkItemOutcomeFailed {
  readonly schemaVersion: 1;
  readonly kind: "FAILED";
  readonly retryClass: WorkRetryClass;
  readonly reasonCode: string;
}

/** Durable cancellation outcome recorded when work is intentionally stopped. */
export interface WorkItemOutcomeCancelled {
  readonly schemaVersion: 1;
  readonly kind: "CANCELLED";
  readonly reasonCode: string;
}

/** Durable outcome identifying work replaced by another WorkItem. */
export interface WorkItemOutcomeSuperseded {
  readonly schemaVersion: 1;
  readonly kind: "SUPERSEDED";
  readonly reasonCode: string;
  readonly supersededBy?: WorkItemId;
}

/** Union of terminal outcomes persisted for a WorkItem. */
export type WorkItemOutcome =
  | WorkItemOutcomeSucceeded
  | WorkItemOutcomeFailed
  | WorkItemOutcomeCancelled
  | WorkItemOutcomeSuperseded;

/** Canonical durable record for admitted work and its current dispatch state. */
export interface WorkItem {
  readonly schemaVersion: 1;
  readonly workItemId: WorkItemId;
  readonly handler: WorkHandlerTarget;
  readonly payload: CanonicalJsonValue;
  readonly queueProfileId: WorkQueueProfileId;
  readonly resourceAdmissionClass: ResourceAdmissionClassId;
  readonly partitionKey?: string;
  readonly priority: number;
  readonly notBefore?: Instant;
  readonly dedupKey?: string;
  readonly createdContinuityEpochId: ContinuityEpochId;
  readonly lineageContextRef: LineageContextRefV1;
  readonly configurationBinding: WorkConfigurationBinding;
  readonly restoreReplayClass: WorkHandlerRestoreReplayClass;
  readonly dispatchRevision: number;
  readonly activeAttemptId?: DispatchAttemptId;
  readonly state: WorkItemState;
  readonly retryClass?: WorkRetryClass;
  readonly stateReasonCode?: string;
  readonly cancelRequestedAt?: Instant;
  readonly cancellationReasonCode?: string;
  readonly supersededBy?: WorkItemId;
  readonly outcome?: WorkItemOutcome;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/** Policy result applied while creating a WorkItem. */
export type WorkCreationAdmissionDecision =
  | { readonly decision: "ALLOW" }
  | {
      readonly decision: "DELAY";
      readonly notBefore: Instant;
      readonly reasonCode: string;
    }
  | {
      readonly decision: "THROTTLE";
      readonly reasonCode: string;
      readonly notBefore?: Instant;
    }
  | { readonly decision: "REJECT_OPTIONAL"; readonly reasonCode: string }
  | { readonly decision: "REJECT_NEW_WORK"; readonly reasonCode: string };

/** Policy result applied immediately before dispatch. */
export type WorkDispatchAdmissionDecision =
  | { readonly decision: "ALLOW" }
  | { readonly decision: "DELAY"; readonly reasonCode: string }
  | { readonly decision: "THROTTLE"; readonly reasonCode: string };

/** Immutable dispatch envelope passed to the durable execution boundary. */
export interface DurableDispatchRequest {
  readonly workItemId: WorkItemId;
  readonly dispatchRevision: number;
  readonly dispatchAttemptId: DispatchAttemptId;
  readonly queueProfileId: WorkQueueProfileId;
  readonly priority: number;
  readonly partitionKey?: string;
  readonly notBefore?: Instant;
}

/** Port used to submit a previously admitted dispatch request. */
export interface DurableDispatchPort {
  /** Submit the request while preserving its revision and attempt identity. */
  dispatch(request: DurableDispatchRequest): Promise<void>;
}

/** Engine-independent failure shape consumed by the work classifier. */
export interface NormalizedWorkFailure {
  readonly reasonCode: string;
  readonly detail?: string;
}

/** Work item and normalized failure supplied to retry classification. */
export interface WorkErrorClassificationInput {
  readonly workItem: WorkItem;
  readonly failure: NormalizedWorkFailure;
}

/** Classifier result selecting terminal completion or a retry time. */
export type WorkErrorDecision =
  | {
      readonly kind: "TERMINAL";
      readonly retryClass: WorkRetryClass;
      readonly reasonCode: string;
    }
  | {
      readonly kind: "RETRY";
      readonly retryClass: WorkRetryClass;
      readonly reasonCode: string;
      readonly notBefore: Instant;
    };

/** Converts handler failures into the queue's durable retry decision. */
export interface WorkErrorClassifier {
  /** Classify one failed attempt without mutating queue state. */
  classify(input: WorkErrorClassificationInput): WorkErrorDecision;
}

/** Bounded runtime policy controlling payloads, scans, and anti-entropy. */
export interface WorkQueueRuntimeOptions {
  readonly maxInlinePayloadBytes: number;
  readonly maxOutcomeBytes: number;
  readonly reconciliationBatchSize: number;
  readonly antiEntropyIntervalMs: number;
}

/** Content-derived identity for one WorkItem dispatch revision. */
export type DispatchAttemptId = ContentDigest<"DispatchAttemptId">;
