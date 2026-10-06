#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Built reference CLI entrypoint.
 * @module bin
 */

import { run } from "@oclif/core";
import { CliFailure } from "./base-command.js";

function errorCode(error: unknown): string {
  if (error instanceof CliFailure) return error.problemCode;
  return "cli.invalid_request";
}

function errorMessage(error: unknown): string {
  if (error instanceof CliFailure) return error.message;
  return error instanceof Error
    ? error.message
    : "The CLI command could not be completed";
}

try {
  await run(process.argv.slice(2), import.meta.url);
} catch (error) {
  const failure = {
    problemCode: errorCode(error),
    detail: errorMessage(error),
    ...(error instanceof CliFailure && error.category !== undefined
      ? { category: error.category }
      : {}),
    ...(error instanceof CliFailure && error.retryClass !== undefined
      ? { retryClass: error.retryClass }
      : {}),
  };
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ error: failure }) + "\n");
  } else {
    process.stderr.write(failure.problemCode + ": " + failure.detail + "\n");
  }
  process.exitCode = error instanceof CliFailure ? error.exitCode : 2;
}
