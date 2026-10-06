// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { BootstrapOwnerWitnessStore } = require("@heptalogos/bootstrap-state");
const { prepareBootstrapPrelude } = require("@heptalogos/bootstrap-runtime");

const [anchorRoot, role, pgBin, portText, ...extra] = process.argv.slice(2);
if (
  !anchorRoot ||
  (role !== "before-postgres" && role !== "ready-before-handoff") ||
  !pgBin ||
  !portText ||
  extra.length > 0
) {
  throw new Error(
    "usage: recovery-bootstrap-process.mjs <anchor> <role> <pg-bin> <port>",
  );
}
const port = Number(portText);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("bootstrap recovery process port is invalid");
}

const LIFECYCLE = {
  startupTimeoutMs: 60_000,
  shutdownTimeoutMs: 30_000,
  readinessPollIntervalMs: 100,
};

function keyProvider() {
  return {
    async withPrivatePostgresBootstrapPassword(_context, use) {
      const password = new TextEncoder().encode(
        "BOOTSTRAP_RECOVERY_TEST_BOOTSTRAP_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
    async withPrivatePostgresHostLeasePassword(_context, use) {
      const password = new TextEncoder().encode(
        "BOOTSTRAP_RECOVERY_TEST_HOST_LEASE_PASSWORD_0123456789",
      );
      try {
        return await use(password);
      } finally {
        password.fill(0);
      }
    },
  };
}

function send(message, callback) {
  if (typeof process.send !== "function") {
    callback?.();
    return;
  }
  process.send(message, callback);
}

function stopAtBoundary(message) {
  return new Promise((resolve, reject) => {
    send(message, (error) => {
      if (error) {
        reject(error);
        return;
      }
      process.kill(process.pid, "SIGSTOP");
      resolve();
    });
  });
}

async function run() {
  const prepared = await prepareBootstrapPrelude(anchorRoot);
  const owned = await prepared.acquireOwnership({ heartbeatMs: 1_000 });
  const instanceRoot = owned.paths.resolve("INSTANCE").canonicalPath;
  const owner = await new BootstrapOwnerWitnessStore(instanceRoot).readOwner();
  if (owner === undefined) throw new Error("bootstrap owner witness is missing");

  const identity = {
    type: "bootstrap-prelude-owned",
    bootId: owned.bootId,
    pid: owner.witness.pid,
    processStartedAtMs: owner.witness.processStartedAtMs,
  };
  if (role === "before-postgres") {
    await stopAtBoundary(identity);
    return;
  }

  const ready = await owned.preparePrivatePostgres({
    toolchainBinDirectory: pgBin,
    initialPort: port,
    lifecycle: LIFECYCLE,
    keyProvider: keyProvider(),
  });
  await stopAtBoundary({
    ...identity,
    type: "postgres-ready-before-handoff",
    port: ready.port,
    clusterSystemIdentifier: ready.clusterSystemIdentifier,
    startupDisposition: ready.startupDisposition,
  });
}

function reportFailure(error) {
  const message = {
    type: "error",
    problemCode: error?.problem?.problemCode,
    message: error instanceof Error ? error.message : String(error),
  };
  if (typeof process.send !== "function") {
    process.exitCode = 1;
    return;
  }
  try {
    process.send(message, () => {
      process.exitCode = 1;
    });
  } catch {
    process.exitCode = 1;
  }
}

run().catch(reportFailure);
