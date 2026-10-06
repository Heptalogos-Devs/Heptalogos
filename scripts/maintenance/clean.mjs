// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runs the repository-owned fail-closed cleanup plan for generated build and
 * cache residue without deleting unknown material.
 * @module clean
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanRepository } from "@heptalogos/repo-kit";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const dryRun = process.argv.slice(2).includes("--dry-run");

try {
  const result = cleanRepository({ root, dryRun });
  for (const target of result.targets) {
    const state = dryRun
      ? "DRY-RUN"
      : result.removed.includes(target)
        ? "REMOVE"
        : "MISSING";
    console.log(`${state} ${target}`);
  }
  console.log(`PASS clean${dryRun ? " (dry-run)" : ""}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
