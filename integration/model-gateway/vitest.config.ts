// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

// Intentional duplication: this integration uses a source-tree alias map that
// is deliberately independent from the Product Host integration's alias map.
/* jscpd:ignore-start */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const source = (group: string, packageName: string, file = "index.js") =>
  resolve(repositoryRoot, "packages", group, packageName, "dist", file);

export default defineConfig({
  resolve: {
    alias: {
      "@heptalogos/foundation-contracts": source("foundation", "foundation-contracts"),
      "@heptalogos/schema-runtime/typebox": source(
        "foundation",
        "schema-runtime",
        "typebox.js",
      ),
      "@heptalogos/schema-runtime": source("foundation", "schema-runtime"),
      "@heptalogos/time-service": source("foundation", "time-service"),
      "@heptalogos/bootstrap-state": source("bootstrap", "bootstrap-state"),
      "@heptalogos/bootstrap-runtime": source("bootstrap", "bootstrap-runtime"),
      "@heptalogos/private-postgres": source("bootstrap", "private-postgres"),
      "@heptalogos/host-ownership": source("bootstrap", "host-ownership"),
      "@heptalogos/canonical-schema": source("data", "canonical-schema"),
      "@heptalogos/persistence/repository": source(
        "data",
        "persistence",
        "repository.js",
      ),
      "@heptalogos/persistence": source("data", "persistence"),
      "@heptalogos/execution-lineage": source("execution", "execution-lineage"),
      "@heptalogos/evidence": source("execution", "evidence"),
      "@heptalogos/os-credential": source("system", "os-credential"),
      "@heptalogos/configuration": source("system", "configuration"),
      "@heptalogos/secret": source("system", "secret"),
      "@heptalogos/network-access": source("system", "network-access"),
      "@heptalogos/ai-runtime": source("system", "ai-runtime"),
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
/* jscpd:ignore-end */
