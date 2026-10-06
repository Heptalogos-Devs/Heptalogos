// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements bounded initialize/start/stop lifecycle operations and translates
 * process outcomes into the private PostgreSQL contract's dispositions.
 * @module lifecycle-operations
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";
import type {
  PrivatePostgresExpectedIdentity,
  PrivatePostgresLifecycleOptions,
  PrivatePostgresPlacement,
  PrivatePostgresToolchain,
} from "./contracts.js";
import { validateExistingCluster } from "./controller.js";
import {
  lifecycleProcessOptions,
  readPrivatePostgresProcessStatus,
  runPrivatePostgresCtlChecked,
  waitForPrivatePostgresReadiness,
} from "./lifecycle-process.js";

/** Supplies validated cluster and process-control seams for lifecycle operations. */
export interface PrivatePostgresLifecycleOperationsOptions {
  readonly toolchain: PrivatePostgresToolchain;
  readonly placement: PrivatePostgresPlacement;
  readonly expectedIdentity: PrivatePostgresExpectedIdentity;
  readonly logFilePath: string;
  readonly lifecycle: PrivatePostgresLifecycleOptions;
  readonly assertControlAuthority: () => void;
}

/** Reports whether an existing private PostgreSQL process is running. */
export type ExistingPrivatePostgresProcessStatus = "RUNNING" | "STOPPED";

function operationProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "integrity",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

/** Validates the cluster and observes its process/readiness state. */
export async function observeValidatedCluster(
  options: PrivatePostgresLifecycleOperationsOptions,
): Promise<ExistingPrivatePostgresProcessStatus> {
  const processOptions = lifecycleProcessOptions({
    ...options,
    persistedPort: options.expectedIdentity.persistedPort,
  });
  options.assertControlAuthority();
  await validateExistingCluster({
    toolchain: options.toolchain,
    placement: options.placement,
    expectedIdentity: options.expectedIdentity,
    timeoutMs: options.lifecycle.startupTimeoutMs,
  });
  const status = await readPrivatePostgresProcessStatus(
    processOptions,
    operationProblem,
  );
  if (status === "STOPPED") return status;
  await waitForPrivatePostgresReadiness(processOptions, operationProblem);
  await validateExistingCluster({
    toolchain: options.toolchain,
    placement: options.placement,
    expectedIdentity: options.expectedIdentity,
    timeoutMs: options.lifecycle.startupTimeoutMs,
  });
  return "RUNNING";
}

/** Stops a validated cluster and proves the process reached STOPPED. */
export async function stopValidatedCluster(
  options: PrivatePostgresLifecycleOperationsOptions,
): Promise<void> {
  const processOptions = lifecycleProcessOptions({
    ...options,
    persistedPort: options.expectedIdentity.persistedPort,
  });
  options.assertControlAuthority();
  const before = await readPrivatePostgresProcessStatus(
    processOptions,
    operationProblem,
    options.lifecycle.shutdownTimeoutMs,
  );
  if (before === "STOPPED") return;

  options.assertControlAuthority();
  try {
    await runPrivatePostgresCtlChecked(
      processOptions,
      [
        "stop",
        "--pgdata",
        options.placement.canonicalDataDirectory,
        "--mode=fast",
        "--wait",
        "--timeout",
        String(Math.max(1, Math.ceil(options.lifecycle.shutdownTimeoutMs / 1000))),
      ],
      options.lifecycle.shutdownTimeoutMs,
      operationProblem,
      "private-postgres.lifecycle.stop_failed",
      "Private PostgreSQL stop failed",
      "pg_ctl could not stop the private PostgreSQL cluster within the shutdown budget",
    );
  } catch {
    // The status proof below is authoritative even when pg_ctl reports a failure.
  }

  let after: ExistingPrivatePostgresProcessStatus;
  try {
    after = await readPrivatePostgresProcessStatus(
      processOptions,
      operationProblem,
      options.lifecycle.shutdownTimeoutMs,
    );
  } catch {
    throw operationProblem(
      "private-postgres.lifecycle.stop_uncertain",
      "Private PostgreSQL stop is uncertain",
      "The private PostgreSQL process could not be proven stopped through the bounded maintenance path",
    );
  }
  if (after !== "STOPPED") {
    throw operationProblem(
      "private-postgres.lifecycle.stop_uncertain",
      "Private PostgreSQL stop is uncertain",
      "The private PostgreSQL process remained running after the bounded stop command",
    );
  }
  options.assertControlAuthority();
}

/** Starts a validated cluster and proves loopback readiness. */
export async function startValidatedCluster(
  options: PrivatePostgresLifecycleOperationsOptions,
): Promise<void> {
  const processOptions = lifecycleProcessOptions({
    ...options,
    persistedPort: options.expectedIdentity.persistedPort,
  });
  options.assertControlAuthority();
  await runPrivatePostgresCtlChecked(
    processOptions,
    [
      "start",
      "--pgdata",
      options.placement.canonicalDataDirectory,
      "--log",
      options.logFilePath,
      "--wait",
      "--timeout",
      String(Math.max(1, Math.ceil(options.lifecycle.startupTimeoutMs / 1000))),
    ],
    options.lifecycle.startupTimeoutMs,
    operationProblem,
    "private-postgres.lifecycle.start_failed",
    "Private PostgreSQL start failed",
    "pg_ctl could not start the validated private PostgreSQL cluster",
    "ignore",
  );
  await waitForPrivatePostgresReadiness(processOptions, operationProblem);
  await validateExistingCluster({
    toolchain: options.toolchain,
    placement: options.placement,
    expectedIdentity: options.expectedIdentity,
    timeoutMs: options.lifecycle.startupTimeoutMs,
  });
  options.assertControlAuthority();
}
