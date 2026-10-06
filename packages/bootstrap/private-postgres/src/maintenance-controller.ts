// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Exposes the bounded maintenance controller used during authorized windows;
 * it does not acquire Bootstrap authority or create a second process owner.
 * @module maintenance-controller
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";
import type {
  PrivatePostgresControlGuard,
  PrivatePostgresExpectedIdentity,
  PrivatePostgresLifecycleOptions,
  PrivatePostgresPlacement,
  PrivatePostgresToolchain,
} from "./contracts.js";
import {
  observeValidatedCluster,
  startValidatedCluster,
  stopValidatedCluster,
  type PrivatePostgresLifecycleOperationsOptions,
} from "./lifecycle-operations.js";

/** Controls private PostgreSQL only during an authorized maintenance window. */
export interface PrivatePostgresMaintenanceController {
  readonly state: "READY" | "STOPPED" | "STARTING" | "STOPPING" | "UNCERTAIN";
  /** Stops the managed cluster and proves its terminal status. */
  stop(): Promise<void>;
  /** Starts the managed cluster and proves readiness. */
  start(): Promise<void>;
}

/** Supplies identity, profile, and authority inputs for maintenance control. */
export interface OpenPrivatePostgresMaintenanceControllerOptions {
  readonly toolchain: PrivatePostgresToolchain;
  readonly placement: PrivatePostgresPlacement;
  readonly expectedIdentity: PrivatePostgresExpectedIdentity;
  readonly logFilePath: string;
  readonly lifecycle: PrivatePostgresLifecycleOptions;
  readonly assertControlAuthority: PrivatePostgresControlGuard;
}

function maintenanceProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "conflict",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

function operationInProgress(state: string): ProblemError {
  return maintenanceProblem(
    "private-postgres.maintenance.operation_in_progress",
    "Private PostgreSQL maintenance operation is already in progress",
    `The maintenance controller cannot accept a new operation while it is ${state}`,
  );
}

function uncertainState(): ProblemError {
  return maintenanceProblem(
    "private-postgres.maintenance.state_uncertain",
    "Private PostgreSQL maintenance state is uncertain",
    "The cluster process state cannot be safely controlled until a bounded recovery proof exists",
    "integrity",
  );
}

function alreadyReady(): ProblemError {
  return maintenanceProblem(
    "private-postgres.maintenance.already_ready",
    "Private PostgreSQL cluster is already ready",
    "The maintenance controller start operation requires a proven STOPPED cluster",
  );
}

/** Opens a bounded private PostgreSQL maintenance controller. */
export async function openPrivatePostgresMaintenanceController(
  options: OpenPrivatePostgresMaintenanceControllerOptions,
): Promise<PrivatePostgresMaintenanceController> {
  const observed = await observeValidatedCluster(options);
  let state: PrivatePostgresMaintenanceController["state"] =
    observed === "RUNNING" ? "READY" : "STOPPED";

  const operations: PrivatePostgresLifecycleOperationsOptions = options;
  return Object.freeze({
    get state() {
      return state;
    },
    async stop(): Promise<void> {
      if (state === "STOPPED") return;
      if (state === "UNCERTAIN") throw uncertainState();
      if (state !== "READY") throw operationInProgress(state);
      options.assertControlAuthority();
      state = "STOPPING";
      try {
        await stopValidatedCluster(operations);
        options.assertControlAuthority();
        state = "STOPPED";
      } catch (error) {
        state = "UNCERTAIN";
        throw error;
      }
    },
    async start(): Promise<void> {
      if (state === "READY") throw alreadyReady();
      if (state === "UNCERTAIN") throw uncertainState();
      if (state !== "STOPPED") throw operationInProgress(state);
      options.assertControlAuthority();
      state = "STARTING";
      try {
        await startValidatedCluster(operations);
        options.assertControlAuthority();
        state = "READY";
      } catch (error) {
        state = "UNCERTAIN";
        throw error;
      }
    },
  });
}
