// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Materializes the ProductHost-owned Subject Chat OpenAPI document. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = resolve(packageRoot, "generated/subject-chat.openapi.json");
const { createSubjectChatHttpApp } = await import(
  new URL("../dist/subject-chat-http.js", import.meta.url).href
);

const unavailable = async () => {
  throw new Error("The schema-only Subject Chat service was invoked");
};
const schemaOnlyService = {
  getConversationForAdministrator: unavailable,
  acceptInbound: unavailable,
  listMessages: unavailable,
};
const app = await createSubjectChatHttpApp({
  service: schemaOnlyService,
  authenticate: unavailable,
});
await app.ready();
const expected = JSON.stringify(app.swagger(), null, 2) + "\n";
await app.close();

if (process.argv.includes("--check")) {
  const actual = await readFile(outputPath, "utf8").catch(() => undefined);
  if (actual !== expected) {
    throw new Error("Product Host Subject Chat OpenAPI artifact is out of date");
  }
} else {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected, "utf8");
}
