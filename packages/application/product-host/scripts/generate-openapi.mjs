// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Materializes the ProductHost-owned Management OpenAPI document. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(packageRoot, "generated/management.openapi.json");
const { createManagementHttpApp } = await import(
  new URL("../dist/http.js", import.meta.url).href
);

const unavailable = async () => {
  throw new Error("The schema-only Management service was invoked");
};
const schemaOnlyService = {
  getDiscovery: unavailable,
  getSystemStatus: unavailable,
  getHost: unavailable,
  getRuntimeGraph: unavailable,
  getCapabilityGraph: unavailable,
  getReadiness: unavailable,
  ensureFirstAdministratorClaim: unavailable,
  claimFirstAdministrator: unavailable,
  login: unavailable,
  authenticate: unavailable,
  logout: unavailable,
  getCompatibilityDescriptor: unavailable,
  contractVersion: "management.v1",
};

const app = await createManagementHttpApp(schemaOnlyService);
await app.ready();
const expected = JSON.stringify(app.swagger(), null, 2) + "\n";
await app.close();

if (process.argv.includes("--check")) {
  const actual = await readFile(outputPath, "utf8").catch(() => undefined);
  if (actual !== expected) {
    throw new Error("Product Host Management OpenAPI artifact is out of date");
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected, "utf8");
}
