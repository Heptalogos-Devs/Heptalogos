// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates the process identity evidence used by Bootstrap recovery so a
 * stale or reused process identifier cannot authorize a recovery action.
 * @module bootstrap/process-identity
 */

import pidusage from "pidusage";
import { nodeErrorCode } from "../shared/error-code.js";

const PROCESS_START_IDENTITY_TOLERANCE_MS = 5_000;

/** Captures the process start evidence used to reject PID reuse during recovery. */
export interface BootstrapProcessIdentity {
  readonly pid: number;
  readonly startedAtMs: number;
}

/** Reports whether the current process identity can be used for recovery. */
export type BootstrapProcessIdentityStatus =
  "SAME_PROCESS" | "PROCESS_DEAD" | "UNKNOWN";

function isDefinitelyMissingProcess(error: unknown): boolean {
  const code = nodeErrorCode(error);
  return code === "ESRCH" || code === "ENOENT";
}

/** Reads the current process identity from the platform process table. */
export function currentBootstrapProcessIdentity(): BootstrapProcessIdentity {
  return {
    pid: process.pid,
    startedAtMs: Date.now() - process.uptime() * 1000,
  };
}

/** Inspects whether a recorded process identity still names the same process. */
export async function inspectBootstrapProcessIdentity(
  expected: BootstrapProcessIdentity,
): Promise<BootstrapProcessIdentityStatus> {
  try {
    process.kill(expected.pid, 0);
  } catch (error) {
    return isDefinitelyMissingProcess(error) ? "PROCESS_DEAD" : "UNKNOWN";
  }

  try {
    const stats = await pidusage(expected.pid);
    if (
      stats.pid !== expected.pid ||
      !Number.isFinite(stats.timestamp) ||
      !Number.isFinite(stats.elapsed)
    ) {
      return "UNKNOWN";
    }
    const startedAtMs = stats.timestamp - stats.elapsed;
    return Math.abs(startedAtMs - expected.startedAtMs) <=
      PROCESS_START_IDENTITY_TOLERANCE_MS
      ? "SAME_PROCESS"
      : "UNKNOWN";
  } catch {
    return "UNKNOWN";
  }
}
