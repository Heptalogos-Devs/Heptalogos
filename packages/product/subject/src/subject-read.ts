// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Subject repository reads preserve the caller's existing transaction.
 * @module subject-read
 */
import type { PersistenceService } from "@heptalogos/persistence";
import {
  executeRepositorySql,
  readRepositorySql,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
/** Owner SQL and parsing remain at the call site; no nested pool read occurs in a supplied transaction. */
export function readSubjectRows<T>(
  persistence: PersistenceService,
  statement: string,
  parameters: readonly unknown[],
  transaction?: PersistenceInternalTransaction,
): Promise<readonly T[]> {
  return transaction
    ? executeRepositorySql<T>(transaction, statement, parameters)
    : readRepositorySql<T>(persistence, statement, parameters);
}

/** Bind only an existing transaction, leaving SQL and its owner parser unchanged. */
export function createSubjectRowsReader(
  persistence: PersistenceService,
  transaction?: PersistenceInternalTransaction,
) {
  return <T>(statement: string, parameters: readonly unknown[]) =>
    readSubjectRows<T>(persistence, statement, parameters, transaction);
}
