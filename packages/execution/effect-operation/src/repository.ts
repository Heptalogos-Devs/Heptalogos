// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns exact EffectOperation SQL/CAS transitions while keeping PostgreSQL and
 * transaction handles behind the persistence Foundation seam.
 * @module repository
 */

import type {
  PersistenceMutationTransactionContext,
  PersistenceReadTransactionContext,
} from "@heptalogos/persistence";
import {
  executeRepositorySql,
  useRepositoryMutationTransaction,
  useRepositoryReadTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type { CanonicalJsonValue } from "@heptalogos/foundation-contracts";
import { canonicalizeJson } from "@heptalogos/foundation-contracts";
import type {
  EffectKindId,
  EffectOperationId,
  Instant,
} from "@heptalogos/foundation-contracts";
import type { CanonicalJsonSnapshot } from "@heptalogos/foundation-contracts";
import type { LineageContextRef } from "@heptalogos/execution-lineage";
import type { EffectOperation, EffectOutcome } from "./contracts.js";
import { parseEffectOperationRow } from "./contracts.js";
import {
  effectHostFenceProblem,
  effectIdentityConflictProblem,
  effectInvalidTransitionProblem,
  effectNotFoundProblem,
} from "./problems.js";

const operationColumns = `
  effect_operation_id, schema_version, effect_kind, request_version, request,
  state, lineage_context_ref, dispatch_host_ownership_token, outcome,
  created_at, updated_at`;

interface PreparedEffectInput {
  readonly effectOperationId: EffectOperationId;
  readonly effectKind: EffectKindId;
  readonly requestVersion: number;
  readonly request: CanonicalJsonSnapshot;
  readonly lineageContextRef: LineageContextRef;
  readonly createdAt: Instant;
}

/** Reports whether a Host-fenced dispatch compare-and-set won. */
interface EffectDispatchAdmission {
  readonly status: "ADMITTED" | "OBSERVED";
  readonly operation: EffectOperation;
}

/** Reports whether a DISPATCHING recovery transition changed canonical truth. */
interface EffectRecoveryResult {
  readonly changed: boolean;
  readonly operation: EffectOperation;
}

/** Reports whether a reconciliation refinement changed canonical truth. */
interface EffectRefinementResult {
  readonly changed: boolean;
  readonly operation: EffectOperation;
}

/** Internal repository contract used by the EffectOperation service. */
export interface EffectOperationRepository {
  /** Reads one operation in a read-only transaction. */
  get(
    context: PersistenceReadTransactionContext,
    id: EffectOperationId,
  ): Promise<EffectOperation | undefined>;
  /** Reads one operation inside a Host-fenced mutation transaction. */
  getInMutation(
    context: PersistenceMutationTransactionContext,
    id: EffectOperationId,
  ): Promise<EffectOperation | undefined>;
  /** Inserts PREPARED truth or checks an existing immutable identity. */
  insertPrepared(
    context: PersistenceMutationTransactionContext,
    input: PreparedEffectInput,
  ): Promise<{
    readonly status: "CREATED" | "EXISTING";
    readonly operation: EffectOperation;
  }>;
  /** Performs the only PREPARED-to-DISPATCHING admission compare-and-set. */
  beginDispatch(
    context: PersistenceMutationTransactionContext,
    id: EffectOperationId,
    updatedAt: Instant,
  ): Promise<EffectDispatchAdmission>;
  /** Completes an admitted dispatch under its Host ownership token. */
  completeDispatch(
    context: PersistenceMutationTransactionContext,
    id: EffectOperationId,
    outcome: EffectOutcome,
    updatedAt: Instant,
  ): Promise<EffectOperation>;
  /** Recovers durable DISPATCHING truth to stable UNCERTAIN. */
  recoverDispatchAsUncertain(
    context: PersistenceMutationTransactionContext,
    id: EffectOperationId,
    outcome: EffectOutcome,
    updatedAt: Instant,
  ): Promise<EffectRecoveryResult>;
  /** Applies a read-only reconciliation refinement from UNCERTAIN. */
  refineUncertain(
    context: PersistenceMutationTransactionContext,
    id: EffectOperationId,
    outcome: Extract<EffectOutcome, { readonly status: "SUCCEEDED" | "FAILED" }>,
    updatedAt: Instant,
  ): Promise<EffectRefinementResult>;
}

async function selectById(
  transaction: PersistenceInternalTransaction,
  id: EffectOperationId,
): Promise<EffectOperation | undefined> {
  const rows = await executeRepositorySql<Record<string, unknown>>(
    transaction,
    `SELECT ${operationColumns}
       FROM "heptalogos"."effect_operation"
      WHERE effect_operation_id = $1`,
    [id],
  );
  const row = rows[0];
  return row === undefined ? undefined : parseEffectOperationRow(row);
}

function sameImmutableRequest(
  operation: EffectOperation,
  input: PreparedEffectInput,
): boolean {
  return (
    operation.effectOperationId === input.effectOperationId &&
    operation.effectKind === input.effectKind &&
    operation.requestVersion === input.requestVersion &&
    canonicalizeJson(operation.request as CanonicalJsonValue) ===
      input.request.canonical
  );
}

/** Creates the stateless canonical EffectOperation repository. */
export function createEffectOperationRepository(): EffectOperationRepository {
  return {
    async get(context, id) {
      return useRepositoryReadTransaction(context, (transaction) =>
        selectById(transaction, id),
      );
    },

    async getInMutation(context, id) {
      return useRepositoryMutationTransaction(context, (transaction) =>
        selectById(transaction, id),
      );
    },

    async insertPrepared(context, input) {
      return useRepositoryMutationTransaction(context, async (transaction) => {
        const inserted = await executeRepositorySql<Record<string, unknown>>(
          transaction,
          `INSERT INTO "heptalogos"."effect_operation" (
             effect_operation_id, schema_version, effect_kind, request_version,
             request, state, lineage_context_ref,
             dispatch_host_ownership_token, outcome, created_at, updated_at
           ) VALUES ($1, 1, $2, $3, $4::jsonb, 'PREPARED', $5::jsonb, NULL, NULL, $6, $6)
           ON CONFLICT (effect_operation_id) DO NOTHING
           RETURNING ${operationColumns}`,
          [
            input.effectOperationId,
            input.effectKind,
            input.requestVersion,
            input.request.canonical,
            JSON.stringify(input.lineageContextRef),
            input.createdAt,
          ],
        );
        const insertedRow = inserted[0];
        if (insertedRow !== undefined) {
          return {
            status: "CREATED" as const,
            operation: parseEffectOperationRow(insertedRow),
          };
        }
        const existing = await selectById(transaction, input.effectOperationId);
        if (existing === undefined) throw effectNotFoundProblem();
        if (!sameImmutableRequest(existing, input)) {
          throw effectIdentityConflictProblem();
        }
        return { status: "EXISTING" as const, operation: existing };
      });
    },

    async beginDispatch(context, id, updatedAt) {
      return useRepositoryMutationTransaction(context, async (transaction) => {
        const admitted = await executeRepositorySql<Record<string, unknown>>(
          transaction,
          `UPDATE "heptalogos"."effect_operation"
              SET state = 'DISPATCHING',
                  dispatch_host_ownership_token = $2,
                  updated_at = $3
            WHERE effect_operation_id = $1 AND state = 'PREPARED'
            RETURNING ${operationColumns}`,
          [id, context.execution.hostOwnershipToken, updatedAt],
        );
        const admittedRow = admitted[0];
        if (admittedRow !== undefined) {
          return {
            status: "ADMITTED" as const,
            operation: parseEffectOperationRow(admittedRow),
          };
        }
        const existing = await selectById(transaction, id);
        if (existing === undefined) throw effectNotFoundProblem();
        return { status: "OBSERVED" as const, operation: existing };
      });
    },

    async completeDispatch(context, id, outcome, updatedAt) {
      return useRepositoryMutationTransaction(context, async (transaction) => {
        const completed = await executeRepositorySql<Record<string, unknown>>(
          transaction,
          `UPDATE "heptalogos"."effect_operation"
              SET state = $3,
                  outcome = $4::jsonb,
                  updated_at = $5
            WHERE effect_operation_id = $1
              AND state = 'DISPATCHING'
              AND dispatch_host_ownership_token = $2
            RETURNING ${operationColumns}`,
          [
            id,
            context.execution.hostOwnershipToken,
            outcome.status,
            JSON.stringify(outcome),
            updatedAt,
          ],
        );
        const completedRow = completed[0];
        if (completedRow !== undefined) return parseEffectOperationRow(completedRow);
        const existing = await selectById(transaction, id);
        if (existing === undefined) throw effectNotFoundProblem();
        if (existing.state === "DISPATCHING") throw effectHostFenceProblem();
        throw effectInvalidTransitionProblem(existing.state, outcome.status);
      });
    },

    async recoverDispatchAsUncertain(context, id, outcome, updatedAt) {
      return useRepositoryMutationTransaction(context, async (transaction) => {
        const recovered = await executeRepositorySql<Record<string, unknown>>(
          transaction,
          `UPDATE "heptalogos"."effect_operation"
              SET state = 'UNCERTAIN',
                  outcome = $2::jsonb,
                  updated_at = $3
            WHERE effect_operation_id = $1 AND state = 'DISPATCHING'
            RETURNING ${operationColumns}`,
          [id, JSON.stringify(outcome), updatedAt],
        );
        const recoveredRow = recovered[0];
        if (recoveredRow !== undefined) {
          return { changed: true, operation: parseEffectOperationRow(recoveredRow) };
        }
        const existing = await selectById(transaction, id);
        if (existing === undefined) throw effectNotFoundProblem();
        return { changed: false, operation: existing };
      });
    },

    async refineUncertain(context, id, outcome, updatedAt) {
      return useRepositoryMutationTransaction(context, async (transaction) => {
        const refined = await executeRepositorySql<Record<string, unknown>>(
          transaction,
          `UPDATE "heptalogos"."effect_operation"
              SET state = $2,
                  outcome = $3::jsonb,
                  updated_at = $4
            WHERE effect_operation_id = $1 AND state = 'UNCERTAIN'
            RETURNING ${operationColumns}`,
          [id, outcome.status, JSON.stringify(outcome), updatedAt],
        );
        const refinedRow = refined[0];
        if (refinedRow !== undefined) {
          return { changed: true, operation: parseEffectOperationRow(refinedRow) };
        }
        const existing = await selectById(transaction, id);
        if (existing === undefined) throw effectNotFoundProblem();
        if (existing.state !== "UNCERTAIN") {
          throw effectInvalidTransitionProblem(existing.state, outcome.status);
        }
        return { changed: false, operation: existing };
      });
    },
  };
}
