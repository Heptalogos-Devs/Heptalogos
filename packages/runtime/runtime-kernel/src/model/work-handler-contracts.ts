// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines generation-pinned WorkHandler declarations and leases used by
 * engine-neutral durable work dispatch without importing an execution engine.
 * @module work-handler-contracts
 */

import type {
  ContributionId,
  MicroSystemId,
  NamespacedId,
  PackageGenerationId,
  ProductGenerationId,
  WorkItemId,
} from "@heptalogos/foundation-contracts";
import type { ContractVersion, RuntimeContractData } from "./contracts.js";
import type { RuntimeActivityRunner } from "@heptalogos/execution-lineage/runtime-kernel";
import type { GenerationFence } from "../generation/generation-fence.js";

/** Identifies the WorkQueue profile selected by a WorkHandler. */
export type WorkQueueProfileId = NamespacedId<"WorkQueueProfileId">;
/** Identifies the resource admission class selected by a WorkHandler. */
export type ResourceAdmissionClassId = NamespacedId<"ResourceAdmissionClassId">;

/** Selects how a handler binds to configuration at attempt time. */
export type WorkHandlerConfigurationBindingPolicy =
  "CONFIG_PINNED" | "LATEST_COMPATIBLE_AT_ATTEMPT";
/** Selects whether restore replays or reconciles a handler obligation. */
export type WorkHandlerRestoreReplayClass = "RECONCILE_REQUIRED" | "RESTORE_SAFE";

/** Describes one versioned payload schema accepted by a WorkHandler. */
export interface WorkHandlerPayloadContract {
  readonly version: number;
  readonly schema: Readonly<Record<string, unknown>>;
}

/** Declares queue, resource, payload, and outcome policy for a WorkHandler. */
export interface WorkHandlerProvisionDescriptor {
  readonly contributionId: ContributionId;
  readonly contractVersion: ContractVersion;
  readonly payloadContracts: readonly WorkHandlerPayloadContract[];
  readonly outcomeSchema: Readonly<Record<string, unknown>>;
  readonly queueProfileId: WorkQueueProfileId;
  readonly resourceAdmissionClass: ResourceAdmissionClassId;
  readonly configurationBindingPolicy: WorkHandlerConfigurationBindingPolicy;
  readonly restoreReplayClass: WorkHandlerRestoreReplayClass;
}

/** Carries one generation-pinned WorkItem invocation into a handler. */
export interface RuntimeWorkHandlerInvocation {
  readonly workItemId: WorkItemId;
  readonly dispatchRevision: number;
  readonly payloadVersion: number;
  readonly payload: RuntimeContractData;
  readonly signal: AbortSignal;
}

/** Carries the engine-neutral outcome returned by a WorkHandler. */
export interface RuntimeWorkHandlerResult {
  readonly outcome: RuntimeContractData;
}

/** Reserves one handler invocation and releases its generation fence. */
export interface RuntimeWorkHandlerInvocationReservation {
  /** Executes the reserved handler invocation. */
  execute(input: RuntimeWorkHandlerInvocation): Promise<RuntimeWorkHandlerResult>;
  /** Releases the reservation without executing it. */
  release(): void;
}

/** Minimal handler implementation contract used by the queue executor. */
export interface RuntimeWorkHandler {
  /** Executes one validated, generation-pinned WorkItem attempt. */
  execute(input: RuntimeWorkHandlerInvocation): Promise<RuntimeWorkHandlerResult>;
}

/** Identifies the exact product/package/MicroSystem handler target. */
export interface WorkHandlerTarget {
  readonly productGenerationId: ProductGenerationId;
  readonly microSystemId: MicroSystemId;
  readonly contributionId: ContributionId;
  readonly packageGenerationId: PackageGenerationId;
  readonly payloadVersion: number;
}

/** Identifies the Runtime owner that registered a WorkHandler. */
export interface WorkHandlerRegistrationOwner {
  readonly microSystemId: MicroSystemId;
  readonly productGenerationId: ProductGenerationId;
  readonly packageGenerationId: PackageGenerationId;
}

/** Exposes validation and invocation reservation for one handler target. */
export interface RuntimeWorkHandlerLease {
  readonly target: WorkHandlerTarget;
  readonly descriptor: WorkHandlerProvisionDescriptor;
  readonly runtimeActivity?: RuntimeActivityRunner;
  /** Validates and returns a payload within the declared handler contract. */
  validatePayload(version: number, value: unknown): RuntimeContractData;
  /** Reserves a generation-fenced handler invocation. */
  reserveInvocation(): RuntimeWorkHandlerInvocationReservation;
}

/** Internal registry record coupling a handler to its generation fence. */
export interface WorkHandlerRegistration {
  readonly owner: WorkHandlerRegistrationOwner;
  readonly descriptor: WorkHandlerProvisionDescriptor;
  readonly implementation: RuntimeWorkHandler;
  readonly fence: GenerationFence;
  readonly runtimeActivity?: RuntimeActivityRunner;
}
