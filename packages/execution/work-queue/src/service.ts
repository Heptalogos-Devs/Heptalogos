// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Constructs the WorkQueue runtime service that composes admission, repository,
 * Signal wakeups, and generation-pinned execution under one owner.
 * @module service
 */

import {
  POSTGRES_INTEGER_MAX,
  parseContentDigest,
  parseContributionId,
  parseInstant,
  parseMicroSystemId,
  snapshotCanonicalJson,
  createWorkItemId,
  type CanonicalJsonValue,
  type Instant,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionContext,
  ExecutionContextRuntime,
  ExecutionLineageService,
} from "@heptalogos/execution-lineage";
import type {
  PersistenceMutationTransactionContext,
  PersistenceService,
} from "@heptalogos/persistence";
import type {
  RuntimeWorkHandlerLease,
  WorkHandlerProvisionDescriptor,
} from "@heptalogos/runtime-kernel";
import { useRepositoryMutationTransaction } from "@heptalogos/persistence/repository";
import { createSignalTopic, type SignalPublisher } from "@heptalogos/signal";
import type { TimeService } from "@heptalogos/time-service";
import { applyWorkAdmissionDecision, type WorkAdmissionPort } from "./admission.js";
import type {
  ResourceAdmissionClassId,
  WorkConfigurationBinding,
  WorkHandlerTarget,
  WorkItem,
  WorkQueueProfileCatalog,
  WorkQueueRuntimeOptions,
  WorkQueueProfileId,
} from "./contracts.js";
import { isWorkQueueProfilePartitioned } from "./contracts.js";
import {
  insertWorkItemWithinTransaction,
  type WorkItemInsertResult,
} from "./repository.js";
import { workQueueProblem } from "./problems.js";

/** Signal topic used to prompt reconciliation after a committed WorkItem insert. */
export const WORK_AVAILABLE_TOPIC = createSignalTopic("work.available");

/** Untrusted request normalized before a WorkItem enters durable storage. */
export interface WorkCreationRequest {
  readonly target: WorkHandlerTarget;
  readonly payload: unknown;
  readonly queueProfileId: WorkQueueProfileId;
  readonly resourceAdmissionClass: ResourceAdmissionClassId;
  readonly partitionKey?: string;
  readonly priority: number;
  readonly notBefore?: Instant;
  readonly dedupKey?: string;
  readonly configurationBinding?: WorkConfigurationBinding;
}

/** Reports whether creation inserted a new item or reused a deduplicated item. */
export interface WorkCreationResult {
  readonly status: "CREATED" | "EXISTING";
  readonly item: WorkItem;
}

/** Ephemeral validated WorkItem creation prepared for a caller transaction. */
export interface PreparedWorkCreation {
  readonly target: WorkHandlerTarget;
  readonly payload: CanonicalJsonValue;
  readonly queueProfileId: WorkQueueProfileId;
  readonly resourceAdmissionClass: ResourceAdmissionClassId;
  readonly partitionKey?: string;
  readonly priority: number;
  readonly notBefore?: Instant;
  readonly dedupKey?: string;
  readonly configurationBinding: WorkConfigurationBinding;
  readonly restoreReplayClass: WorkHandlerProvisionDescriptor["restoreReplayClass"];
  readonly createdContinuityEpochId: ExecutionContext["origin"]["continuityEpochId"];
  readonly source: ExecutionContext;
  readonly stateReasonCode?: string;
}

/** Resolves an exact generation-bound handler lease for admission and execution. */
export interface WorkHandlerResolver {
  /** Return the handler lease only when the target matches an active generation. */
  resolve(target: WorkHandlerTarget): RuntimeWorkHandlerLease | undefined;
}

/** Service dependencies, policy, and reporting hooks for durable work creation. */
export interface WorkQueueServiceOptions {
  readonly persistence: PersistenceService;
  readonly handlerRegistry: WorkHandlerResolver;
  readonly execution: ExecutionContextRuntime;
  readonly lineage: ExecutionLineageService;
  readonly time: TimeService;
  readonly signalPublisher: SignalPublisher;
  readonly admission: WorkAdmissionPort;
  readonly profiles: WorkQueueProfileCatalog;
  readonly runtimeOptions: WorkQueueRuntimeOptions;
  readonly onBackgroundError: (error: unknown) => void;
}

