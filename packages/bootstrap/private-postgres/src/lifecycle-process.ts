// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tracks in-flight private PostgreSQL process operations with elapsed-time
 * bounds so shutdown and recovery cannot wait indefinitely on a child process.
 * @module lifecycle-process
 */

import { performance } from "node:perf_hooks";
import { ProblemError, type Problem } from "@heptalogos/foundation-contracts";
import type {
  PrivatePostgresLifecycleOptions,
  PrivatePostgresPlacement,
  PrivatePostgresToolchain,
} from "./contracts.js";
import { runPostgresTool } from "./process-adapter.js";

/** Supplies toolchain, placement, port, and timeout inputs to process probes. */
export interface PrivatePostgresProcessOptions {
  readonly toolchain: PrivatePostgresToolchain;
  readonly placement: PrivatePostgresPlacement;
  readonly persistedPort: number;
  readonly lifecycle: PrivatePostgresLifecycleOptions;
}

/** Reports the process status proven by pg_ctl. */
export type PrivatePostgresProcessStatus = "RUNNING" | "STOPPED";

/** Constructs typed Problems for bounded PostgreSQL process failures. */
export type PrivatePostgresLifecycleProblem = (
  problemCode: string,
  title: string,
  detail: string,
  category?: Problem["category"],
) => ProblemError;

const STATUS_PROBE_TIMEOUT_MS = 5_000;

function timeoutSeconds(timeoutMs: number): string {
  return String(Math.max(1, Math.ceil(timeoutMs / 1000)));
}

/** Reads process status with a bounded pg_ctl probe. */
export async function readPrivatePostgresProcessStatus(
  options: PrivatePostgresProcessOptions,
  makeProblem: PrivatePostgresLifecycleProblem,
  timeoutMs = options.lifecycle.startupTimeoutMs,
): Promise<PrivatePostgresProcessStatus> {
  const result = await runPostgresTool(
    options.toolchain.pgCtl,
    ["status", "--pgdata", options.placement.canonicalDataDirectory],
    { timeoutMs: Math.min(STATUS_PROBE_TIMEOUT_MS, timeoutMs) },
  );
  if (result.exitCode === 0) return "RUNNING";
  if (result.exitCode === 3) return "STOPPED";
  throw makeProblem(
    "private-postgres.lifecycle.status_uncertain",
    "Private PostgreSQL process status is uncertain",
    "pg_ctl could not prove whether the validated private PostgreSQL process is running",
  );
}

/** Polls process status and pg_isready until readiness or timeout. */
export async function waitForPrivatePostgresReadiness(
  options: PrivatePostgresProcessOptions,
  makeProblem: PrivatePostgresLifecycleProblem,
): Promise<void> {
  const deadline = performance.now() + options.lifecycle.startupTimeoutMs;
  while (performance.now() < deadline) {
    const remainingMs = Math.max(1, deadline - performance.now());
    const status = await runPostgresTool(
      options.toolchain.pgCtl,
      ["status", "--pgdata", options.placement.canonicalDataDirectory],
      { timeoutMs: Math.min(STATUS_PROBE_TIMEOUT_MS, Math.ceil(remainingMs)) },
    );
    if (status.exitCode !== 0) {
      throw makeProblem(
        "private-postgres.lifecycle.process_exited",
        "Private PostgreSQL process exited before readiness",
        "pg_ctl reported that the validated private PostgreSQL process is no longer running",
        "unavailable",
      );
    }
    const readiness = await runPostgresTool(
      options.toolchain.pgIsReady,
      ["--host", "127.0.0.1", "--port", String(options.persistedPort)],
      { timeoutMs: Math.min(STATUS_PROBE_TIMEOUT_MS, Math.ceil(remainingMs)) },
    );
    if (readiness.exitCode === 0) return;
    const waitMs = Math.min(
      options.lifecycle.readinessPollIntervalMs,
      Math.max(1, Math.ceil(deadline - performance.now())),
    );
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  }
  throw makeProblem(
    "private-postgres.lifecycle.readiness_timeout",
    "Private PostgreSQL readiness timed out",
    "The validated private PostgreSQL cluster did not accept loopback connections within the startup budget",
    "unavailable",
  );
}

/** Runs pg_ctl through the process owner and rejects non-zero outcomes. */
export async function runPrivatePostgresCtlChecked(
  options: PrivatePostgresProcessOptions,
  args: readonly string[],
  timeoutMs: number,
  makeProblem: PrivatePostgresLifecycleProblem,
  problemCode: string,
  title: string,
  detail: string,
  stdio: "pipe" | "ignore" = "pipe",
): Promise<void> {
  const result = await runPostgresTool(options.toolchain.pgCtl, args, {
    timeoutMs,
    stdio,
  });
  if (result.exitCode !== 0) {
    throw makeProblem(problemCode, title, detail, "unavailable");
  }
}

/** Builds the complete process options and requires a persisted port. */
export function lifecycleProcessOptions(
  options: Pick<
    PrivatePostgresProcessOptions,
    "toolchain" | "placement" | "lifecycle"
  > & { readonly persistedPort?: number },
): PrivatePostgresProcessOptions {
  if (options.persistedPort === undefined) {
    throw new TypeError("persistedPort is required for PostgreSQL process control");
  }
  return {
    toolchain: options.toolchain,
    placement: options.placement,
    persistedPort: options.persistedPort,
    lifecycle: options.lifecycle,
  };
}

/** Converts a millisecond timeout into the pg_ctl seconds argument. */
export function processTimeoutSeconds(timeoutMs: number): string {
  return timeoutSeconds(timeoutMs);
}
