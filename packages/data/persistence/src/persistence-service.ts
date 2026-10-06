// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements the Host-fenced persistence service and bounded pool lifecycle,
 * rejecting mutations after ownership loss through the canonical fence.
 * @module persistence-service
 */

import {
  createProblemError,
  parseBootId,
  parseHostOwnershipToken,
  parseInstanceId,
  ProblemError,
} from "@heptalogos/foundation-contracts";
import {
  HOST_OWNERSHIP_FENCE_LOCK_FUNCTION,
  type HostPersistenceAuthority,
} from "@heptalogos/host-ownership";
import {
  type PersistenceRuntimeOptions,
  type PersistenceExecutionContextProvider,
  type PersistenceExecutionMetadata,
  type PersistenceMutationTransactionContext,
  type PersistenceReadTransactionContext,
  type PersistenceService,
  type PersistenceServiceState,
  type PersistenceTransactionContext,
  type PersistenceTransactionMode,
} from "./contracts.js";
import { createKyselyAdapter } from "./kysely-adapter.js";
import { executeRepositorySql } from "./repository.js";
import { createPersistencePool } from "./pg-pool.js";
import {
  persistenceServiceCloseFailedProblem,
  persistenceServiceClosedProblem,
  persistenceServiceFencedProblem,
  persistenceExecutionContextRequiredProblem,
  persistenceExecutionContextStaleOriginProblem,
  persistenceTransactionCommitUncertainProblem,
  persistenceTransactionFailedProblem,
} from "./problems.js";
import {
  issueTransactionContext,
  releaseTransactionContext,
  type PersistenceInternalTransaction,
} from "./transaction-context.js";

interface PersistenceDatabaseLike {
  transaction(): {
    execute<T>(
      callback: (transaction: PersistenceInternalTransaction) => Promise<T>,
    ): Promise<T>;
  };
  destroy(): Promise<void>;
}

interface PersistenceServiceTestHooks {
  readonly onFenceVerified?: () => void;
}

interface HostFenceRow {
  readonly singleton: unknown;
  readonly instance_id: unknown;
  readonly ownership_revision: unknown;
  readonly host_ownership_token: unknown;
  readonly boot_id: unknown;
}

const HOST_FENCE_QUERY = `
SELECT singleton,
       instance_id,
       ownership_revision,
       host_ownership_token,
       boot_id
FROM "heptalogos"."${HOST_OWNERSHIP_FENCE_LOCK_FUNCTION}"()
`;

