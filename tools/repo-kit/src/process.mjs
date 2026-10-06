// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns repository subprocess execution through Execa with bounded, normalized
 * results so scripts do not create competing process wrappers.
 * @module process
 */

import { execa, execaSync } from "execa";

function text(value) {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function normalizeResult(command, args, result) {
  return {
    command,
    args: [...args],
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    stdout: text(result.stdout),
    stderr: text(result.stderr),
    failed: result.failed,
  };
}

function throwProcessError(normalized) {
  const error = new Error(
    `Process failed: ${normalized.command} (exit=${String(normalized.exitCode)}, signal=${String(normalized.signal)})`,
  );
  error.result = normalized;
  throw error;
}

function execaOptions(options) {
  const { reject: _reject, ...rest } = options;
  return {
    ...rest,
    reject: false,
    shell: false,
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  };
}

/** Run a subprocess with normalized output and optional fail-closed rejection. */
export async function runProcess(command, args = [], options = {}) {
  const result = await execa(command, [...args], execaOptions(options));
  const normalized = normalizeResult(command, args, result);
  if (options.reject && normalized.failed) throwProcessError(normalized);
  return normalized;
}

/** Run a subprocess and throw when it exits unsuccessfully. */
export function runProcessChecked(command, args = [], options = {}) {
  return runProcess(command, args, { ...options, reject: options.reject ?? true });
}

/** Run a synchronous subprocess with the shared normalized result shape. */
export function runProcessSync(command, args = [], options = {}) {
  const result = execaSync(command, [...args], execaOptions(options));
  const normalized = normalizeResult(command, args, result);
  if (options.reject && normalized.failed) throwProcessError(normalized);
  return normalized;
}

/** Run a synchronous subprocess and throw when it exits unsuccessfully. */
export function runProcessSyncChecked(command, args = [], options = {}) {
  return runProcessSync(command, args, {
    ...options,
    reject: options.reject ?? true,
  });
}

/** Run pnpm through the repository subprocess owner. */
export function runPnpm(args, options = {}) {
  return runProcessChecked("pnpm", args, options);
}

/** Run a Node script without enabling shell interpretation. */
export function runNode(script, args = [], options = {}) {
  return runProcessChecked(process.execPath, [script, ...args], options);
}

/** Run a synchronous Git command through the shared process boundary. */
export function runGitSync(args, options = {}) {
  return runProcessSyncChecked("git", args, options);
}
