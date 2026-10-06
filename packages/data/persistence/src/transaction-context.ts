// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builds the typed transaction context passed through persistence and Foundation
 * repositories so execution lineage and Host ownership remain coupled.
 * @module transaction-context
 */

import type { Transaction } from "kysely";
import type {
  PersistenceExecutionMetadata,
  PersistenceMutationTransactionContext,
  PersistenceReadTransactionContext,
  PersistenceTransactionContext,
} from "./contracts.js";
import { persistenceTransactionContextInvalidProblem } from "./problems.js";

type InternalDatabase = Record<string, Record<string, unknown>>;
/** Package-private transaction carrier type issued through WeakMap identity. */
export type PersistenceInternalTransaction = Transaction<InternalDatabase>;

const transactions = new WeakMap<
  PersistenceTransactionContext,
  PersistenceInternalTransaction
>();

/** Issues a read context bound to a specific internal transaction. */
export function issueTransactionContext(
  mode: "READ",
  transaction: PersistenceInternalTransaction,
  execution?: PersistenceExecutionMetadata,
): PersistenceReadTransactionContext;
/** Issues a mutation context bound to a specific internal transaction. */
export function issueTransactionContext(
  mode: "MUTATION",
  transaction: PersistenceInternalTransaction,
  execution: PersistenceExecutionMetadata,
): PersistenceMutationTransactionContext;
/** Implements the shared context issuance path for both transaction modes. */
export function issueTransactionContext(
  mode: "READ" | "MUTATION",
  transaction: PersistenceInternalTransaction,
  execution?: PersistenceExecutionMetadata,
): PersistenceTransactionContext {
  const context = Object.freeze({
    mode,
    ...(execution ? { execution } : {}),
  }) as PersistenceTransactionContext;
  transactions.set(context, transaction);
  return context;
}

/** Resolves a context only when it was issued by this persistence instance. */
export function resolveTransactionContext(
  context: unknown,
): PersistenceInternalTransaction {
  if (typeof context !== "object" || context === null) {
    throw persistenceTransactionContextInvalidProblem();
  }
  const transaction = transactions.get(context as PersistenceTransactionContext);
  if (transaction === undefined) {
    throw persistenceTransactionContextInvalidProblem();
  }
  return transaction;
}

/** Releases the identity mapping after transaction completion. */
export function releaseTransactionContext(
  context: PersistenceTransactionContext,
): void {
  transactions.delete(context);
}
