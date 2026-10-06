// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Parses and executes the bounded Bootstrap recovery command contract while
 * keeping command authorization and failure dispositions explicit.
 * @module recovery/command
 */

import { type MaintenanceOperationId } from "@heptalogos/bootstrap-state";
import {
  createProblemError,
  parseUuidV7Id,
  type ProblemError,
  type Problem,
} from "@heptalogos/foundation-contracts";
import {
  inspectBootstrapRecovery,
  recoverAbandonedBootstrapToHost,
  type AbandonedBootstrapContinuationOptions,
  type BootstrapRecoveryInspection,
} from "./bootstrap.js";
import {
  recoverInterruptedHostMaintenance,
  type HostMaintenanceRecoveryOptions,
} from "../maintenance/recovery.js";
import type { PrivatePostgresMaintenanceResult } from "../host/managed-host.js";

/** Selects read-only inspection or one explicitly authorized recovery action. */
export type BootstrapRecoveryCommand =
  | { readonly kind: "INSPECT" }
  | {
      readonly kind: "RECOVER";
      readonly expectedOperationId?: MaintenanceOperationId;
    };

/** Describes the typed result produced by an inspection or recovery action. */
export type BootstrapRecoveryCommandResult =
  | {
      readonly kind: "INSPECTED";
      readonly inspection: BootstrapRecoveryInspection;
    }
  | {
      readonly kind: "RECOVERED";
      readonly recoveryKind: "BOOTSTRAP_CONTINUATION";
      readonly host: import("../host/managed-host.js").BootstrapManagedHostContext;
    }
  | {
      readonly kind: "RECOVERED";
      readonly recoveryKind: "MAINTENANCE";
      readonly operationId: MaintenanceOperationId;
      readonly result: PrivatePostgresMaintenanceResult;
    };

/** Supplies the fixed local context required to execute a recovery command. */
export type BootstrapRecoveryCommandContext =
  | {
      readonly kind: "BOOTSTRAP_CONTINUATION";
      readonly continuation: Omit<AbandonedBootstrapContinuationOptions, "anchorRoot">;
    }
  | {
      readonly kind: "MAINTENANCE";
      readonly recovery: Omit<
        HostMaintenanceRecoveryOptions,
        "anchorRoot" | "expectedOperationId"
      >;
    };

function commandProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "validation",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

/** Parses the closed Bootstrap recovery command vocabulary fail-closed. */
export function parseBootstrapRecoveryCommand(
  value: unknown,
): BootstrapRecoveryCommand {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    throw commandProblem(
      "bootstrap.recovery.command_invalid",
      "Bootstrap recovery command is invalid",
      "Only INSPECT and RECOVER are supported recovery commands",
    );
  }
  const kind = value.kind;
  if (kind === "INSPECT") return { kind: "INSPECT" };
  if (kind !== "RECOVER") {
    throw commandProblem(
      "bootstrap.recovery.command_invalid",
      "Bootstrap recovery command is invalid",
      "Only INSPECT and RECOVER are supported recovery commands",
    );
  }
  const expected =
    "expectedOperationId" in value ? value.expectedOperationId : undefined;
  if (expected === undefined) return { kind: "RECOVER" };
  const operationId = parseUuidV7Id("MaintenanceOperationId", expected);
  if (operationId === undefined) {
    throw commandProblem(
      "bootstrap.recovery.command_invalid",
      "Bootstrap recovery command operation identity is invalid",
      "expectedOperationId must be a valid UUIDv7 MaintenanceOperationId",
    );
  }
  return { kind: "RECOVER", expectedOperationId: operationId };
}

/** Inspects and, when authorized, executes one bounded Bootstrap recovery. */
export async function executeBootstrapRecoveryCommand(
  anchorRoot: string,
  command: BootstrapRecoveryCommand,
  context?: BootstrapRecoveryCommandContext,
): Promise<BootstrapRecoveryCommandResult> {
  const normalized = parseBootstrapRecoveryCommand(command);
  const inspection = await inspectBootstrapRecovery(anchorRoot);
  if (normalized.kind === "INSPECT") {
    return { kind: "INSPECTED", inspection };
  }

  if (
    normalized.expectedOperationId !== undefined &&
    inspection.operationId !== normalized.expectedOperationId
  ) {
    throw commandProblem(
      "bootstrap.recovery.operation_mismatch",
      "Requested recovery operation does not match current operation",
      "The bounded recovery command refuses to recover a different MaintenanceJournal implicitly",
      "conflict",
    );
  }
  if (context === undefined) {
    throw commandProblem(
      "bootstrap.recovery.command_context_required",
      "Recovery execution context is required",
      "INSPECT is read-only; RECOVER requires the fixed local recovery execution context",
    );
  }
  if (inspection.maintenanceIncomplete) {
    if (context.kind !== "MAINTENANCE") {
      throw commandProblem(
        "bootstrap.recovery.context_state_mismatch",
        "Recovery context does not match incomplete maintenance",
        "An incomplete MaintenanceJournal requires the fixed maintenance recovery context",
        "conflict",
      );
    }
    if (inspection.operationId === undefined) {
      throw commandProblem(
        "bootstrap.recovery.operation_required",
        "A committed MaintenanceJournal operation is required",
        "RECOVER cannot select an incomplete operation without a committed operation pointer",
        "conflict",
      );
    }
    const result = await recoverInterruptedHostMaintenance({
      ...context.recovery,
      anchorRoot,
      expectedOperationId: normalized.expectedOperationId,
    });
    return {
      kind: "RECOVERED",
      recoveryKind: "MAINTENANCE",
      operationId: inspection.operationId,
      result,
    };
  }

  if (context.kind !== "BOOTSTRAP_CONTINUATION") {
    throw commandProblem(
      "bootstrap.recovery.context_state_mismatch",
      "Recovery context does not match abandoned bootstrap",
      "An abandoned bootstrap without incomplete maintenance requires the fixed bootstrap continuation context",
      "conflict",
    );
  }
  if (normalized.expectedOperationId !== undefined) {
    throw commandProblem(
      "bootstrap.recovery.operation_conflict",
      "An operation identity was supplied for bootstrap continuation",
      "RECOVER bootstrap continuation cannot be combined with an expected MaintenanceJournal operation",
      "conflict",
    );
  }
  if (inspection.disposition !== "ABANDONED_OWNER_ELIGIBLE") {
    throw commandProblem(
      "bootstrap.recovery.not_eligible",
      "Bootstrap continuation is not eligible",
      `RECOVER observed ${inspection.disposition} without incomplete maintenance`,
      "conflict",
    );
  }
  const host = await recoverAbandonedBootstrapToHost({
    ...context.continuation,
    anchorRoot,
  });
  return { kind: "RECOVERED", recoveryKind: "BOOTSTRAP_CONTINUATION", host };
}
