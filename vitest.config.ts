// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const foundationContractsSource = fileURLToPath(
  new URL("./packages/foundation/foundation-contracts/src/index.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "@heptalogos/foundation-contracts": foundationContractsSource,
    },
  },
  test: {
    environment: "node",
    passWithNoTests: true,
    include: ["test/**/*.test.ts", "**/test/**/*.test.mjs"],
  },
});
