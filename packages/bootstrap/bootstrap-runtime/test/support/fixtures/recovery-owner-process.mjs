// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createReadStream } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  loadBootstrapLocator,
  proveLocalInstallationOwner,
  resolveBootstrapPathProfile,
} = require("@heptalogos/bootstrap-runtime");
const { acquireBootstrapOwnership } = require("../../../dist/bootstrap/ownership.js");
const {
  reclaimAbandonedBootstrapOwnership,
} = require("../../../dist/recovery/bootstrap.js");
const { createBootId } = require("@heptalogos/foundation-contracts");

const anchorRoot = process.argv[2];
const role = process.argv[3];
if (!anchorRoot || !role)
  throw new Error("usage: recovery-owner-process.mjs <anchor> <role>");

function send(message) {
  if (typeof process.send === "function") process.send(message);
}

let lease;
try {
  if (role === "hold" || role === "exit-without-release") {
    const locator = await loadBootstrapLocator(anchorRoot);
    const profile = await resolveBootstrapPathProfile(locator, ["INSTANCE"]);
    lease = await acquireBootstrapOwnership(profile.resolve("INSTANCE"), {
      heartbeatMs: 1_000,
      bootId: createBootId(),
    });
  } else if (role === "recover") {
    const principal = await proveLocalInstallationOwner(anchorRoot);
    lease = await reclaimAbandonedBootstrapOwnership(anchorRoot, principal, {
      heartbeatMs: 1_000,
      bootId: createBootId(),
    });
  } else {
    throw new Error(`unsupported role ${role}`);
  }
  send({ type: "acquired" });
  if (role === "exit-without-release") {
    setTimeout(() => process.reallyExit?.(0), 50).unref();
  }
} catch (error) {
  send({
    type: "error",
    problemCode: error?.problem?.problemCode ?? "UNKNOWN",
    message: String(error),
  });
  setTimeout(() => process.exit(0), 20).unref();
}

if (role !== "exit-without-release") {
  process.on("message", (message) => {
    void (async () => {
      if (message?.type !== "release" || lease === undefined) return;
      try {
        await lease.release();
        send({ type: "released" });
      } catch (error) {
        send({
          type: "released",
          problemCode: error?.problem?.problemCode ?? "UNKNOWN",
          message: String(error),
        });
      }
    })();
  });

  // Keep the IPC channel active on Node versions that otherwise allow the module
  // evaluation promise to finish before the parent sends a release message.
  createReadStream("/dev/null").on("error", () => undefined);
}
