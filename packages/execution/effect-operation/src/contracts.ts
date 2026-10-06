// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the versioned EffectOperation contract and the narrow adapter port
 * that observes external effect knowledge without owning retry policy.
 * @module contracts
 */

import type {
  CanonicalJsonSnapshot,
  CanonicalJsonValue,
  EffectKindId,
  EffectOperationId,
  HostOwnershipToken,
  Instant,
  Problem,
} from "@heptalogos/foundation-contracts";
import {
  formatInstant,
  parseEffectKindId,
  parseEffectOperationId,
  parseHostOwnershipToken,
  parseInstant,
  parseProblem,
  snapshotCanonicalJson,
} from "@heptalogos/foundation-contracts";
import type { LineageContextRef } from "@heptalogos/execution-lineage";
import { decodeLineageContextRef } from "@heptalogos/execution-lineage";
import {
  invalidEffectRowProblem,
  invalidEffectRequestProblem,
  unsupportedEffectSchemaProblem,
} from "./problems.js";

/** The canonical states of one consequential external effect operation. */
export type EffectOperationState =
  "PREPARED" | "DISPATCHING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN";

/** The durable V1 outcome of an admitted effect dispatch. */
export type EffectOutcome =
  | {
      readonly schemaVersion: 1;
      readonly status: "SUCCEEDED";
      readonly receipt?: CanonicalJsonValue;
    }
  | {
      readonly schemaVersion: 1;
      readonly status: "FAILED";
      readonly problem: Problem;
    }
  | {
      readonly schemaVersion: 1;
      readonly status: "UNCERTAIN";
      readonly problem?: Problem;
    };

