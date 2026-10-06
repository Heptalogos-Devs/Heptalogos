// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the Host-fenced WorkItem repository and its canonical state
 * mutations, keeping SQL/Kysely details behind the Foundation integration seam.
 * @module repository
 */

import {
  canonicalizeJson,
  formatInstant,
  parseActivityId,
  parseContentDigest,
  parseContinuityEpochId,
  parseContributionId,
  parseInstanceId,
  parseInstant,
  parseMicroSystemId,
  parseWorkItemId,
  POSTGRES_INTEGER_MAX,
  ProblemError,
  type CanonicalJsonValue,
  type Instant,
  type MicroSystemId,
  type ContributionId,
  type PackageGenerationId,
  type ProductGenerationId,
  type WorkItemId,
} from "@heptalogos/foundation-contracts";
import type {
  PersistenceMutationTransactionContext,
  PersistenceReadTransactionContext,
  PersistenceService,
} from "@heptalogos/persistence";
import {
  useRepositoryMutationTransaction,
  useRepositoryReadTransaction,
  executeRepositorySql as executeSql,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type {
  DispatchAttemptId,
  ResourceAdmissionClassId,
  WorkConfigurationBinding,
  WorkItem,
  WorkItemOutcome,
  WorkItemState,
  WorkQueueProfileId,
  WorkRetryClass,
} from "./contracts.js";
import { workQueueProblem } from "./problems.js";

const WORK_ITEM_COLUMNS = `
  work_item_id,
  target_product_generation_id,
  handler_micro_system_id,
  handler_contribution_id,
  handler_package_generation_id,
  payload_version,
  payload,
  queue_profile_id,
  resource_admission_class,
  partition_key,
  priority,
  not_before,
  dedup_key,
  created_continuity_epoch_id,
  lineage_context_ref,
  configuration_binding_policy,
  config_revision_ref,
  restore_replay_class,
  dispatch_revision,
  active_attempt_id,
  state,
  retry_class,
  state_reason_code,
  cancel_requested_at,
  cancellation_reason_code,
  superseded_by,
  outcome,
  created_at,
  updated_at`;

const NON_TERMINAL_STATES = [
  "PENDING",
  "RUNNING",
  "WAITING_DEPENDENCY",
  "RETRY_WAIT",
  "WAITING_RESTORE_RECONCILIATION",
] as const;

const TERMINAL_STATES = new Set<WorkItemState>([
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "SUPERSEDED",
]);

const RETRY_CLASSES = new Set<WorkRetryClass>([
  "transient",
  "rate-limited",
  "dependency-unavailable",
  "not-configured",
  "policy-blocked",
  "invalid",
  "permanent",
  "external-effect-uncertain",
]);

const WORK_ITEM_STATES = new Set<WorkItemState>([
  ...NON_TERMINAL_STATES,
  ...TERMINAL_STATES,
]);

type WorkItemMutationStatus = "APPLIED" | "STALE" | "NOT_FOUND" | "TERMINAL";

/** Reports an optimistic-concurrency mutation and its current canonical item. */
export interface WorkItemMutationResult {
  readonly status: WorkItemMutationStatus;
  readonly item?: WorkItem;
}

/** Reports whether insert-or-deduplicate created or reused a canonical item. */
export interface WorkItemInsertResult {
  readonly status: "INSERTED" | "EXISTING";
  readonly item: WorkItem;
}

/** Optional same-transaction hook for an insert or deduplication result. */
export interface WorkItemInsertOptions {
  readonly onWithinTransaction?: (
    result: WorkItemInsertResult,
    transaction: PersistenceMutationTransactionContext,
  ) => Promise<void>;
}

/** Stable `(createdAt, workItemId)` cursor used for fair bounded scans. */
export interface WorkItemScanCursor {
  readonly createdAt: Instant;
  readonly workItemId: WorkItemId;
}

interface WorkItemDedupLookup {
  readonly handlerMicroSystemId: MicroSystemId;
  readonly handlerContributionId: ContributionId;
  readonly dedupKey: string;
}

interface MarkRunningInput {
  readonly workItemId: WorkItemId;
  readonly expectedDispatchRevision: number;
  readonly activeAttemptId: DispatchAttemptId;
  readonly updatedAt: Instant;
  readonly onApplied?: MutationAppliedHook;
}

interface MarkWaitingDependencyInput {
  readonly workItemId: WorkItemId;
  readonly expectedDispatchRevision: number;
  readonly updatedAt: Instant;
  readonly onApplied?: MutationAppliedHook;
}

interface WakeDependencyInput {
  readonly workItemId: WorkItemId;
  readonly expectedDispatchRevision: number;
  readonly updatedAt: Instant;
}

interface MarkRetryWaitInput {
  readonly workItemId: WorkItemId;
  readonly expectedDispatchRevision: number;
  readonly expectedState: "PENDING" | "RUNNING";
  readonly expectedActiveAttemptId?: DispatchAttemptId;
  readonly retryClass: WorkRetryClass;
  readonly reasonCode: string;
  readonly notBefore: Instant;
  readonly updatedAt: Instant;
  readonly onApplied?: MutationAppliedHook;
}

interface WakeDueRetryInput {
  readonly workItemId: WorkItemId;
  readonly expectedDispatchRevision: number;
  readonly now: Instant;
  readonly updatedAt: Instant;
}

interface RequestCancelInput {
  readonly workItemId: WorkItemId;
  readonly expectedDispatchRevision: number;
  readonly expectedState: Exclude<
    WorkItemState,
    "SUCCEEDED" | "FAILED" | "CANCELLED" | "SUPERSEDED"
  >;
  readonly expectedActiveAttemptId?: DispatchAttemptId;
  readonly requestedAt: Instant;
  readonly reasonCode: string;
}

interface RequestSupersedeInput extends Omit<RequestCancelInput, "reasonCode"> {
  readonly supersededBy: WorkItemId;
}

interface CommitTerminalInput {
  readonly workItemId: WorkItemId;
  readonly expectedDispatchRevision: number;
  readonly expectedState: "PENDING" | "RUNNING" | "RETRY_WAIT" | "WAITING_DEPENDENCY";
  readonly expectedActiveAttemptId?: DispatchAttemptId;
  readonly outcome: WorkItemOutcome;
  readonly updatedAt: Instant;
  readonly onApplied?: MutationAppliedHook;
}

/** Runs side effects inside the same mutation transaction after an applied change. */
export type MutationAppliedHook = (
  transaction: PersistenceMutationTransactionContext,
  item: WorkItem,
) => Promise<void>;

/** Foundation-backed owner of all canonical WorkItem reads and state mutations. */
export interface WorkQueueRepository {
  /** Insert a new item or return the existing non-terminal deduplication match. */
  insertWorkItem(
    item: WorkItem,
    options?: WorkItemInsertOptions,
  ): Promise<WorkItemInsertResult>;
  /** Read one item by its stable identity. */
  getWorkItem(workItemId: WorkItemId): Promise<WorkItem | undefined>;
  /** Find a non-terminal item matching the handler-scoped deduplication key. */
  findNonTerminalDedup(lookup: WorkItemDedupLookup): Promise<WorkItem | undefined>;
  /** Capture the upper cursor bound for a projection scan. */
  snapshotProjectionCeiling(): Promise<WorkItemScanCursor | undefined>;
  /** Read one fair page of pending projection candidates through the bound. */
  listProjectionCandidates(input: {
    readonly after?: WorkItemScanCursor;
    readonly through: WorkItemScanCursor;
    readonly limit: number;
  }): Promise<readonly WorkItem[]>;
  /** Capture the upper cursor bound for canonical RUNNING recovery scans. */
  snapshotRunningCeiling(): Promise<WorkItemScanCursor | undefined>;
  /** Read one fair page of canonical RUNNING items through the bound. */
  listRunning(input: {
    readonly after?: WorkItemScanCursor;
    readonly through: WorkItemScanCursor;
    readonly limit: number;
  }): Promise<readonly WorkItem[]>;
  /** Read retry-wait items whose not-before instant has arrived. */
  listDueRetry(input: {
    readonly now: Instant;
    readonly limit: number;
  }): Promise<readonly WorkItem[]>;
  /** Capture the upper cursor bound for dependency-waiting scans. */
  snapshotWaitingDependencyCeiling(): Promise<WorkItemScanCursor | undefined>;
  /** Read one fair page of dependency-waiting items through the bound. */
  listWaitingDependency(input: {
    readonly after?: WorkItemScanCursor;
    readonly through: WorkItemScanCursor;
    readonly limit: number;
  }): Promise<readonly WorkItem[]>;
  /** Claim a pending item for the exact dispatch attempt and revision. */
  markRunning(input: MarkRunningInput): Promise<WorkItemMutationResult>;
  /** Move a dispatch back to dependency waiting under optimistic fencing. */
  markWaitingDependency(
    input: MarkWaitingDependencyInput,
  ): Promise<WorkItemMutationResult>;
  /** Wake a dependency-waiting item when its exact revision is still current. */
  wakeDependency(input: WakeDependencyInput): Promise<WorkItemMutationResult>;
  /** Persist retry classification and the next eligible dispatch time. */
  markRetryWait(input: MarkRetryWaitInput): Promise<WorkItemMutationResult>;
  /** Wake an eligible retry item without accepting stale revisions. */
  wakeDueRetry(input: WakeDueRetryInput): Promise<WorkItemMutationResult>;
  /** Record a cancellation request for a still-live item. */
  requestCancel(input: RequestCancelInput): Promise<WorkItemMutationResult>;
  /** Record that a still-live item has been replaced by another item. */
  requestSupersede(input: RequestSupersedeInput): Promise<WorkItemMutationResult>;
  /** Commit one bounded terminal outcome with revision and attempt fencing. */
  commitTerminal(input: CommitTerminalInput): Promise<WorkItemMutationResult>;
}

function invalidItem(detail: string, cause?: unknown): ProblemError {
  return workQueueProblem("work_queue.invalid_work_item", detail, cause);
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidItem(`${field} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function jsonValue(value: unknown, field: string): WorkItem["payload"] {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch (cause) {
      throw invalidItem(`${field} is not valid JSON`, cause);
    }
  }
  try {
    canonicalizeJson(decoded as WorkItem["payload"]);
  } catch (cause) {
    throw invalidItem(`${field} is not canonical JSON`, cause);
  }
  return decoded as WorkItem["payload"];
}

function stringValue(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string") throw invalidItem(`${field} must be a string`);
  return value;
}

function nullableString(
  row: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = row[field];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw invalidItem(`${field} must be a string or null`);
  return value;
}

function safeInteger(value: unknown, field: string): number {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw invalidItem(`${field} must be a safe integer`);
    }
    return Number(value);
  }
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw invalidItem(`${field} must be a safe integer`);
}

function positiveSafeInteger(value: unknown, field: string): number {
  const parsed = safeInteger(value, field);
  if (parsed < 1) throw invalidItem(`${field} must be positive`);
  return parsed;
}

function persistedInstant(value: unknown, field: string): Instant | undefined {
  const instant = value instanceof Date ? formatInstant(value) : parseInstant(value);
  if (instant === undefined) throw invalidItem(`${field} must be a canonical Instant`);
  return instant;
}

function optionalPersistedInstant(value: unknown, field: string): Instant | undefined {
  if (value === null || value === undefined) return undefined;
  return persistedInstant(value, field);
}

function parseRetryClass(value: unknown, field: string): WorkRetryClass | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || !RETRY_CLASSES.has(value as WorkRetryClass)) {
    throw invalidItem(`${field} is not a supported retry class`);
  }
  return value as WorkRetryClass;
}

function parseState(value: unknown): WorkItemState {
  if (typeof value !== "string" || !WORK_ITEM_STATES.has(value as WorkItemState)) {
    throw invalidItem("state is not a supported WorkItem state");
  }
  return value as WorkItemState;
}

function parseLineageContextRef(value: unknown): WorkItem["lineageContextRef"] {
  const record = asRecord(value, "lineage_context_ref");
  if (record.schemaVersion !== 1) {
    throw invalidItem("lineage_context_ref.schemaVersion must be 1");
  }
  const sourceActivityId = parseActivityId(record.sourceActivityId);
  const sourceInstanceId = parseInstanceId(record.sourceInstanceId);
  const sourceContinuityEpoch = parseContinuityEpochId(record.sourceContinuityEpochId);
  if (
    sourceActivityId === undefined ||
    sourceInstanceId === undefined ||
    sourceContinuityEpoch === undefined
  ) {
    throw invalidItem("lineage_context_ref contains an invalid source identity");
  }
  const ref = {
    schemaVersion: 1,
    sourceActivityId,
    sourceInstanceId,
    sourceContinuityEpochId: sourceContinuityEpoch,
    ...(record.telemetry === undefined ? {} : { telemetry: record.telemetry as never }),
  } satisfies WorkItem["lineageContextRef"];
  return ref;
}

function parseConfigurationBinding(
  row: Record<string, unknown>,
): WorkConfigurationBinding {
  const policy = stringValue(row, "configuration_binding_policy");
  const configRevisionRef = nullableString(row, "config_revision_ref");
  if (policy === "LATEST_COMPATIBLE_AT_ATTEMPT" && configRevisionRef === undefined) {
    return { policy };
  }
  if (policy === "CONFIG_PINNED" && configRevisionRef !== undefined) {
    return { policy, configRevisionRef };
  }
  throw invalidItem("configuration binding policy and reference are incoherent");
}

function parseOutcome(value: unknown): WorkItemOutcome | undefined {
  if (value === null || value === undefined) return undefined;
  const record = asRecord(jsonValue(value, "outcome"), "outcome");
  if (record.schemaVersion !== 1 || typeof record.kind !== "string") {
    throw invalidItem("outcome schema is invalid");
  }
  if (record.kind === "SUCCEEDED") {
    return {
      schemaVersion: 1,
      kind: "SUCCEEDED",
      value: jsonValue(record.value, "outcome.value"),
    };
  }
  if (record.kind === "FAILED") {
    if (typeof record.reasonCode !== "string") {
      throw invalidItem("terminal outcome reasonCode is invalid");
    }
    const retryClass = parseRetryClass(record.retryClass, "outcome.retryClass");
    if (retryClass === undefined)
      throw invalidItem("failed outcome retryClass is missing");
    return {
      schemaVersion: 1,
      kind: "FAILED",
      retryClass,
      reasonCode: record.reasonCode,
    };
  }
  if (record.kind === "CANCELLED") {
    if (typeof record.reasonCode !== "string") {
      throw invalidItem("terminal outcome reasonCode is invalid");
    }
    return {
      schemaVersion: 1,
      kind: "CANCELLED",
      reasonCode: record.reasonCode,
    };
  }
  if (record.kind === "SUPERSEDED") {
    if (typeof record.reasonCode !== "string") {
      throw invalidItem("terminal outcome reasonCode is invalid");
    }
    const supersededBy =
      record.supersededBy === undefined || record.supersededBy === null
        ? undefined
        : parseWorkItemId(record.supersededBy);
    if (
      record.supersededBy !== undefined &&
      record.supersededBy !== null &&
      supersededBy === undefined
    ) {
      throw invalidItem("superseded outcome target is invalid");
    }
    return {
      schemaVersion: 1,
      kind: "SUPERSEDED",
      reasonCode: record.reasonCode,
      ...(supersededBy ? { supersededBy } : {}),
    };
  }
  throw invalidItem("outcome kind is unsupported");
}

function parsePersistedWorkItem(row: Record<string, unknown>): WorkItem {
  const workItemId = parseWorkItemId(row.work_item_id);
  const productGenerationId = parseContentDigest(
    "ProductGenerationId",
    row.target_product_generation_id,
  ) as ProductGenerationId | undefined;
  const microSystemId = parseMicroSystemId(row.handler_micro_system_id);
  const contributionId = parseContributionId(row.handler_contribution_id);
  const packageGenerationId = parseContentDigest(
    "PackageGenerationId",
    row.handler_package_generation_id,
  ) as PackageGenerationId | undefined;
  const queueProfileId = parseMicroSystemId(row.queue_profile_id) as
    WorkQueueProfileId | undefined;
  const resourceAdmissionClass = parseMicroSystemId(row.resource_admission_class) as
    ResourceAdmissionClassId | undefined;
  const createdContinuityEpochId = parseContinuityEpochId(
    row.created_continuity_epoch_id,
  );
  if (
    workItemId === undefined ||
    productGenerationId === undefined ||
    microSystemId === undefined ||
    contributionId === undefined ||
    packageGenerationId === undefined ||
    queueProfileId === undefined ||
    resourceAdmissionClass === undefined ||
    createdContinuityEpochId === undefined
  ) {
    throw invalidItem("WorkItem contains an invalid identity");
  }

  const payloadVersion = positiveSafeInteger(row.payload_version, "payload_version");
  if (payloadVersion > POSTGRES_INTEGER_MAX) {
    throw invalidItem("payload_version must be between 1 and 2147483647");
  }
  const priority = safeInteger(row.priority, "priority");
  if (priority < 1 || priority > 2_147_483_647) {
    throw invalidItem("priority must be between 1 and 2147483647");
  }
  const partitionKey = nullableString(row, "partition_key");
  const dedupKey = nullableString(row, "dedup_key");
  if (
    partitionKey !== undefined &&
    new TextEncoder().encode(partitionKey).byteLength > 256
  ) {
    throw invalidItem("partition_key exceeds 256 UTF-8 bytes");
  }
  if (dedupKey !== undefined && new TextEncoder().encode(dedupKey).byteLength > 256) {
    throw invalidItem("dedup_key exceeds 256 UTF-8 bytes");
  }

  const state = parseState(row.state);
  const activeAttemptIdValue = nullableString(row, "active_attempt_id");
  const activeAttemptId =
    activeAttemptIdValue === undefined
      ? undefined
      : (parseContentDigest("DispatchAttemptId", activeAttemptIdValue) as
          DispatchAttemptId | undefined);
  if (activeAttemptIdValue !== undefined && activeAttemptId === undefined) {
    throw invalidItem("active_attempt_id is not a valid DispatchAttemptId");
  }
  if ((activeAttemptId !== undefined) !== (state === "RUNNING")) {
    throw invalidItem("active_attempt_id is incoherent with state");
  }

  const retryClass = parseRetryClass(row.retry_class, "retry_class");
  const outcome = parseOutcome(row.outcome);
  if (TERMINAL_STATES.has(state) !== (outcome !== undefined)) {
    throw invalidItem("terminal state and outcome are incoherent");
  }
  if (outcome !== undefined && outcome.kind !== state) {
    throw invalidItem("terminal state and outcome kind are incoherent");
  }
  if (
    state === "FAILED" &&
    (outcome === undefined ||
      outcome.kind !== "FAILED" ||
      retryClass !== outcome.retryClass)
  ) {
    throw invalidItem(
      "failed WorkItem retryClass and outcome retryClass are incoherent",
    );
  }
  if (
    (state === "SUCCEEDED" || state === "CANCELLED" || state === "SUPERSEDED") &&
    retryClass !== undefined
  ) {
    throw invalidItem(
      "successful, cancelled, and superseded items cannot carry retryClass",
    );
  }
  if (state === "RETRY_WAIT" && (retryClass === undefined || row.not_before === null)) {
    throw invalidItem("RETRY_WAIT requires retryClass and not_before");
  }

  const supersededByValue = nullableString(row, "superseded_by");
  const supersededBy =
    supersededByValue === undefined ? undefined : parseWorkItemId(supersededByValue);
  if (supersededByValue !== undefined && supersededBy === undefined) {
    throw invalidItem("superseded_by is invalid");
  }
  const cancelRequestedAt = optionalPersistedInstant(
    row.cancel_requested_at,
    "cancel_requested_at",
  );
  const cancellationReasonCode = nullableString(row, "cancellation_reason_code");
  if (cancelRequestedAt !== undefined && supersededBy !== undefined) {
    throw invalidItem("cancel and supersession intents are mutually exclusive");
  }

  const restoreReplayClass = stringValue(row, "restore_replay_class");
  if (
    restoreReplayClass !== "RECONCILE_REQUIRED" &&
    restoreReplayClass !== "RESTORE_SAFE"
  ) {
    throw invalidItem("restore_replay_class is unsupported");
  }

  const target = {
    productGenerationId,
    microSystemId,
    contributionId,
    packageGenerationId,
    payloadVersion,
  };
  const item: WorkItem = {
    schemaVersion: 1,
    workItemId,
    handler: target,
    payload: jsonValue(row.payload, "payload"),
    queueProfileId,
    resourceAdmissionClass,
    ...(partitionKey === undefined ? {} : { partitionKey }),
    priority,
    ...(optionalPersistedInstant(row.not_before, "not_before") === undefined
      ? {}
      : { notBefore: optionalPersistedInstant(row.not_before, "not_before") }),
    ...(dedupKey === undefined ? {} : { dedupKey }),
    createdContinuityEpochId,
    lineageContextRef: parseLineageContextRef(row.lineage_context_ref),
    configurationBinding: parseConfigurationBinding(row),
    restoreReplayClass,
    dispatchRevision: positiveSafeInteger(row.dispatch_revision, "dispatch_revision"),
    ...(activeAttemptId === undefined ? {} : { activeAttemptId }),
    state,
    ...(retryClass === undefined ? {} : { retryClass }),
    ...(nullableString(row, "state_reason_code") === undefined
      ? {}
      : { stateReasonCode: nullableString(row, "state_reason_code") }),
    ...(cancelRequestedAt === undefined ? {} : { cancelRequestedAt }),
    ...(cancellationReasonCode === undefined ? {} : { cancellationReasonCode }),
    ...(supersededBy === undefined ? {} : { supersededBy }),
    ...(outcome === undefined ? {} : { outcome }),
    createdAt: persistedInstant(row.created_at, "created_at")!,
    updatedAt: persistedInstant(row.updated_at, "updated_at")!,
  };
  return item;
}

function parseScanCursor(row: Record<string, unknown>): WorkItemScanCursor {
  const workItemId = parseWorkItemId(row.work_item_id);
  const createdAt = persistedInstant(row.created_at, "created_at");
  if (workItemId === undefined || createdAt === undefined) {
    throw invalidItem("WorkItem scan cursor contains an invalid identity");
  }
  return { createdAt, workItemId };
}

function assertScanCursor(cursor: WorkItemScanCursor, field: string): void {
  if (
    parseInstant(cursor.createdAt) === undefined ||
    parseWorkItemId(cursor.workItemId) === undefined
  ) {
    throw workQueueProblem(
      "work_queue.invalid_work_item",
      `${field} is not a valid WorkItem scan cursor`,
    );
  }
}

async function selectLaneCeiling(
  transaction: PersistenceInternalTransaction,
  state: "PENDING" | "RUNNING" | "WAITING_DEPENDENCY",
): Promise<WorkItemScanCursor | undefined> {
  const rows = await executeSql(
    transaction,
    `SELECT created_at, work_item_id
     FROM "heptalogos"."work_item"
     WHERE state = '${state}'
     ORDER BY created_at DESC, work_item_id DESC
     LIMIT 1`,
  );
  return rows[0] === undefined ? undefined : parseScanCursor(rows[0]);
}

async function selectLanePage(
  transaction: PersistenceInternalTransaction,
  state: "PENDING" | "RUNNING" | "WAITING_DEPENDENCY",
  input: {
    readonly after?: WorkItemScanCursor;
    readonly through: WorkItemScanCursor;
    readonly limit: number;
  },
): Promise<readonly WorkItem[]> {
  if (!Number.isSafeInteger(input.limit) || input.limit <= 0) {
    throw workQueueProblem(
      "work_queue.invalid_options",
      "WorkItem scan limit must be a positive safe integer",
    );
  }
  assertScanCursor(input.through, "through");
  if (input.after !== undefined) assertScanCursor(input.after, "after");
  const rows = await executeSql(
    transaction,
    `SELECT ${WORK_ITEM_COLUMNS}
     FROM "heptalogos"."work_item"
     WHERE state = '${state}'
       AND ($1::timestamptz IS NULL OR
            (created_at, work_item_id) > ($1::timestamptz, $2::uuid))
       AND (created_at, work_item_id) <= ($3::timestamptz, $4::uuid)
     ORDER BY created_at ASC, work_item_id ASC
     LIMIT $5`,
    [
      input.after?.createdAt ?? null,
      input.after?.workItemId ?? null,
      input.through.createdAt,
      input.through.workItemId,
      input.limit,
    ],
  );
  return rows.map(parsePersistedWorkItem);
}

function assertPositiveRevision(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw workQueueProblem(
      "work_queue.invalid_work_item",
      `${field} must be a positive safe integer`,
    );
  }
}

function assertGuard(
  expectedState: WorkItemState,
  expectedActiveAttemptId: DispatchAttemptId | undefined,
): void {
  if (expectedState === "RUNNING" && expectedActiveAttemptId === undefined) {
    throw workQueueProblem(
      "work_queue.invalid_work_item",
      "RUNNING CAS operations require expectedActiveAttemptId",
    );
  }
  if (expectedState !== "RUNNING" && expectedActiveAttemptId !== undefined) {
    throw workQueueProblem(
      "work_queue.invalid_work_item",
      "Only RUNNING CAS operations accept expectedActiveAttemptId",
    );
  }
}

function updateGuard(
  workItemId: WorkItemId,
  expectedDispatchRevision: number,
  expectedState: WorkItemState,
  expectedActiveAttemptId: DispatchAttemptId | undefined,
): { readonly clause: string; readonly parameters: readonly unknown[] } {
  assertPositiveRevision(expectedDispatchRevision, "expectedDispatchRevision");
  assertGuard(expectedState, expectedActiveAttemptId);
  return expectedActiveAttemptId === undefined
    ? {
        clause: "work_item_id = $1 AND dispatch_revision = $2 AND state = $3",
        parameters: [workItemId, expectedDispatchRevision, expectedState],
      }
    : {
        clause:
          "work_item_id = $1 AND dispatch_revision = $2 AND state = $3 AND active_attempt_id = $4",
        parameters: [
          workItemId,
          expectedDispatchRevision,
          expectedState,
          expectedActiveAttemptId,
        ],
      };
}

function readContext(
  persistence: PersistenceService,
  operation: (transaction: PersistenceInternalTransaction) => Promise<unknown>,
): Promise<unknown> {
  return persistence.read((context: PersistenceReadTransactionContext) =>
    useRepositoryReadTransaction(context, operation),
  );
}

function mutationContext<T>(
  persistence: PersistenceService,
  operation: (
    transaction: PersistenceInternalTransaction,
    context: PersistenceMutationTransactionContext,
  ) => Promise<T>,
): Promise<T> {
  return persistence.mutate((context) =>
    useRepositoryMutationTransaction(context, (transaction) =>
      operation(transaction, context),
    ),
  );
}

async function selectById(
  transaction: PersistenceInternalTransaction,
  workItemId: WorkItemId,
): Promise<WorkItem | undefined> {
  const rows = await executeSql(
    transaction,
    `SELECT ${WORK_ITEM_COLUMNS} FROM "heptalogos"."work_item" WHERE work_item_id = $1`,
    [workItemId],
  );
  return rows[0] === undefined ? undefined : parsePersistedWorkItem(rows[0]);
}

async function casOutcome(
  transaction: PersistenceInternalTransaction,
  workItemId: WorkItemId,
): Promise<WorkItemMutationResult> {
  const item = await selectById(transaction, workItemId);
  if (item === undefined) return { status: "NOT_FOUND" };
  return TERMINAL_STATES.has(item.state)
    ? { status: "TERMINAL", item }
    : { status: "STALE", item };
}

async function applyCas(
  transaction: PersistenceInternalTransaction,
  context: PersistenceMutationTransactionContext,
  text: string,
  parameters: readonly unknown[],
  onApplied?: MutationAppliedHook,
): Promise<WorkItemMutationResult> {
  const rows = await executeSql(transaction, text, parameters);
  if (rows[0] === undefined) {
    return casOutcome(transaction, parameters[0] as WorkItemId);
  }
  const item = parsePersistedWorkItem(rows[0]);
  if (onApplied !== undefined) await onApplied(context, item);
  return { status: "APPLIED", item };
}

function serializeItem(item: WorkItem): readonly unknown[] {
  assertPositiveRevision(item.dispatchRevision, "dispatchRevision");
  const binding = item.configurationBinding;
  return [
    item.workItemId,
    item.handler.productGenerationId,
    item.handler.microSystemId,
    item.handler.contributionId,
    item.handler.packageGenerationId,
    item.handler.payloadVersion,
    canonicalizeJson(item.payload),
    item.queueProfileId,
    item.resourceAdmissionClass,
    item.partitionKey ?? null,
    item.priority,
    item.notBefore ?? null,
    item.dedupKey ?? null,
    item.createdContinuityEpochId,
    canonicalizeJson(item.lineageContextRef as unknown as CanonicalJsonValue),
    binding.policy,
    binding.configRevisionRef ?? null,
    item.restoreReplayClass,
    item.dispatchRevision,
    item.activeAttemptId ?? null,
    item.state,
    item.retryClass ?? null,
    item.stateReasonCode ?? null,
    item.cancelRequestedAt ?? null,
    item.cancellationReasonCode ?? null,
    item.supersededBy ?? null,
    item.outcome === undefined
      ? null
      : canonicalizeJson(item.outcome as unknown as CanonicalJsonValue),
    item.createdAt,
    item.updatedAt,
  ];
}

const INSERT_COLUMNS = WORK_ITEM_COLUMNS.replaceAll("\n", "").replaceAll("  ", "");

/**
 * Inserts or deduplicates one WorkItem in an already-open mutation transaction.
 * The caller owns the transaction lifetime; this helper performs no nested
 * persistence mutation and keeps WorkQueue SQL behind its repository boundary.
 */
export async function insertWorkItemWithinTransaction(
  transaction: PersistenceInternalTransaction,
  context: PersistenceMutationTransactionContext,
  item: WorkItem,
  options?: WorkItemInsertOptions,
): Promise<WorkItemInsertResult> {
  let insertResult: WorkItemInsertResult;
  const insertRows = await executeSql(
    transaction,
    `INSERT INTO "heptalogos"."work_item" (${INSERT_COLUMNS}) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
              $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
              $27, $28, $29
            ) ON CONFLICT (handler_micro_system_id, handler_contribution_id, dedup_key)
              WHERE dedup_key IS NOT NULL AND state IN (
                'PENDING', 'RUNNING', 'WAITING_DEPENDENCY', 'RETRY_WAIT',
                'WAITING_RESTORE_RECONCILIATION'
              ) DO NOTHING
            RETURNING ${WORK_ITEM_COLUMNS}`,
    serializeItem(item),
  );
  if (insertRows[0] !== undefined) {
    insertResult = {
      status: "INSERTED",
      item: parsePersistedWorkItem(insertRows[0]),
    };
    if (options?.onWithinTransaction !== undefined) {
      await options.onWithinTransaction(insertResult, context);
    }
    return insertResult;
  }

  if (item.dedupKey === undefined) {
    throw workQueueProblem(
      "work_queue.insert_conflict",
      "WorkItem insert did not return a row and has no dedup key to reconcile",
    );
  }
  const rows = await executeSql(
    transaction,
    `SELECT ${WORK_ITEM_COLUMNS}
           FROM "heptalogos"."work_item"
           WHERE handler_micro_system_id = $1
             AND handler_contribution_id = $2
             AND dedup_key = $3
             AND state IN ('PENDING', 'RUNNING', 'WAITING_DEPENDENCY', 'RETRY_WAIT', 'WAITING_RESTORE_RECONCILIATION')
           ORDER BY created_at ASC, work_item_id ASC
           LIMIT 1`,
    [item.handler.microSystemId, item.handler.contributionId, item.dedupKey],
  );
  if (rows[0] === undefined) {
    throw workQueueProblem(
      "work_queue.insert_conflict",
      "WorkItem deduplication conflict did not expose an existing non-terminal item",
    );
  }
  insertResult = {
    status: "EXISTING",
    item: parsePersistedWorkItem(rows[0]),
  };
  if (options?.onWithinTransaction !== undefined) {
    await options.onWithinTransaction(insertResult, context);
  }
  return insertResult;
}

/** Create the Foundation-owned WorkQueue repository over the supplied persistence service. */
export function createWorkQueueRepository(
  persistence: PersistenceService,
): WorkQueueRepository {
  return {
    async insertWorkItem(item, options) {
      return mutationContext(persistence, (transaction, context) =>
        insertWorkItemWithinTransaction(transaction, context, item, options),
      );
    },

    async getWorkItem(workItemId) {
      return (await readContext(persistence, (transaction) =>
        selectById(transaction, workItemId),
      )) as WorkItem | undefined;
    },

    async findNonTerminalDedup(lookup) {
      const rows = (await readContext(persistence, (transaction) =>
        executeSql(
          transaction,
          `SELECT ${WORK_ITEM_COLUMNS}
           FROM "heptalogos"."work_item"
           WHERE handler_micro_system_id = $1
             AND handler_contribution_id = $2
             AND dedup_key = $3
             AND state IN ('PENDING', 'RUNNING', 'WAITING_DEPENDENCY', 'RETRY_WAIT', 'WAITING_RESTORE_RECONCILIATION')
           ORDER BY created_at ASC, work_item_id ASC
           LIMIT 1`,
          [lookup.handlerMicroSystemId, lookup.handlerContributionId, lookup.dedupKey],
        ),
      )) as readonly Record<string, unknown>[];
      return rows[0] === undefined ? undefined : parsePersistedWorkItem(rows[0]);
    },

    async snapshotProjectionCeiling() {
      return (await readContext(persistence, (transaction) =>
        selectLaneCeiling(transaction, "PENDING"),
      )) as WorkItemScanCursor | undefined;
    },

    async listProjectionCandidates(input) {
      return (await readContext(persistence, (transaction) =>
        selectLanePage(transaction, "PENDING", input),
      )) as readonly WorkItem[];
    },

    async snapshotRunningCeiling() {
      return (await readContext(persistence, (transaction) =>
        selectLaneCeiling(transaction, "RUNNING"),
      )) as WorkItemScanCursor | undefined;
    },

    async listRunning(input) {
      return (await readContext(persistence, (transaction) =>
        selectLanePage(transaction, "RUNNING", input),
      )) as readonly WorkItem[];
    },

    async listDueRetry({ now, limit }) {
      const rows = (await readContext(persistence, (transaction) =>
        executeSql(
          transaction,
          `SELECT ${WORK_ITEM_COLUMNS}
           FROM "heptalogos"."work_item"
           WHERE state = 'RETRY_WAIT'
             AND not_before IS NOT NULL
             AND not_before <= $1
           ORDER BY not_before ASC, priority ASC, created_at ASC, work_item_id ASC
           LIMIT $2`,
          [now, limit],
        ),
      )) as readonly Record<string, unknown>[];
      return rows.map(parsePersistedWorkItem);
    },

    async snapshotWaitingDependencyCeiling() {
      return (await readContext(persistence, (transaction) =>
        selectLaneCeiling(transaction, "WAITING_DEPENDENCY"),
      )) as WorkItemScanCursor | undefined;
    },

    async listWaitingDependency(input) {
      return (await readContext(persistence, (transaction) =>
        selectLanePage(transaction, "WAITING_DEPENDENCY", input),
      )) as readonly WorkItem[];
    },

    async markRunning(input) {
      return mutationContext(persistence, (transaction, context) => {
        const guard = updateGuard(
          input.workItemId,
          input.expectedDispatchRevision,
          "PENDING",
          undefined,
        );
        return applyCas(
          transaction,
          context,
          `UPDATE "heptalogos"."work_item"
           SET state = 'RUNNING', active_attempt_id = $4,
               state_reason_code = NULL, updated_at = $5
           WHERE ${guard.clause}
             AND cancel_requested_at IS NULL
             AND superseded_by IS NULL
           RETURNING ${WORK_ITEM_COLUMNS}`,
          [...guard.parameters, input.activeAttemptId, input.updatedAt],
          input.onApplied,
        );
      });
    },

    async markWaitingDependency(input) {
      return mutationContext(persistence, (transaction, context) => {
        const guard = updateGuard(
          input.workItemId,
          input.expectedDispatchRevision,
          "PENDING",
          undefined,
        );
        return applyCas(
          transaction,
          context,
          `UPDATE "heptalogos"."work_item"
           SET state = 'WAITING_DEPENDENCY', state_reason_code = 'handler-unavailable',
               updated_at = $4
           WHERE ${guard.clause}
             AND cancel_requested_at IS NULL
             AND superseded_by IS NULL
           RETURNING ${WORK_ITEM_COLUMNS}`,
          [...guard.parameters, input.updatedAt],
          input.onApplied,
        );
      });
    },

    async wakeDependency(input) {
      return mutationContext(persistence, (transaction, context) => {
        const guard = updateGuard(
          input.workItemId,
          input.expectedDispatchRevision,
          "WAITING_DEPENDENCY",
          undefined,
        );
        return applyCas(
          transaction,
          context,
          `UPDATE "heptalogos"."work_item"
           SET state = 'PENDING', dispatch_revision = dispatch_revision + 1,
               state_reason_code = NULL, updated_at = $4
           WHERE ${guard.clause}
             AND cancel_requested_at IS NULL
             AND superseded_by IS NULL
           RETURNING ${WORK_ITEM_COLUMNS}`,
          [...guard.parameters, input.updatedAt],
        );
      });
    },

    async markRetryWait(input) {
      return mutationContext(persistence, (transaction, context) => {
        const guard = updateGuard(
          input.workItemId,
          input.expectedDispatchRevision,
          input.expectedState,
          input.expectedActiveAttemptId,
        );
        return applyCas(
          transaction,
          context,
          `UPDATE "heptalogos"."work_item"
           SET state = CASE
                 WHEN cancel_requested_at IS NOT NULL THEN 'CANCELLED'
                 WHEN superseded_by IS NOT NULL THEN 'SUPERSEDED'
                 ELSE 'RETRY_WAIT'
               END,
               active_attempt_id = NULL,
               retry_class = CASE
                 WHEN cancel_requested_at IS NOT NULL OR superseded_by IS NOT NULL THEN NULL
                 ELSE $${guard.parameters.length + 1}
               END,
               state_reason_code = CASE
                 WHEN cancel_requested_at IS NOT NULL THEN COALESCE(cancellation_reason_code, 'cancellation-requested')
                 WHEN superseded_by IS NOT NULL THEN 'superseded-by-request'
                 ELSE $${guard.parameters.length + 2}
               END,
               not_before = CASE
                 WHEN cancel_requested_at IS NOT NULL OR superseded_by IS NOT NULL THEN not_before
                 ELSE $${guard.parameters.length + 3}
               END,
               outcome = CASE
                 WHEN cancel_requested_at IS NOT NULL THEN jsonb_build_object(
                   'schemaVersion', 1, 'kind', 'CANCELLED',
                   'reasonCode', COALESCE(cancellation_reason_code, 'cancellation-requested')
                 )
                 WHEN superseded_by IS NOT NULL THEN jsonb_build_object(
                   'schemaVersion', 1, 'kind', 'SUPERSEDED',
                   'reasonCode', 'superseded-by-request', 'supersededBy', superseded_by
                 )
                 ELSE NULL
               END,
               updated_at = $${guard.parameters.length + 4}
           WHERE ${guard.clause}
           RETURNING ${WORK_ITEM_COLUMNS}`,
          [
            ...guard.parameters,
            input.retryClass,
            input.reasonCode,
            input.notBefore,
            input.updatedAt,
          ],
          input.onApplied,
        );
      });
    },

    async wakeDueRetry(input) {
      return mutationContext(persistence, (transaction, context) => {
        const guard = updateGuard(
          input.workItemId,
          input.expectedDispatchRevision,
          "RETRY_WAIT",
          undefined,
        );
        return applyCas(
          transaction,
          context,
          `UPDATE "heptalogos"."work_item"
           SET state = 'PENDING', dispatch_revision = dispatch_revision + 1,
               active_attempt_id = NULL, retry_class = NULL,
               state_reason_code = NULL, updated_at = $4
           WHERE ${guard.clause}
             AND cancel_requested_at IS NULL
             AND superseded_by IS NULL
             AND not_before IS NOT NULL AND not_before <= $5
           RETURNING ${WORK_ITEM_COLUMNS}`,
          [...guard.parameters, input.updatedAt, input.now],
        );
      });
    },

    async requestCancel(input) {
      return mutationContext(persistence, (transaction, context) => {
        const guard = updateGuard(
          input.workItemId,
          input.expectedDispatchRevision,
          input.expectedState,
          input.expectedActiveAttemptId,
        );
        return applyCas(
          transaction,
          context,
          `UPDATE "heptalogos"."work_item"
           SET state = CASE
                 WHEN state IN ('PENDING', 'WAITING_DEPENDENCY', 'RETRY_WAIT')
                   THEN 'CANCELLED'
                 ELSE state
               END,
               retry_class = CASE
                 WHEN state IN ('PENDING', 'WAITING_DEPENDENCY', 'RETRY_WAIT')
                   THEN NULL
                 ELSE retry_class
               END,
               state_reason_code = CASE
                 WHEN state IN ('PENDING', 'WAITING_DEPENDENCY', 'RETRY_WAIT')
                   THEN $${guard.parameters.length + 2}::text
                 ELSE state_reason_code
               END,
               cancel_requested_at = $${guard.parameters.length + 1},
               cancellation_reason_code = $${guard.parameters.length + 2}::text,
               outcome = CASE
                 WHEN state IN ('PENDING', 'WAITING_DEPENDENCY', 'RETRY_WAIT')
                   THEN jsonb_build_object(
                     'schemaVersion', 1, 'kind', 'CANCELLED',
                     'reasonCode', $${guard.parameters.length + 2}::text
                   )
                 ELSE outcome
               END,
               updated_at = $${guard.parameters.length + 1}
           WHERE ${guard.clause}
             AND cancel_requested_at IS NULL
             AND superseded_by IS NULL
           RETURNING ${WORK_ITEM_COLUMNS}`,
          [...guard.parameters, input.requestedAt, input.reasonCode],
        );
      });
    },

    async requestSupersede(input) {
      return mutationContext(persistence, (transaction, context) => {
        const guard = updateGuard(
          input.workItemId,
          input.expectedDispatchRevision,
          input.expectedState,
          input.expectedActiveAttemptId,
        );
        return applyCas(
          transaction,
          context,
          `UPDATE "heptalogos"."work_item"
           SET state = CASE
                 WHEN state IN ('PENDING', 'WAITING_DEPENDENCY', 'RETRY_WAIT')
                   THEN 'SUPERSEDED'
                 ELSE state
               END,
               retry_class = CASE
                 WHEN state IN ('PENDING', 'WAITING_DEPENDENCY', 'RETRY_WAIT')
                   THEN NULL
                 ELSE retry_class
               END,
               state_reason_code = CASE
                 WHEN state IN ('PENDING', 'WAITING_DEPENDENCY', 'RETRY_WAIT')
                   THEN 'superseded-by-request'
                 ELSE state_reason_code
               END,
               superseded_by = $${guard.parameters.length + 1},
               outcome = CASE
                 WHEN state IN ('PENDING', 'WAITING_DEPENDENCY', 'RETRY_WAIT')
                   THEN jsonb_build_object(
                     'schemaVersion', 1, 'kind', 'SUPERSEDED',
                     'reasonCode', 'superseded-by-request',
                     'supersededBy', $${guard.parameters.length + 1}::uuid
                   )
                 ELSE outcome
               END,
               updated_at = $${guard.parameters.length + 2}
           WHERE ${guard.clause}
             AND cancel_requested_at IS NULL
             AND superseded_by IS NULL
           RETURNING ${WORK_ITEM_COLUMNS}`,
          [...guard.parameters, input.supersededBy, input.requestedAt],
        );
      });
    },

    async commitTerminal(input) {
      return mutationContext(persistence, (transaction, context) => {
        const guard = updateGuard(
          input.workItemId,
          input.expectedDispatchRevision,
          input.expectedState,
          input.expectedActiveAttemptId,
        );
        const terminalState = input.outcome.kind;
        return applyCas(
          transaction,
          context,
          `UPDATE "heptalogos"."work_item"
           SET state = CASE
                 WHEN cancel_requested_at IS NOT NULL THEN 'CANCELLED'
                 WHEN superseded_by IS NOT NULL THEN 'SUPERSEDED'
                 ELSE $${guard.parameters.length + 1}
               END,
               active_attempt_id = NULL,
               retry_class = CASE
                 WHEN cancel_requested_at IS NOT NULL OR superseded_by IS NOT NULL THEN NULL
                 ELSE $${guard.parameters.length + 2}
               END,
               state_reason_code = CASE
                 WHEN cancel_requested_at IS NOT NULL THEN COALESCE(cancellation_reason_code, 'cancellation-requested')
                 WHEN superseded_by IS NOT NULL THEN 'superseded-by-request'
                 ELSE $${guard.parameters.length + 3}
               END,
               outcome = CASE
                 WHEN cancel_requested_at IS NOT NULL THEN jsonb_build_object(
                   'schemaVersion', 1, 'kind', 'CANCELLED',
                   'reasonCode', COALESCE(cancellation_reason_code, 'cancellation-requested')
                 )
                 WHEN superseded_by IS NOT NULL THEN jsonb_build_object(
                   'schemaVersion', 1, 'kind', 'SUPERSEDED',
                   'reasonCode', 'superseded-by-request', 'supersededBy', superseded_by
                 )
                 ELSE $${guard.parameters.length + 4}
               END,
               updated_at = $${guard.parameters.length + 5}
           WHERE ${guard.clause}
           RETURNING ${WORK_ITEM_COLUMNS}`,
          [
            ...guard.parameters,
            terminalState,
            input.outcome.kind === "FAILED" ? input.outcome.retryClass : null,
            "reasonCode" in input.outcome ? input.outcome.reasonCode : null,
            canonicalizeJson(input.outcome as unknown as CanonicalJsonValue),
            input.updatedAt,
          ],
          input.onApplied,
        );
      });
    },
  };
}
