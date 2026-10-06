// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runs the approved PostgreSQL subprocess commands through Execa and enforces
 * bounded, argument-safe process execution behind the adapter boundary.
 * @module process-adapter
 */

import { execa } from "execa";
import { isAbsolute } from "node:path";
import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";
import { hasNodeErrorCode } from "./error-code.js";

/** Normalized result returned by an approved PostgreSQL subprocess. */
export interface PostgresProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Bounds process execution and controls its sanitized environment. */
export interface PostgresProcessOptions {
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly stdio?: "pipe" | "ignore";
}

const SANITIZED_POSTGRES_ENV_KEYS = [
  "PGDATA",
  "PGPASSWORD",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGDATABASE",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGPASSFILE",
  "PGOPTIONS",
] as const;

function processProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "unavailable",
  retryClass: Problem["retryClass"] = "backoff",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass,
    title,
    detail,
  });
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (("timedOut" in error && error.timedOut === true) ||
      hasNodeErrorCode(error, "ETIMEDOUT"))
  );
}

function cleanChildEnvironment(
  overrides: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const environment = { ...process.env } as Record<string, string | undefined>;
  for (const key of SANITIZED_POSTGRES_ENV_KEYS) delete environment[key];
  environment.LC_ALL = "C";
  environment.LANG = "C";
  environment.PG_COLOR = "never";
  Object.assign(environment, overrides);
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/** Runs one PostgreSQL tool with shell-free arguments and bounded failure mapping. */
export async function runPostgresTool(
  executable: string,
  args: readonly string[],
  options: PostgresProcessOptions,
): Promise<PostgresProcessResult> {
  if (!isAbsolute(executable)) {
    throw processProblem(
      "private-postgres.process.invalid_executable",
      "PostgreSQL executable path is not absolute",
      "Private PostgreSQL tools must be invoked through absolute executable paths",
      "validation",
      "manual",
    );
  }

  try {
    const result = await execa(executable, [...args], {
      cwd: options.cwd,
      env: cleanChildEnvironment(options.env),
      shell: false,
      stdio: options.stdio,
      timeout: options.timeoutMs,
      reject: false,
    });
    return {
      exitCode: result.exitCode ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    if (isTimeoutError(error)) {
      throw processProblem(
        "private-postgres.process.timed_out",
        "PostgreSQL tool invocation timed out",
        "The private PostgreSQL tool did not finish within its bounded execution budget",
        "unavailable",
        "backoff",
      );
    }
    throw processProblem(
      "private-postgres.process.launch_failed",
      "PostgreSQL tool could not be launched",
      "The private PostgreSQL tool process could not be started",
      "unavailable",
      "backoff",
    );
  }
}