function isValidRevision(value: unknown): boolean {
  if (typeof value === "string") return /^(0|[1-9][0-9]*)$/u.test(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function incompatibleFenceProblem(): ProblemError {
  return createProblemError({
    problemCode: "persistence.host_fence.incompatible",
    category: "integrity",
    retryClass: "manual",
    title: "Host ownership fence is incompatible",
    detail:
      "The canonical HostOwnershipFence row did not match the required singleton shape",
  });
}

function staleOwnerProblem(): ProblemError {
  return createProblemError({
    problemCode: "persistence.host_fence.stale_owner",
    category: "conflict",
    retryClass: "after-change",
    title: "Host ownership fence belongs to another owner",
    detail:
      "The database fence does not contain the current Host InstanceId, BootId, and token",
  });
}

function verifyHostFence(
  rows: readonly HostFenceRow[],
  authority: HostPersistenceAuthority,
  hooks: PersistenceServiceTestHooks,
): void {
  if (rows.length !== 1) throw incompatibleFenceProblem();
  const row = rows[0];
  if (
    row.singleton !== true ||
    typeof row.instance_id !== "string" ||
    parseInstanceId(row.instance_id) === undefined ||
    !isValidRevision(row.ownership_revision)
  ) {
    throw incompatibleFenceProblem();
  }
  if (row.host_ownership_token === null || row.boot_id === null) {
    throw staleOwnerProblem();
  }
  if (
    typeof row.host_ownership_token !== "string" ||
    parseHostOwnershipToken(row.host_ownership_token) === undefined ||
    typeof row.boot_id !== "string" ||
    parseBootId(row.boot_id) === undefined
  ) {
    throw incompatibleFenceProblem();
  }
  if (
    row.instance_id !== authority.instanceId ||
    row.host_ownership_token !== authority.token ||
    row.boot_id !== authority.bootId
  ) {
    throw staleOwnerProblem();
  }
  hooks.onFenceVerified?.();
}

function reportBackgroundError(
  options: PersistenceRuntimeOptions,
  error: unknown,
): void {
  try {
    options.onBackgroundError(error);
  } catch {
    // Background reporting must not escape the lifecycle callback.
  }
}

function serviceErrorForState(state: PersistenceServiceState): ProblemError {
  return state === "FENCED"
    ? persistenceServiceFencedProblem()
    : persistenceServiceClosedProblem();
}

function copyExecutionMetadata(
  metadata: PersistenceExecutionMetadata,
): PersistenceExecutionMetadata {
  return Object.freeze({ ...metadata });
}

function executionMatchesAuthority(
  metadata: PersistenceExecutionMetadata,
  authority: HostPersistenceAuthority,
): boolean {
  return (
    metadata.installationId === authority.installationId &&
    metadata.instanceId === authority.instanceId &&
    metadata.bootId === authority.bootId &&
    metadata.continuityEpochId === authority.continuityEpochId &&
    metadata.hostOwnershipToken === authority.token
  );
}

function admitExecutionMetadata(
  mode: PersistenceTransactionMode,
  provider: PersistenceExecutionContextProvider,
  authority: HostPersistenceAuthority,
): PersistenceExecutionMetadata | undefined {
  const current = provider.current();
  if (current === undefined) {
    if (mode === "MUTATION") {
      throw persistenceExecutionContextRequiredProblem();
    }
    return undefined;
  }

  const snapshot = copyExecutionMetadata(current);
  if (!executionMatchesAuthority(snapshot, authority)) {
    throw persistenceExecutionContextStaleOriginProblem();
  }
  return snapshot;
}

function createPersistenceServiceFromDatabase(
  authority: HostPersistenceAuthority,
  options: PersistenceRuntimeOptions,
  executionContextProvider: PersistenceExecutionContextProvider,
  database: PersistenceDatabaseLike,
  hooks: PersistenceServiceTestHooks = {},
): PersistenceService {
  let state: PersistenceServiceState = "OPEN";
  let drainPromise: Promise<void> | undefined;
  let drainRequested = false;
  let drainStarted = false;
  let activeTransactions = 0;
  let resolveDrain: (() => void) | undefined;
  let rejectDrain: ((error: unknown) => void) | undefined;

  const maybeStartDrain = (): void => {
    if (!drainRequested || drainStarted || activeTransactions !== 0) return;
    drainStarted = true;
    void database.destroy().then(
      () => {
        state = "CLOSED";
        resolveDrain?.();
      },
      () => {
        state = "CLOSED";
        rejectDrain?.(persistenceServiceCloseFailedProblem());
      },
    );
  };

  const drain = (): Promise<void> => {
    if (drainPromise !== undefined) return drainPromise;
    drainRequested = true;
    drainPromise = new Promise<void>((resolve, reject) => {
      resolveDrain = resolve;
      rejectDrain = reject;
    });
    maybeStartDrain();
    return drainPromise;
  };

  const fence = (): void => {
    if (state === "OPEN") state = "FENCED";
    const pending = drain();
    void pending.catch((error) => reportBackgroundError(options, error));
  };

  const onAbort = (): void => fence();
  authority.signal.addEventListener("abort", onAbort, { once: true });
  if (authority.signal.aborted) fence();

  const assertAuthorityActive = (): void => {
    try {
      authority.assertActive();
    } catch {
      fence();
      throw persistenceServiceFencedProblem();
    }
  };

  const assertOpen = (): void => {
    if (state !== "OPEN") throw serviceErrorForState(state);
    assertAuthorityActive();
  };

  const execute = async <T>(
    mode: PersistenceTransactionMode,
    operation: (context: PersistenceTransactionContext) => Promise<T>,
  ): Promise<T> => {
    assertOpen();
    const execution = admitExecutionMetadata(mode, executionContextProvider, authority);
    let operationCompleted = false;
    activeTransactions += 1;
    try {
      return await database.transaction().execute(async (transaction) => {
        if (mode === "READ") {
          await executeRepositorySql(transaction, "SET TRANSACTION READ ONLY");
        } else {
          assertAuthorityActive();
          const rows = await executeRepositorySql<HostFenceRow>(
            transaction,
            HOST_FENCE_QUERY,
          );
          verifyHostFence(rows, authority, hooks);
          assertAuthorityActive();
        }
        const context =
          mode === "READ"
            ? issueTransactionContext("READ", transaction, execution)
            : issueTransactionContext("MUTATION", transaction, execution!);
        try {
          const result = await operation(context);
          operationCompleted = true;
          return result;
        } finally {
          releaseTransactionContext(context);
        }
      });
    } catch (error) {
      if (operationCompleted) {
        throw persistenceTransactionCommitUncertainProblem();
      }
      if (error instanceof ProblemError) throw error;
      throw persistenceTransactionFailedProblem();
    } finally {
      activeTransactions -= 1;
      maybeStartDrain();
    }
  };

  return {
    get state() {
      return state;
    },
    read<T>(operation: (context: PersistenceReadTransactionContext) => Promise<T>) {
      return execute(
        "READ",
        operation as (context: PersistenceTransactionContext) => Promise<T>,
      );
    },
    mutate<T>(
      operation: (context: PersistenceMutationTransactionContext) => Promise<T>,
    ) {
      return execute(
        "MUTATION",
        operation as (context: PersistenceTransactionContext) => Promise<T>,
      );
    },
    close() {
      if (state === "CLOSED") return drainPromise ?? Promise.resolve();
      state = "CLOSING";
      return drain();
    },
  };
}

/** Creates the production persistence service over a Host-authorized pool. */
export function createPersistenceService(
  authority: HostPersistenceAuthority,
  options: PersistenceRuntimeOptions,
  executionContextProvider: PersistenceExecutionContextProvider,
): PersistenceService {
  const pool = createPersistencePool(authority, options);
  const database = createKyselyAdapter(pool);
  return createPersistenceServiceFromDatabase(
    authority,
    options,
    executionContextProvider,
    database,
  );
}

/** Creates a persistence service over a test database seam without changing Authority. */
export function createPersistenceServiceForTests(
  authority: HostPersistenceAuthority,
  options: PersistenceRuntimeOptions,
  executionContextProvider: PersistenceExecutionContextProvider,
  database: PersistenceDatabaseLike,
  hooks: PersistenceServiceTestHooks = {},
): PersistenceService {
  return createPersistenceServiceFromDatabase(
    authority,
    options,
    executionContextProvider,
    database,
    hooks,
  );
}
