// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = (group: string, packageName: string, file = "index.js") =>
  resolve(repositoryRoot, "packages", group, packageName, "dist", file);

export default defineConfig({
  resolve: {
    alias: {
      "@heptalogos/foundation-contracts": dist("foundation", "foundation-contracts"),
      "@heptalogos/os-credential": dist("system", "os-credential"),
      "@heptalogos/management-client": dist("application", "management-client"),
      "@heptalogos/management-client/node": dist(
        "application",
        "management-client",
        "node.js",
      ),
      pg: resolve(repositoryRoot, "packages/data/persistence/node_modules/pg"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
