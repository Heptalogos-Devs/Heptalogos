#!/usr/bin/env node
// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reads the installed native profile catalog before any agent invocation.
 * @module agent-catalog
 */
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
try {
  if (process.argv.length !== 2) throw Error("catalog_arguments_rejected");
  const result: unknown = await callGatewayFromCli(
    "agents.list",
    { json: true, timeout: "30000" },
    {},
    { progress: false },
  );
  if (
    !result ||
    typeof result !== "object" ||
    !("agents" in result) ||
    !Array.isArray(result.agents)
  )
    throw Error("native_catalog_invalid");
  const ids = result.agents.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !entry.id
    )
      throw Error("native_catalog_invalid");
    return entry.id;
  });
  process.stdout.write(JSON.stringify({ status: "catalog", result: ids }) + "\n");
} catch {
  process.stdout.write('{"status":"unavailable"}\n');
  process.exitCode = 1;
}
