// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const properLockfile = require("@bybrave/proper-lockfile2");
const NO_AUTOMATIC_STALE_RECLAIM_MS = Number.MAX_SAFE_INTEGER;
const [instanceRoot, holdMsText, resultFile] = process.argv.slice(2);
const lockfilePath = join(instanceRoot, ".heptalogos-bootstrap.lock");
const criticalOwnerPath = join(instanceRoot, ".critical-owner");

async function main() {
  let release;
  try {
    release = await properLockfile.lock(instanceRoot, {
      stale: NO_AUTOMATIC_STALE_RECLAIM_MS,
      update: 1000,
      retries: 0,
      realpath: true,
      lockfilePath,
      onCompromised: () => {},
    });
  } catch (error) {
    if (error?.code === "ELOCKED") {
      await writeFile(resultFile, "LOCKED");
      process.exitCode = 3;
      return;
    }
    await writeFile(resultFile, "ERROR");
    process.exitCode = 4;
    return;
  }

  let enteredCriticalSection = false;
  try {
    try {
      await mkdir(criticalOwnerPath);
    } catch (error) {
      if (error?.code === "EEXIST") {
        await writeFile(resultFile, "DOUBLE_OWNER");
        process.exitCode = 2;
        return;
      }
      throw error;
    }
    enteredCriticalSection = true;
    await writeFile(resultFile, "ACQUIRED");
    await new Promise((resolve) => setTimeout(resolve, Number(holdMsText)));
  } finally {
    if (enteredCriticalSection) {
      await rm(criticalOwnerPath, { force: true, recursive: true });
    }
    await release();
  }
}

await main();
