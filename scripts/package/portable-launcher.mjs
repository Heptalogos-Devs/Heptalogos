// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stable entrypoint for an uninitialized portable Product root.
 * The launcher derives portable paths and delegates installation initialization
 * to Product Host; startup and Management stay with their semantic owners.
 * @module portable-launcher
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function fail(message) {
  throw new Error(message);
}

async function freeLoopbackPort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise((resolvePromise) => server.close(() => resolvePromise()));
    fail("Portable launcher could not allocate a loopback port");
  }
  const port = address.port;
  await new Promise((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
  return port;
}

async function manifestProductRoot() {
  const manifest = JSON.parse(await readFile(join(ROOT, "manifest.json"), "utf8"));
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    typeof manifest.productGeneration !== "string" ||
    !/^[0-9a-f]{64}$/u.test(manifest.productGeneration)
  ) {
    fail("Portable Product manifest does not contain a valid product generation");
  }
  return join(ROOT, "program", "product", manifest.productGeneration);
}

function userArguments(rawArguments) {
  const argumentsToForward = [...rawArguments];
  for (const option of ["--anchor-root", "--postgres-bin"]) {
    if (argumentsToForward.includes(option)) {
      fail(`${option} is owned by the portable launcher`);
    }
  }
  return argumentsToForward;
}

async function main() {
  const rawArguments = process.argv.slice(2);
  let mode = "start";
  if (rawArguments[0]?.toLowerCase() === "start") {
    rawArguments.shift();
  } else if (rawArguments.length > 0) {
    mode = "cli";
  }
  const productRoot = await manifestProductRoot();
  const { initializeProductInstallation } = await import(
    pathToFileURL(join(productRoot, "installation.js")).href
  );
  await initializeProductInstallation(ROOT);
  const hostExecutable = join(productRoot, "bin.js");
  const cliExecutable = join(productRoot, "cli", "bin.js");
  const postgresBin = join(ROOT, "runtime", "postgresql", "bin");
  const forwarded = userArguments(rawArguments);
  const childArguments =
    mode === "start"
      ? [
          "--anchor-root",
          ROOT,
          "--postgres-bin",
          postgresBin,
          ...(forwarded.includes("--initial-postgres-port")
            ? forwarded
            : [
                "--initial-postgres-port",
                String(await freeLoopbackPort()),
                ...forwarded,
              ]),
        ]
      : [...forwarded, "--anchor-root", ROOT];
  const executable = mode === "start" ? hostExecutable : cliExecutable;
  process.argv = [process.execPath, executable, ...childArguments];
  await import(pathToFileURL(executable).href);
}

try {
  await main();
} catch (error) {
  console.error(
    `Portable Product launcher failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
