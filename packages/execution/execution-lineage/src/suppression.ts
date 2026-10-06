// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Scopes intentional lineage suppression for internal persistence plumbing so
 * nested adapter work cannot accidentally overwrite the caller's causal span.
 * @module suppression
 */

import { AsyncLocalStorage } from "node:async_hooks";

const suppression = new AsyncLocalStorage<boolean>();

/** Runs work with lineage persistence suppressed for internal adapter plumbing. */
export function runWithLineageSuppressed<T>(operation: () => T): T {
  return suppression.run(true, operation);
}

/** Reports whether the current execution is inside the suppression scope. */
export function isLineageSuppressed(): boolean {
  return suppression.getStore() === true;
}
