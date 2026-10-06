// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public Host-fenced persistence contracts and service construction; database
 * driver and transaction adapter mechanics remain behind the package root.
 * @packageDocumentation
 */

export type {
  PersistenceRuntimeOptions,
  PersistenceExecutionContextProvider,
  PersistenceExecutionMetadata,
  PersistenceMutationTransactionContext,
  PersistenceReadTransactionContext,
  PersistenceService,
  PersistenceServiceState,
  PersistenceTransactionContext,
  PersistenceTransactionMode,
} from "./contracts.js";
export { createPersistenceService } from "./persistence-service.js";
