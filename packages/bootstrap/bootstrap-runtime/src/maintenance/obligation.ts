// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inspects the durable maintenance obligation and classifies whether cleanup
 * or recovery must precede a new Bootstrap operation.
 * @module obligation
 */

import {
  MaintenanceJournalStore,
  type BootstrapStateLoadResult,
  type MaintenanceJournalLoadResult,
  type MaintenanceOperationId,
} from "@heptalogos/bootstrap-state";
import {
  createProblem,
  parseUuidV7Id,
  type Problem,
} from "@heptalogos/foundation-contracts";
import { problemCodeOf } from "../shared/problem-code.js";

const MAINTENANCE_OPERATION_REF_PREFIX = "maintenance-journal/v1/";

/** Reports whether durable maintenance is incomplete and needs recovery. */
export interface MaintenanceObligationInspection {
  readonly operationId?: MaintenanceOperationId;
  readonly maintenance?: MaintenanceJournalLoadResult;
  readonly incomplete: boolean;
  readonly problem?: Problem;
}

function problem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "integrity",
): Problem {
  return createProblem({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

function operationIdFromReference(
  reference: string | undefined,
): MaintenanceOperationId | undefined {
  if (
    reference === undefined ||
    !reference.startsWith(MAINTENANCE_OPERATION_REF_PREFIX)
  ) {
    return undefined;
  }
  return parseUuidV7Id(
    "MaintenanceOperationId",
    reference.slice(MAINTENANCE_OPERATION_REF_PREFIX.length),
  );
}

function maintenanceIsIncomplete(value: MaintenanceJournalLoadResult): boolean {
  if (value.status !== "CURRENT") return false;
  return (
    value.value.state.phase === "PREPARED" ||
    value.value.state.phase === "EXECUTING" ||
    value.value.state.phase === "RECOVERY_REQUIRED"
  );
}

/** Inspects the current maintenance pointer and journal under BootstrapState. */
export async function inspectMaintenanceObligation(
  instanceRoot: string,
  state: BootstrapStateLoadResult,
): Promise<MaintenanceObligationInspection> {
  if (state.status === "RECOVERED_PREVIOUS") {
    return {
      incomplete: false,
      problem: problem(
        "bootstrap.state.current_authority_required",
        "Current BootstrapState authority is required",
        "A recovered previous BootstrapState revision is inspection evidence only and cannot authorize maintenance recovery",
      ),
    };
  }
  if (state.status === "CORRUPT") {
    return { incomplete: false, problem: state.problem };
  }
  if (state.status === "EMPTY") return { incomplete: false };

  const operationId = operationIdFromReference(
    state.value.state.lastCommittedOperationRef,
  );
  if (operationId === undefined) {
    if (state.value.state.lastCommittedOperationRef === undefined) {
      return { incomplete: false };
    }
    return {
      incomplete: false,
      problem: problem(
        "bootstrap.recovery.invalid_operation_reference",
        "Bootstrap maintenance operation reference is invalid",
        "BootstrapState lastCommittedOperationRef is not a supported MaintenanceJournal V1 reference",
        "validation",
      ),
    };
  }

  let maintenance: MaintenanceJournalLoadResult;
  try {
    maintenance = await new MaintenanceJournalStore(instanceRoot).load(operationId);
  } catch (error) {
    return {
      operationId,
      incomplete: false,
      problem: problem(
        "bootstrap.recovery.maintenance_load_failed",
        "MaintenanceJournal could not be inspected",
        problemCodeOf(error) ??
          "The MaintenanceJournal could not be loaded without mutation",
        "unavailable",
      ),
    };
  }

  if (maintenance.status === "EMPTY") {
    return {
      operationId,
      maintenance,
      incomplete: false,
      problem: problem(
        "bootstrap.recovery.maintenance_missing",
        "Committed MaintenanceJournal is missing",
        "BootstrapState points to a MaintenanceJournal operation that has no readable revision",
      ),
    };
  }
  if (maintenance.status === "CORRUPT") {
    return {
      operationId,
      maintenance,
      incomplete: false,
      problem: maintenance.problem,
    };
  }
  if (maintenance.status === "RECOVERED_PREVIOUS") {
    return {
      operationId,
      maintenance,
      incomplete: false,
      problem: maintenance.problem,
    };
  }

  return {
    operationId,
    maintenance,
    incomplete: maintenanceIsIncomplete(maintenance),
  };
}