/** Admits and persists WorkItems through the owning persistence and lineage seams. */
export interface WorkQueueService {
  /** Validate and admit a WorkItem without opening a persistence transaction. */
  prepareCreate(request: WorkCreationRequest): Promise<PreparedWorkCreation>;
  /** Commit one prepared WorkItem in the caller's existing mutation transaction. */
  commitPrepared(
    transaction: PersistenceMutationTransactionContext,
    prepared: PreparedWorkCreation,
  ): Promise<WorkCreationResult>;
  /** Validate, admit, deduplicate, persist, and signal one WorkItem request. */
  create(request: WorkCreationRequest): Promise<WorkCreationResult>;
}

/** Validate all positive bounded runtime controls before starting queue services. */
export function validateWorkQueueRuntimeOptions(
  options: WorkQueueRuntimeOptions,
): void {
  for (const [name, value] of [
    ["maxInlinePayloadBytes", options.maxInlinePayloadBytes],
    ["maxOutcomeBytes", options.maxOutcomeBytes],
    ["reconciliationBatchSize", options.reconciliationBatchSize],
    ["antiEntropyIntervalMs", options.antiEntropyIntervalMs],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw workQueueProblem(
        "work_queue.invalid_options",
        `${name} must be a positive safe integer`,
      );
    }
  }
}

function assertBoundedOptional(value: unknown, name: string): void {
  if (value === undefined) return;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).byteLength > 256
  ) {
    throw workQueueProblem(
      "work.request.invalid",
      `${name} must be non-empty and at most 256 UTF-8 bytes`,
    );
  }
}

function assertPriority(priority: number): void {
  if (!Number.isSafeInteger(priority) || priority < 1 || priority > 2_147_483_647) {
    throw workQueueProblem(
      "work.request.invalid",
      "priority must be between 1 and 2147483647",
    );
  }
}

function assertTarget(target: WorkHandlerTarget): void {
  if (
    parseContentDigest("ProductGenerationId", target.productGenerationId) ===
      undefined ||
    parseContentDigest("PackageGenerationId", target.packageGenerationId) ===
      undefined ||
    parseMicroSystemId(target.microSystemId) === undefined ||
    parseContributionId(target.contributionId) === undefined ||
    !Number.isSafeInteger(target.payloadVersion) ||
    target.payloadVersion < 1 ||
    target.payloadVersion > POSTGRES_INTEGER_MAX
  ) {
    throw workQueueProblem(
      "work.request.invalid",
      "WorkHandler target contains an invalid generation, contribution, or payload version",
    );
  }
}

function canonicalPayload(
  lease: RuntimeWorkHandlerLease,
  target: WorkHandlerTarget,
  value: unknown,
  maximumBytes: number,
): CanonicalJsonValue {
  const validated = lease.validatePayload(target.payloadVersion, value);
  let snapshot: ReturnType<typeof snapshotCanonicalJson>;
  try {
    snapshot = snapshotCanonicalJson(validated as CanonicalJsonValue);
  } catch (cause) {
    throw workQueueProblem(
      "work.payload.invalid",
      "WorkHandler payload is not canonical JSON",
      cause,
    );
  }
  if (snapshot.utf8ByteLength > maximumBytes) {
    throw workQueueProblem(
      "work.payload.too_large",
      "WorkHandler payload exceeds maxInlinePayloadBytes",
    );
  }
  return snapshot.value;
}

function requestedNotBefore(value: Instant | undefined): Instant | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInstant(value);
  if (parsed === undefined) {
    throw workQueueProblem(
      "work.request.invalid",
      "notBefore must be a canonical Instant",
    );
  }
  return parsed;
}

function configurationBinding(
  descriptor: WorkHandlerProvisionDescriptor,
  requested: WorkConfigurationBinding | undefined,
): WorkConfigurationBinding {
  if (descriptor.configurationBindingPolicy !== "LATEST_COMPATIBLE_AT_ATTEMPT") {
    throw workQueueProblem(
      "work.configuration.binding_unavailable",
      "No ConfigurationRevision resolver is composed for CONFIG_PINNED WorkHandlers",
    );
  }
  if (requested !== undefined) {
    if (
      requested.policy === "CONFIG_PINNED" ||
      requested.configRevisionRef !== undefined
    ) {
      throw workQueueProblem(
        "work.configuration.binding_unavailable",
        "CONFIG_PINNED WorkItem creation requires a composed ConfigurationRevision resolver",
      );
    }
    if (requested.policy !== descriptor.configurationBindingPolicy) {
      throw workQueueProblem(
        "work.request.invalid",
        "Requested configuration binding does not match the exact WorkHandler descriptor",
      );
    }
  }
  return { policy: "LATEST_COMPATIBLE_AT_ATTEMPT" };
}

