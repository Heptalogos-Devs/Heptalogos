// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Materializes the ProductHost-owned Management OpenAPI document. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(packageRoot, "generated/management.openapi.json");
const { createProductHttpApp } = await import(
  new URL("../dist/product-http.js", import.meta.url).href
);
const unavailable = async () => {
  throw new Error("Schema-only operation invoked");
};
const app = await createProductHttpApp({
  authentication: {
    authenticate: unavailable,
    claimFirstAdministrator: unavailable,
    login: unavailable,
    logout: unavailable,
  },
  product: {
    configuration: unavailable,
    status: unavailable,
    check: unavailable,
    configure: unavailable,
  },
  identity: { installationId: "schema-only", bootId: "schema-only" },
  onAdministratorClaimed: unavailable,
});
const { registerWorldHttp } = await import(
  new URL("../dist/world-http.js", import.meta.url).href
);
const { registerWorldOpportunityHttp } = await import(
  new URL("../dist/world-opportunity-http.js", import.meta.url).href
);
if (!app.hasRoute({ method: "POST", url: "/gateway/v1/world/read" }))
  registerWorldHttp(app);
if (!app.hasRoute({ method: "POST", url: "/gateway/v1/world/advance" }))
  registerWorldOpportunityHttp(app, {
    authenticate: unavailable,
    currentSubject: unavailable,
    runMutation: unavailable,
    advance: unavailable,
  });
const { registerNarrativeHttp } = await import(
  new URL("../dist/narrative-http.js", import.meta.url).href
);
if (!app.hasRoute({ method: "POST", url: "/gateway/v1/narrative/claims" }))
  registerNarrativeHttp(app);
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
