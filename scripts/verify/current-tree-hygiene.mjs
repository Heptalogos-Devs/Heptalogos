// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Runs current-tree identity and compatibility-register checks against the
 * repository's executable surfaces and reports only observed findings.
 * @module current-tree-hygiene
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { scanCurrentTree } from "@heptalogos/repo-kit";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const result = scanCurrentTree({ root });

if (result.findings.length > 0) {
  for (const finding of result.findings) {
    console.error(`FAIL ${finding.code} ${finding.path}: ${finding.message}`);
  }
  process.exitCode = 1;
} else {
  console.log("PASS current-tree hygiene: current identities and register valid");
}