function admissionReason(
  decision: Parameters<typeof applyWorkAdmissionDecision>[1],
): string | undefined {
  return decision.decision === "DELAY" || decision.decision === "THROTTLE"
    ? decision.reasonCode
    : undefined;
}

/** Create the WorkQueue service with explicit admission, handler, and signal owners. */
export function createWorkQueueService(
  options: WorkQueueServiceOptions,
): WorkQueueService {
  validateWorkQueueRuntimeOptions(options.runtimeOptions);
  if (
    options.admission === undefined ||
    typeof options.admission.beforeCreate !== "function"
  ) {
    throw workQueueProblem(
      "work.admission.required",
      "WorkQueueService requires an explicit WorkAdmissionPort",
    );
  }
  if (typeof options.onBackgroundError !== "function") {
    throw workQueueProblem(
      "work.request.invalid",
      "WorkQueueService requires a background error sink",
    );
  }
  if (options.profiles === undefined || typeof options.profiles.get !== "function") {
    throw workQueueProblem(
      "work.queue.profile_catalog_required",
      "WorkQueueService requires an explicit WorkQueueProfileCatalog",
    );
  }
  const prepareCreate = async (
    request: WorkCreationRequest,
  ): Promise<PreparedWorkCreation> => {
    const target: WorkHandlerTarget = Object.freeze({
      productGenerationId: request.target.productGenerationId,
      microSystemId: request.target.microSystemId,
      contributionId: request.target.contributionId,
      packageGenerationId: request.target.packageGenerationId,
      payloadVersion: request.target.payloadVersion,
    });
    const payloadInput = request.payload;
    const queueProfileId = request.queueProfileId;
    const resourceAdmissionClass = request.resourceAdmissionClass;
    const partitionKey = request.partitionKey;
    const priority = request.priority;
    const notBeforeInput = request.notBefore;
    const dedupKey = request.dedupKey;
    const configurationBindingInput = request.configurationBinding;
    const source = options.execution.current();
    if (source === undefined) {
      throw workQueueProblem(
        "work.context.required",
        "Durable WorkItem creation requires a current ExecutionContext",
      );
    }
    assertTarget(target);
    assertPriority(priority);
    assertBoundedOptional(partitionKey, "partitionKey");
    assertBoundedOptional(dedupKey, "dedupKey");
    const notBefore = requestedNotBefore(notBeforeInput);
    const lease = options.handlerRegistry.resolve(target);
    if (lease === undefined) {
      throw workQueueProblem(
        "work.handler.unavailable",
        "No exact generation-bound WorkHandler is available for the requested target",
      );
    }
    const descriptor = lease.descriptor;
    if (queueProfileId !== descriptor.queueProfileId) {
      throw workQueueProblem(
        "work.queue.profile_mismatch",
        "WorkItem queueProfileId does not match the exact WorkHandler descriptor",
      );
    }
    const profile = options.profiles.get(queueProfileId);
    if (profile === undefined) {
      throw workQueueProblem(
        "work.queue.profile_unavailable",
        "WorkItem queueProfileId is not present in the Host-composed profile catalog",
      );
    }
    const partitioned = isWorkQueueProfilePartitioned(profile);
    if (partitioned && partitionKey === undefined) {
      throw workQueueProblem(
        "work.queue.partition_required",
        "Partitioned WorkQueue profiles require a partitionKey",
      );
    }
    if (!partitioned && partitionKey !== undefined) {
      throw workQueueProblem(
        "work.queue.partition_not_supported",
        "Unpartitioned WorkQueue profiles do not accept a partitionKey",
      );
    }
    if (resourceAdmissionClass !== descriptor.resourceAdmissionClass) {
      throw workQueueProblem(
        "work.resource-admission.mismatch",
        "WorkItem resourceAdmissionClass does not match the exact WorkHandler descriptor",
      );
    }
    const payload = canonicalPayload(
      lease,
      target,
      payloadInput,
      options.runtimeOptions.maxInlinePayloadBytes,
    );
    const binding = configurationBinding(descriptor, configurationBindingInput);
    const lineageContextRef = options.execution.createLineageContextRef();
    const admissionRequest = {
      execution: source,
      target,
      payload,
      queueProfileId,
      resourceAdmissionClass,
      ...(partitionKey === undefined ? {} : { partitionKey }),
      priority,
      ...(notBefore === undefined ? {} : { notBefore }),
      ...(dedupKey === undefined ? {} : { dedupKey }),
      configurationBinding: binding,
      createdContinuityEpochId: source.origin.continuityEpochId,
      lineageContextRef,
      handlerMicroSystemId: target.microSystemId,
      handlerContributionId: target.contributionId,
    };
    const decision = await options.admission.beforeCreate(admissionRequest);
    const effectiveNotBefore = applyWorkAdmissionDecision(notBefore, decision);
    const stateReasonCode = admissionReason(decision);
    return Object.freeze({
      target,
      payload,
      queueProfileId,
      resourceAdmissionClass,
      ...(partitionKey === undefined ? {} : { partitionKey }),
      priority,
      ...(effectiveNotBefore === undefined ? {} : { notBefore: effectiveNotBefore }),
      ...(dedupKey === undefined ? {} : { dedupKey }),
      configurationBinding: binding,
      restoreReplayClass: descriptor.restoreReplayClass,
      createdContinuityEpochId: source.origin.continuityEpochId,
      source,
      ...(stateReasonCode === undefined ? {} : { stateReasonCode }),
    });
  };

  const commitPreparedWithinTransaction = async (
    transaction: PersistenceMutationTransactionContext,
    prepared: PreparedWorkCreation,
    activityLifecycle?: ExecutionContext,
  ): Promise<WorkCreationResult> => {
    const activity = options.execution.current();
    if (
      activity === undefined ||
      activity.activityId !== transaction.execution.activityId
    ) {
      throw workQueueProblem(
        "work.context.required",
        "Prepared WorkItem commit requires the caller's current Activity",
      );
    }
    const result = await (async () => {
      const createdAt = options.time.now();
      const workLineageContextRef = options.execution.createLineageContextRef();
      const item: WorkItem = {
        schemaVersion: 1,
        workItemId: createWorkItemId(),
        handler: prepared.target,
        payload: prepared.payload,
        queueProfileId: prepared.queueProfileId,
        resourceAdmissionClass: prepared.resourceAdmissionClass,
        ...(prepared.partitionKey === undefined
          ? {}
          : { partitionKey: prepared.partitionKey }),
        priority: prepared.priority,
        ...(prepared.notBefore === undefined ? {} : { notBefore: prepared.notBefore }),
        ...(prepared.dedupKey === undefined ? {} : { dedupKey: prepared.dedupKey }),
        createdContinuityEpochId: prepared.createdContinuityEpochId,
        lineageContextRef: workLineageContextRef,
        configurationBinding: prepared.configurationBinding,
        restoreReplayClass: prepared.restoreReplayClass,
        dispatchRevision: 1,
        state: "PENDING",
        ...(prepared.stateReasonCode === undefined
          ? {}
          : { stateReasonCode: prepared.stateReasonCode }),
        createdAt,
        updatedAt: createdAt,
      };
      return useRepositoryMutationTransaction(transaction, (databaseTransaction) =>
        insertWorkItemWithinTransaction(databaseTransaction, transaction, item, {
          onWithinTransaction: async (
            inserted: WorkItemInsertResult,
            mutationTransaction: PersistenceMutationTransactionContext,
          ) => {
            if (activityLifecycle !== undefined) {
              await options.lineage.retainCurrent(
                mutationTransaction,
                activityLifecycle,
              );
            }
            if (inserted.status === "INSERTED") {
              await options.signalPublisher.publish(
                mutationTransaction,
                WORK_AVAILABLE_TOPIC,
              );
            }
            if (activityLifecycle !== undefined) {
              await options.lineage.completeCurrent(
                mutationTransaction,
                activityLifecycle,
                {
                  endedAt: options.time.now(),
                  outcome: "SUCCEEDED",
                  outcomeRef: inserted.status === "INSERTED" ? "CREATED" : "EXISTING",
                },
              );
            }
          },
        }),
      );
    })();
    const creationResult: WorkCreationResult = {
      status: result.status === "INSERTED" ? "CREATED" : "EXISTING",
      item: result.item,
    };
    return creationResult;
  };

  const commitPrepared = (
    transaction: PersistenceMutationTransactionContext,
    prepared: PreparedWorkCreation,
  ): Promise<WorkCreationResult> =>
    commitPreparedWithinTransaction(transaction, prepared);

  return {
    prepareCreate,
    commitPrepared,
    async create(request): Promise<WorkCreationResult> {
      const prepared = await prepareCreate(request);
      return options.execution.runActivity(
        {
          kind: "work.create",
          importance: "significant",
          retentionClass: "operational",
          sensitivity: "operational",
        },
        async (activity) =>
          options.persistence.mutate((transaction) =>
            commitPreparedWithinTransaction(transaction, prepared, activity),
          ),
      );
    },
  };
}
