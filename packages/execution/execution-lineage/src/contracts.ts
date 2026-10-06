// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines Activity, ExecutionContext, and lineage service contracts that carry
 * causal identity across Foundation operations and persistence boundaries.
 * @module contracts
 */

import type {
  ActivityId,
  BootId,
  ContinuityEpochId,
  ContributionId,
  HostOwnershipToken,
  InstallationId,
  Instant,
  InstanceId,
  MicroSystemId,
  MicroSystemInstanceId,
  PackageGenerationId,
  ProductGenerationId,
  RetentionClass,
  Sensitivity,
} from "@heptalogos/foundation-contracts";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";

/** Identifies the product/runtime origin of an Activity. */
export interface RuntimeExecutionOrigin {
  readonly productGenerationId: ProductGenerationId;
  readonly packageGenerationId?: PackageGenerationId;
  readonly microSystemId?: MicroSystemId;
  readonly microSystemInstanceId?: MicroSystemInstanceId;
  readonly contributionId?: ContributionId;
}

/** Identifies the installation, boot, and Host fence of an Activity. */
export interface HostExecutionOrigin {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly continuityEpochId: ContinuityEpochId;
  readonly hostOwnershipToken: HostOwnershipToken;
  readonly runtime?: RuntimeExecutionOrigin;
}

/** Classifies the operational importance and retention pressure of an Activity. */
export type ActivityImportance = "diagnostic" | "routine" | "significant" | "critical";

/** Links one Activity to another through causal or lifecycle semantics. */
export interface ActivityLink {
  readonly kind: "linked-to" | "supersedes" | "resumes" | "fan-out" | "fan-in";
  readonly targetActivityId: ActivityId;
}

/** Carries observational trace correlation without becoming Activity identity. */
export interface ActivityTelemetryCorrelation {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
}

/** Canonical causal context carried by Foundation operations and retained evidence. */
export interface ExecutionContext {
  readonly activityId: ActivityId;
  readonly kind: string;
  readonly startedAt: Instant;
  readonly parentActivityId?: ActivityId;
  readonly causationActivityId?: ActivityId;
  readonly links: readonly ActivityLink[];
  readonly origin: HostExecutionOrigin;
  readonly semantic: Readonly<{
    operationId?: string;
    featureId?: string;
    serviceId?: string;
    capabilityId?: string;
    providerId?: string;
    contractVersion?: string;
  }>;
  readonly importance: ActivityImportance;
  readonly retentionClass: RetentionClass;
  readonly sensitivity: Sensitivity;
  readonly telemetry?: ActivityTelemetryCorrelation;
}

/** Supplies semantic and governance inputs for creating an Activity context. */
export interface ActivityRequest {
  readonly kind: string;
  readonly causationActivityId?: ActivityId;
  readonly links?: readonly ActivityLink[];
  readonly semantic?: ExecutionContext["semantic"];
  readonly importance: ActivityImportance;
  readonly retentionClass: RetentionClass;
  readonly sensitivity: Sensitivity;
}

/** Records the terminal outcome of an Activity. */
export interface ActivityCompletion {
  readonly endedAt: Instant;
  readonly outcome: "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly outcomeRef?: string;
}

/** Versioned durable reference used to resume lineage across process boundaries. */
export interface LineageContextRefV1 {
  readonly schemaVersion: 1;
  readonly sourceActivityId: ActivityId;
  readonly sourceInstanceId: InstanceId;
  readonly sourceContinuityEpochId: ContinuityEpochId;
  readonly telemetry?: ActivityTelemetryCorrelation;
}

/** Current lineage-reference contract. */
export type LineageContextRef = LineageContextRefV1;

/** Carries a Bootstrap Activity for retention after the normal Host handoff. */
export interface BootstrapRetainedActivityDraft {
  readonly activityId: ActivityId;
  readonly startedAt: Instant;
  readonly endedAt: Instant;
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly continuityEpochId: ContinuityEpochId;
  readonly outcome: "SUCCEEDED" | "FAILED";
  readonly outcomeRef?: string;
}

/** Persists current and Bootstrap lineage through Host-fenced transactions. */
export interface ExecutionLineageService {
  /** Retains the current Activity context before its operation proceeds. */
  retainCurrent(
    transaction: PersistenceMutationTransactionContext,
    context: ExecutionContext,
  ): Promise<void>;
  /** Completes the current Activity with its terminal outcome. */
  completeCurrent(
    transaction: PersistenceMutationTransactionContext,
    context: ExecutionContext,
    completion: ActivityCompletion,
  ): Promise<void>;
  /** Retains a Bootstrap handoff Activity from its durable journal projection. */
  retainBootstrapReference(
    transaction: PersistenceMutationTransactionContext,
    draft: BootstrapRetainedActivityDraft,
  ): Promise<void>;
}

/** Carries process-local Activity context and lineage resume operations. */
export interface ExecutionContextRuntime {
  /** Returns the current context, if the caller is inside an Activity. */
  current(): ExecutionContext | undefined;
  /** Runs an operation under a newly created Activity context. */
  runActivity<T>(
    request: ActivityRequest,
    operation: (context: ExecutionContext) => Promise<T>,
  ): Promise<T>;
  /** Captures the current context for later callback invocation. */
  capture<TArgs extends readonly unknown[], TResult>(
    callback: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult;
  /** Creates a durable lineage reference for the current Activity. */
  createLineageContextRef(): LineageContextRefV1;
  /** Resumes an Activity from a validated durable lineage reference. */
  runFromLineageContextRef<T>(
    ref: LineageContextRefV1,
    request: Omit<ActivityRequest, "causationActivityId">,
    operation: (context: ExecutionContext) => Promise<T>,
  ): Promise<T>;
}
