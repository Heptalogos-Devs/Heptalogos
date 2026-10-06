// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Stable entrypoint for an uninitialized portable Product root.
 * The launcher owns only path derivation and first materialization of the
 * existing Bootstrap locator; Product Host and the reference CLI remain the
 * semantic owners of startup and Management operations.
 * @module portable-launcher
 */

import { randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCATOR_PATH = join(ROOT, "heptalogos.bootstrap.json");
const LIFECYCLE_ROOTS = [
  "PROGRAM",
  "INSTANCE",
  "CONFIGURATION",
  "DATA",
  "SECRET",
  "BLOB",
  "BACKUP",
  "LOG",
  "CACHE",
  "TEMP",
  "RUN",
  "PACKAGE_STAGING",
];

function fail(message) {
  throw new Error(message);
}

function uuidv7() {
  const bytes = randomBytes(16);
  let timestamp = BigInt(Date.now());
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parsedLocator(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail("Bootstrap locator is not an object");
  }
  if (
    value.schemaVersion !== 1 ||
    typeof value.installationId !== "string" ||
    typeof value.instanceId !== "string"
  ) {
    fail("Bootstrap locator does not match schema version 1");
  }
  if (
    typeof value.roots !== "object" ||
    value.roots === null ||
    Array.isArray(value.roots)
  ) {
    fail("Bootstrap locator roots are invalid");
  }
  for (const root of LIFECYCLE_ROOTS) {
    if (typeof value.roots[root] !== "string" || !isAbsolute(value.roots[root])) {
      fail(`Bootstrap locator root ${root} is not an absolute path`);
    }
  }
  return value;
}

async function readExistingLocator() {
  const text = await readFile(LOCATOR_PATH, "utf8");
  const locator = parsedLocator(JSON.parse(text));
  const canonicalRoot = await realpath(ROOT);
  const canonicalProgram = await realpath(locator.roots.PROGRAM);
  if (canonicalRoot !== canonicalProgram) {
    fail("Bootstrap locator PROGRAM root does not match this portable Product root");
  }
  return locator;
}

async function createLocator() {
  const roots = Object.fromEntries(
    LIFECYCLE_ROOTS.map((name) => [
      name,
      name === "PROGRAM" ? ROOT : join(ROOT, name.toLowerCase()),
    ]),
  );
  await Promise.all(
    Object.entries(roots)
      .filter(([name]) => name !== "PROGRAM")
      .map(([, path]) => mkdir(path, { recursive: true })),
  );
  const locator = {
    schemaVersion: 1,
    installationId: uuidv7(),
    instanceId: uuidv7(),
    roots,
  };
  try {
    await writeFile(LOCATOR_PATH, JSON.stringify(locator), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    return locator;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return readExistingLocator();
  }
}

async function ensureLocator() {
  try {
    return await readExistingLocator();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return createLocator();
  }
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
  await ensureLocator();
  const productRoot = await manifestProductRoot();
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
