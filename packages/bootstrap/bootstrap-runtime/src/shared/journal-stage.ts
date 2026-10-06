// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Records Bootstrap lifecycle stages in the owned journal so recovery can
 * distinguish observed progress from authority that still must be reacquired.
 * @module journal-stage
 */

import {
  BootstrapJournal,
  createBootstrapJournalCheckpoint,
  type BootstrapActivityId,
  type BootstrapStageOutcome,
} from "@heptalogos/bootstrap-state";
import { formatInstant } from "@heptalogos/foundation-contracts";
import type {
  BootId,
  InstallationId,
  InstanceId,
} from "@heptalogos/foundation-contracts";

interface BootstrapStageContext {
  readonly journal: BootstrapJournal;
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  readonly bootId: BootId;
  readonly bootstrapActivityId: BootstrapActivityId;
}

/** Appends one Bootstrap lifecycle stage before the associated side effect. */
export function recordBootstrapStage(
  context: BootstrapStageContext,
  stage: string,
  at: string,
  outcome: BootstrapStageOutcome,
  problemCode?: string,
): Promise<void> {
  return context.journal.checkpoint(
    createBootstrapJournalCheckpoint({
      bootId: context.bootId,
      bootstrapActivityId: context.bootstrapActivityId,
      installationId: context.installationId,
      instanceId: context.instanceId,
      stage,
      at,
      outcome,
      ...(problemCode ? { problemCode } : {}),
    }),
  );
}

function recordBootstrapMaintenanceCompleted(
  context: BootstrapStageContext,
): Promise<void> {
  return recordBootstrapStage(
    context,
    "bootstrap.maintenance.completed",
    formatInstant(new Date()),
    "SUCCEEDED",
  );
}

/** Records maintenance completion without masking the primary shutdown result. */
export async function recordBootstrapMaintenanceCompletedBestEffort(
  context: BootstrapStageContext,
): Promise<void> {
  try {
    await recordBootstrapMaintenanceCompleted(context);
  } catch {
    // Maintenance completion is an audit checkpoint; it must not reverse a
    // successfully released maintenance operation.
  }
}
