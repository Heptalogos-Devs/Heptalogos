// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runs the installed DBOS CLI with shell-free Node execution, bounded output,
 * sanitized PostgreSQL environment inheritance, and safe diagnostics.
 * @module process
 */

import { execa } from "execa";
import { isAbsolute } from "node:path";
import type {
  DurableExecutionProcessOptions,
  DurableExecutionProcessResult,
} from "../contracts.js";
import { durableExecutionProblem } from "../problems.js";

const DBOS_PROCESS_MAX_OUTPUT_BYTES = 128 * 1024;
const DBOS_DIAGNOSTIC_MAX_CHARS = 4_096;
const INHERITED_POSTGRES_ENV_KEYS = [
  "PGPASSWORD",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGDATABASE",
  "PGOPTIONS",
  "PGSERVICE",
  "PGSERVICEFILE",
  "PGPASSFILE",
  "PGDATA",
] as const;

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function isTimeoutError(error: unknown): boolean {
  return (
    (typeof error === "object" &&
      error !== null &&
      "timedOut" in error &&
      error.timedOut === true) ||
    isNodeErrorWithCode(error, "ETIMEDOUT")
  );
}

function isOutputLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /maxBuffer|buffer.*limit|output.*limit/iu.test(error.message)
  );
}

function childEnvironment(
  overrides: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const environment = { ...process.env } as Record<string, string | undefined>;
  for (const key of INHERITED_POSTGRES_ENV_KEYS) delete environment[key];
  environment.LC_ALL = "C";
  environment.LANG = "C";
  Object.assign(environment, overrides);
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

/** Removes terminal control bytes, redacts credential-shaped values, and bounds diagnostics. */
export function sanitizeDbosDiagnostic(value: string): string {
  let withoutControls = "";
  let inEscapeSequence = false;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (inEscapeSequence) {
      if (codePoint >= 0x40 && codePoint <= 0x7e) inEscapeSequence = false;
      continue;
    }
    if (codePoint === 0x1b) {
      inEscapeSequence = true;
      continue;
    }
    if (
      codePoint === 0x7f ||
      (codePoint < 0x20 &&
        codePoint !== 0x09 &&
        codePoint !== 0x0a &&
        codePoint !== 0x0d)
    ) {
      continue;
    }
    withoutControls += character;
  }
  const redacted = withoutControls
    .replace(/(PGPASSWORD|password)(\s*[=:]\s*)[^\s,;]+/giu, "$1$2<redacted>")
    .replace(/(postgres(?:ql)?:\/\/[^\s/:@]+:)[^\s@]+(@)/giu, "$1<redacted>$2");
  return redacted.length > DBOS_DIAGNOSTIC_MAX_CHARS
    ? `${redacted.slice(0, DBOS_DIAGNOSTIC_MAX_CHARS)}…`
    : redacted;
}

/** Formats bounded process output for inclusion in a Foundation Problem. */
export function dbosProcessDiagnostic(result: DurableExecutionProcessResult): string {
  return sanitizeDbosDiagnostic(
    [result.stdout, result.stderr].filter((value) => value.length > 0).join("\n"),
  );
}

function assertOptions(options: DurableExecutionProcessOptions): void {
  if (
    options.args.some((argument) => typeof argument !== "string") ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs <= 0
  ) {
    throw durableExecutionProblem(
      "durable.execution.process.invalid_options",
      "DBOS CLI path, arguments, and timeout must be bounded explicit values",
    );
  }
}

function assertExecutable(options: DurableExecutionProcessOptions): void {
  if (!isAbsolute(options.cliPath)) {
    throw durableExecutionProblem(
      "durable.execution.process.invalid_executable",
      "The DBOS CLI path must be an absolute package-contained file path",
    );
  }
}

/** Runs the installed DBOS CLI through the current Node executable. */
export async function runDbosCli(
  options: DurableExecutionProcessOptions,
): Promise<DurableExecutionProcessResult> {
  assertOptions(options);
  assertExecutable(options);
  try {
    const result = await execa(process.execPath, [options.cliPath, ...options.args], {
      cwd: options.cwd,
      env: childEnvironment(options.env),
      extendEnv: false,
      shell: false,
      timeout: options.timeoutMs,
      maxBuffer: DBOS_PROCESS_MAX_OUTPUT_BYTES,
      reject: false,
    });
    if (result.timedOut === true) {
      throw durableExecutionProblem(
        "durable.execution.process.timed_out",
        "The DBOS CLI did not finish within its bounded execution budget",
      );
    }
    if (result.isMaxBuffer === true) {
      throw durableExecutionProblem(
        "durable.execution.process.output_limit",
        "The DBOS CLI exceeded its bounded stdout/stderr limit",
      );
    }
    return {
      exitCode: result.exitCode ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "ProblemError") throw error;
    if (isTimeoutError(error)) {
      throw durableExecutionProblem(
        "durable.execution.process.timed_out",
        "The DBOS CLI did not finish within its bounded execution budget",
        error,
      );
    }
    if (isOutputLimitError(error)) {
      throw durableExecutionProblem(
        "durable.execution.process.output_limit",
        "The DBOS CLI exceeded its bounded stdout/stderr limit",
        error,
      );
    }
    throw durableExecutionProblem(
      "durable.execution.process.launch_failed",
      "The DBOS CLI process could not be started",
      error,
    );
  }
}
