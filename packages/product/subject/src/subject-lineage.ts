// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Projects the actual fenced execution into retained Product adoption lineage.
 * @module subject-lineage
 */
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";
/** Retains actual creation origin for both Activity and Pursuit adoption records. */
export function subjectLineage(
  execution: PersistenceMutationTransactionContext["execution"],
) {
  return {
    schemaVersion: 1,
    sourceActivityId: execution.activityId,
    sourceInstanceId: execution.instanceId,
    sourceContinuityEpochId: execution.continuityEpochId,
  };
}
