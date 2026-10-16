// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Links development types to an explicitly supplied, fully prepared official native runtime. */
import { readFile, realpath, lstat, unlink, symlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
if (process.argv.length !== 3)
  throw Error("Usage: prepare-sdk.mjs <official-runtime-root>");
const root = await realpath(resolve(process.argv[2]));
const runtime = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
if (runtime.nousManagedRuntime !== 1)
  throw Error("Development SDK must be installed by the official Nous installer");
const native = await realpath(join(root, "node_modules/openclaw"));
const marker = JSON.parse(
  await readFile(join(native, "nous-managed-cognition.json"), "utf8"),
);
if (marker.version !== "2026.9.1" || !marker.files || !Object.keys(marker.files).length)
  throw Error("Official SDK preparation metadata is missing");
for (const [path, hashes] of Object.entries(marker.files)) {
  const actual = createHash("sha256")
    .update(await readFile(join(native, path)))
    .digest("hex");
  if (actual !== hashes.patched)
    throw Error("Official SDK preparation integrity failed");
}
const target = fileURLToPath(new URL("../node_modules/openclaw", import.meta.url));
const existing = await lstat(target).catch(() => undefined);
if (existing && !existing.isSymbolicLink())
  throw Error("Refusing to replace a materialized dependency directory");
if (existing) await unlink(target);
await symlink(native, target, process.platform === "win32" ? "junction" : "dir");
console.log("Prepared development SDK link from verified official runtime");