/** Canonical durable truth for one external effect request. */
export interface EffectOperation {
  readonly schemaVersion: 1;
  readonly effectOperationId: EffectOperationId;
  readonly effectKind: EffectKindId;
  readonly requestVersion: number;
  readonly request: CanonicalJsonValue;
  readonly state: EffectOperationState;
  readonly lineageContextRef: LineageContextRef;
  readonly dispatchHostOwnershipToken?: HostOwnershipToken;
  readonly outcome?: EffectOutcome;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/** Caller-supplied immutable request envelope for preparation. */
export interface EffectPreparationRequest {
  readonly effectOperationId: EffectOperationId;
  readonly effectKind: EffectKindId;
  readonly requestVersion: number;
  readonly request: unknown;
}

/** Result of an idempotent or first-time preparation. */
export interface EffectPreparationResult {
  readonly status: "CREATED" | "EXISTING";
  readonly operation: EffectOperation;
}

/** Knowledge returned by an effect-specific external dispatch adapter. */
export type EffectDispatchResult =
  | { readonly status: "SUCCEEDED"; readonly receipt?: CanonicalJsonValue }
  | { readonly status: "FAILED"; readonly problem: Problem }
  | { readonly status: "UNCERTAIN"; readonly problem?: Problem };

/** Knowledge returned by a read-only reconciliation adapter. */
export type EffectReconciliationResult =
  | { readonly status: "SUCCEEDED"; readonly receipt?: CanonicalJsonValue }
  | { readonly status: "FAILED"; readonly problem: Problem }
  | { readonly status: "UNKNOWN" };

/** Per-effect adapter boundary; it does not provide retry or scheduling policy. */
export interface EffectDispatchPort {
  /** Identifies the effect kind implemented by this adapter. */
  readonly effectKind: EffectKindId;
  /** Performs the one admitted external write attempt. */
  dispatch(input: {
    readonly effectOperationId: EffectOperationId;
    readonly externalRequestKey: string;
    readonly requestVersion: number;
    readonly request: CanonicalJsonValue;
    readonly signal: AbortSignal;
  }): Promise<EffectDispatchResult>;
  /** Observes an existing external effect without performing another write. */
  reconcile?(input: {
    readonly effectOperationId: EffectOperationId;
    readonly externalRequestKey: string;
    readonly requestVersion: number;
    readonly request: CanonicalJsonValue;
    readonly signal: AbortSignal;
  }): Promise<EffectReconciliationResult>;
}

/** Canonical EffectOperation service owned by this package. */
export interface EffectOperationService {
  /** Reads canonical effect truth. */
  get(effectOperationId: EffectOperationId): Promise<EffectOperation | undefined>;
  /** Persists or idempotently observes an immutable effect request. */
  prepare(request: EffectPreparationRequest): Promise<EffectPreparationResult>;
  /** Admits and performs at most one dispatch for the operation. */
  dispatch(
    effectOperationId: EffectOperationId,
    port: EffectDispatchPort,
    options?: { readonly signal?: AbortSignal },
  ): Promise<EffectOperation>;
  /** Recovers an explicitly abandoned DISPATCHING operation without dispatching. */
  recoverDispatch(effectOperationId: EffectOperationId): Promise<EffectOperation>;
  /** Refines UNCERTAIN only through a read-only reconciliation observation. */
  reconcile(
    effectOperationId: EffectOperationId,
    port: EffectDispatchPort,
    options?: { readonly signal?: AbortSignal },
  ): Promise<EffectOperation>;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function decodedJson(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (cause) {
    throw invalidEffectRowProblem(`${field} is not valid JSON`, cause);
  }
}

/** Canonicalizes an unknown caller request without mutating the caller value. */
export function snapshotEffectRequest(value: unknown): CanonicalJsonSnapshot {
  try {
    return snapshotCanonicalJson(value as CanonicalJsonValue);
  } catch (cause) {
    throw invalidEffectRequestProblem(
      "Effect request must be a canonical JSON value",
      cause,
    );
  }
}

/** Strictly normalizes a canonical Problem embedded in an adapter/result row. */
export function normalizeEffectProblem(value: unknown): Problem | undefined {
  return parseProblem(decodedJson(value, "problem"));
}

function persistedInstant(value: unknown): Instant | undefined {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return formatInstant(value);
  }
  return parseInstant(value);
}

function normalizedOutcome(
  value: unknown,
  expectedState: EffectOperationState,
): EffectOutcome | undefined {
  const record = recordValue(decodedJson(value, "outcome"));
  if (record === undefined || record.schemaVersion !== 1) return undefined;
  const status = record.status;
  if (
    typeof status !== "string" ||
    status !== expectedState ||
    !["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(status)
  ) {
    return undefined;
  }
  const allowed =
    status === "SUCCEEDED"
      ? new Set(["schemaVersion", "status", "receipt"])
      : new Set(["schemaVersion", "status", "problem"]);
  if (Object.keys(record).some((key) => !allowed.has(key))) return undefined;
  if (status === "SUCCEEDED") {
    let receipt: CanonicalJsonValue | undefined;
    if (record.receipt !== undefined) {
      try {
        receipt = snapshotCanonicalJson(record.receipt as CanonicalJsonValue).value;
      } catch {
        return undefined;
      }
    }
    return Object.freeze({
      schemaVersion: 1 as const,
      status: "SUCCEEDED" as const,
      ...(receipt === undefined ? {} : { receipt }),
    });
  }
  const problem =
    record.problem === undefined ? undefined : normalizeEffectProblem(record.problem);
  if (status === "FAILED" && problem === undefined) return undefined;
  return Object.freeze({
    schemaVersion: 1 as const,
    status,
    ...(problem === undefined ? {} : { problem }),
  }) as EffectOutcome;
}

/** Strictly parses one PostgreSQL row into the immutable V1 domain contract. */
export function parseEffectOperationRow(
  input: Record<string, unknown>,
): EffectOperation {
  const effectOperationId = parseEffectOperationId(input.effect_operation_id);
  if (effectOperationId === undefined) {
    throw invalidEffectRowProblem("effect_operation_id is not a UUIDv7");
  }
  if (
    typeof input.schema_version !== "number" ||
    !Number.isInteger(input.schema_version)
  ) {
    throw invalidEffectRowProblem("schema_version is not an integer");
  }
  if (input.schema_version !== 1) throw unsupportedEffectSchemaProblem();
  const effectKind = parseEffectKindId(input.effect_kind);
  if (effectKind === undefined) {
    throw invalidEffectRowProblem("effect_kind is not a namespaced EffectKindId");
  }
  if (
    typeof input.request_version !== "number" ||
    !Number.isInteger(input.request_version) ||
    input.request_version < 1
  ) {
    throw invalidEffectRowProblem("request_version must be a positive integer");
  }
  const state = input.state;
  if (
    state !== "PREPARED" &&
    state !== "DISPATCHING" &&
    state !== "SUCCEEDED" &&
    state !== "FAILED" &&
    state !== "UNCERTAIN"
  ) {
    throw invalidEffectRowProblem("state is not supported");
  }
  let request: CanonicalJsonValue;
  try {
    request = snapshotCanonicalJson(
      decodedJson(input.request, "request") as CanonicalJsonValue,
    ).value;
  } catch (cause) {
    throw invalidEffectRowProblem("request is not canonical JSON", cause);
  }
  let lineageContextRef: LineageContextRef;
  try {
    lineageContextRef = decodeLineageContextRef(
      decodedJson(input.lineage_context_ref, "lineage_context_ref"),
    );
  } catch (cause) {
    throw invalidEffectRowProblem("lineage_context_ref is invalid", cause);
  }
  const dispatchTokenValue = input.dispatch_host_ownership_token;
  const dispatchHostOwnershipToken =
    dispatchTokenValue === null || dispatchTokenValue === undefined
      ? undefined
      : parseHostOwnershipToken(dispatchTokenValue);
  if (dispatchTokenValue !== null && dispatchTokenValue !== undefined) {
    if (dispatchHostOwnershipToken === undefined) {
      throw invalidEffectRowProblem("dispatch_host_ownership_token is invalid");
    }
  }
  const outcomeValue = input.outcome;
  const outcome =
    outcomeValue === null || outcomeValue === undefined
      ? undefined
      : normalizedOutcome(outcomeValue, state);
  if (
    state === "PREPARED" &&
    (dispatchHostOwnershipToken !== undefined || outcome !== undefined)
  ) {
    throw invalidEffectRowProblem("PREPARED cannot carry dispatch token or outcome");
  }
  if (
    state === "DISPATCHING" &&
    (dispatchHostOwnershipToken === undefined || outcome !== undefined)
  ) {
    throw invalidEffectRowProblem(
      "DISPATCHING requires a dispatch token and no outcome",
    );
  }
  if (
    ["SUCCEEDED", "FAILED", "UNCERTAIN"].includes(state) &&
    (dispatchHostOwnershipToken === undefined || outcome === undefined)
  ) {
    throw invalidEffectRowProblem("terminal effect state requires token and outcome");
  }
  const createdAt = persistedInstant(input.created_at);
  const updatedAt = persistedInstant(input.updated_at);
  if (createdAt === undefined || updatedAt === undefined) {
    throw invalidEffectRowProblem(
      "created_at and updated_at must be canonical Instants",
    );
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    effectOperationId,
    effectKind,
    requestVersion: input.request_version,
    request,
    state,
    lineageContextRef,
    ...(dispatchHostOwnershipToken === undefined ? {} : { dispatchHostOwnershipToken }),
    ...(outcome === undefined ? {} : { outcome }),
    createdAt,
    updatedAt,
  });
}
