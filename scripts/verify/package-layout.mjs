#!/usr/bin/env node

// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates the discoverable two-level package topology and physical package
 * boundary without freezing the current package inventory.
 * @module package-layout
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validatePackageLayout } from "@heptalogos/repo-kit";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const result = await validatePackageLayout({ root });

if (result.errors.length > 0) {
  for (const error of result.errors) console.error(`FAIL ${error}`);
  process.exitCode = 1;
} else {
  console.log(`PASS package layout (${result.packages.length} packages)`);
}
