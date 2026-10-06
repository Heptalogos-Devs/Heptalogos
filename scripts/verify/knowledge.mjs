#!/usr/bin/env node

// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Executes the repository knowledge-plane and link validator.
 * @module knowledge
 */

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validateKnowledge } from "@heptalogos/repo-kit";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const result = validateKnowledge({ root });

if (result.errors.length > 0) {
  for (const error of result.errors) {
    console.error("FAIL " + error.code + " " + error.path + ": " + error.message);
  }
  process.exitCode = 1;
} else {
  console.log(
    "PASS knowledge structure: markdown=" +
      result.markdownCount +
      " json=" +
      result.jsonCount,
  );
}
