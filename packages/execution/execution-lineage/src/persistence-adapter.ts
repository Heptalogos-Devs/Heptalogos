// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Integrates lineage persistence with the Host-fenced transaction seam while
 * preserving atomicity between the operation and its causal record.
 * @module persistence-adapter
 */

import type {
  PersistenceExecutionContextProvider,
  PersistenceExecutionMetadata,
} from "@heptalogos/persistence";
import type { ExecutionContextRuntime } from "./contracts.js";

/** Creates the Host-fenced persistence execution-context provider. */
export function createPersistenceExecutionContextProvider(
  runtime: ExecutionContextRuntime,
): PersistenceExecutionContextProvider {
  return {
    current(): PersistenceExecutionMetadata | undefined {
      const context = runtime.current();
      if (context === undefined) return undefined;
      return Object.freeze({
        activityId: context.activityId,
        installationId: context.origin.installationId,
        instanceId: context.origin.instanceId,
        bootId: context.origin.bootId,
        continuityEpochId: context.origin.continuityEpochId,
        hostOwnershipToken: context.origin.hostOwnershipToken,
      });
    },
  };
}
