// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const providerName = process.argv[2];
const role = process.argv[3];
const target = process.argv[4];
const lockfilePath = process.argv[5];
const stale = Number(process.argv[6]);

if (!providerName || !role || !target || !lockfilePath || !Number.isFinite(stale)) {
  throw new Error(
    "usage: stale-reclaim-race.mjs <provider> <role> <target> <lock> <stale>",
  );
}

const provider = require(providerName);
const nodeFs = require("node:fs");
const fs = { ...nodeFs };
let pendingStaleStat;
let didPauseStaleStat = false;

function send(message) {
  if (typeof process.send === "function") process.send(message);
}

if (role === "pause-stale") {
  const stat = nodeFs.stat.bind(nodeFs);
  fs.stat = (path, callback) => {
    stat(path, (error, result) => {
      if (
        error === null &&
        path === lockfilePath &&
        result.isDirectory() &&
        !didPauseStaleStat
      ) {
        didPauseStaleStat = true;
        pendingStaleStat = () => callback(null, result);
        send({ type: "stale-stat-observed", mtimeMs: result.mtimeMs });
        return;
      }
      callback(error, result);
    });
  };
}

const options = {
  stale,
  update: Math.max(1000, Math.floor(stale / 2)),
  retries: 0,
  realpath: true,
  lockfilePath,
  fs,
  onCompromised(error) {
    send({ type: "compromised", code: error?.code ?? "UNKNOWN" });
  },
  onReclaimed() {
    send({ type: "reclaimed" });
  },
};

process.on("message", (message) => {
  if (message?.type === "resume-stale-stat") {
    const resume = pendingStaleStat;
    pendingStaleStat = undefined;
    resume?.();
  }
});

let release;
try {
  release = await provider.lock(target, options);
  send({ type: "acquired" });
} catch (error) {
  send({ type: "error", code: error?.code ?? "UNKNOWN", message: String(error) });
  setTimeout(() => process.exit(0), 10).unref();
}

if (release !== undefined) {
  process.on("message", (message) => {
    void (async () => {
      if (message?.type !== "release") return;
      try {
        await release();
        send({ type: "released" });
      } catch (error) {
        send({
          type: "released",
          releaseError: error?.code ?? String(error),
        });
      }
    })();
  });
}
