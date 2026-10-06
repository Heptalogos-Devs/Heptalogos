#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Built daemon entrypoint for the real headless Product Host.
 * @module bin
 */

import { ProblemError } from "@heptalogos/foundation-contracts";
import { startProductHostFromArgv } from "./host.js";
import { BOOTSTRAP_RUNTIME_GENERATION_ID } from "./generated/build-identities.js";

function problemCode(error: unknown): string {
  if (error instanceof ProblemError) return error.problem.problemCode;
  return "product-host.startup_failed";
}

function reportFailure(error: unknown): void {
  const detail =
    error instanceof ProblemError
      ? (error.problem.detail ?? error.problem.title)
      : error instanceof Error
        ? error.message
        : String(error);
  process.stderr.write(
    JSON.stringify({
      type: "ERROR",
      problemCode: problemCode(error),
      ...(detail === undefined ? {} : { detail }),
    }) + "\n",
  );
}

const main = async (): Promise<void> => {
  const host = await startProductHostFromArgv(process.argv.slice(2));
  process.stdout.write(
    JSON.stringify({
      type: "READY",
      installationId: host.installationId,
      instanceId: host.instanceId,
      bootId: host.bootId,
      origin: host.origin,
      productGeneration: host.productGeneration,
      bootstrapRuntimeGeneration: BOOTSTRAP_RUNTIME_GENERATION_ID,
    }) + "\n",
  );

  let stopping: Promise<void> | undefined;
  let stoppedResolve: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    stoppedResolve = resolve;
  });
  const stop = (): void => {
    if (stopping !== undefined) return;
    stopping = host.close().finally(() => {
      stoppedResolve?.();
    });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  host.signal.addEventListener("abort", stop, { once: true });
  await stopped;
};

try {
  await main();
} catch (error) {
  reportFailure(error);
  process.exitCode = 1;
}
