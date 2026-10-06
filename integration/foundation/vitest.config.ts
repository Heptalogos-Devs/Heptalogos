// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const source = (group: string, packageName: string, file = "index.js") =>
  resolve(repositoryRoot, "packages", group, packageName, "dist", file);

const aliases = {
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
  "@heptalogos/persistence/repository": source("data", "persistence", "repository.js"),
  "@heptalogos/persistence": source("data", "persistence"),
  "@heptalogos/runtime-substrate": source("runtime", "runtime-substrate"),
  "@heptalogos/runtime-kernel": source("runtime", "runtime-kernel"),
  "@heptalogos/execution-lineage/runtime-kernel": source(
    "execution",
    "execution-lineage",
    "runtime-kernel.js",
  ),
  "@heptalogos/execution-lineage": source("execution", "execution-lineage"),
  "@heptalogos/evidence": source("execution", "evidence"),
  "@heptalogos/signal": source("execution", "signal"),
  "@heptalogos/work-queue/repository": source(
    "execution",
    "work-queue",
    "repository.js",
  ),
  "@heptalogos/work-queue": source("execution", "work-queue"),
  "@heptalogos/durable-execution": source("execution", "durable-execution"),
  "@heptalogos/effect-operation": source("execution", "effect-operation"),
  execa: resolve(
    repositoryRoot,
    "packages",
    "execution",
    "durable-execution",
    "node_modules",
    "execa",
  ),
  pg: resolve(repositoryRoot, "packages", "data", "persistence", "node_modules", "pg"),
  "kysely/migration": resolve(
    repositoryRoot,
    "packages",
    "data",
    "persistence",
    "node_modules",
    "kysely",
    "dist",
    "migration",
    "index.js",
  ),
  kysely: resolve(
    repositoryRoot,
    "packages",
    "data",
    "persistence",
    "node_modules",
    "kysely",
  ),
};

export default defineConfig({
  resolve: { alias: aliases },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
