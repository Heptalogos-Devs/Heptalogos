// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Links development types to an explicitly supplied, fully prepared official native runtime.
 * @module prepare-sdk
 */
import { readFile, realpath, lstat, unlink, symlink } from "node:fs/promises";
import { verifyNativeSdk } from "../../../../scripts/package/sdk-inputs.mjs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
/** Links only an actual officially prepared runtime; callers may require its exact selected patch manifest. */
export async function linkPreparedSdk(directory, expected) {
  const root = await realpath(resolve(directory));
  const marker =
    expected ??
    JSON.parse(
      await readFile(
        join(root, "node_modules/openclaw/nous-managed-cognition.json"),
        "utf8",
      ),
    );
  if (
    marker.version !== "2026.9.1" ||
    !marker.files ||
    !Object.keys(marker.files).length
  )
    throw Error("Official SDK preparation metadata is missing");
  const native = await verifyNativeSdk(root, marker);
  const target = fileURLToPath(new URL("../node_modules/openclaw", import.meta.url));
  const existing = await lstat(target).catch(() => undefined);
  if (existing && !existing.isSymbolicLink())
    throw Error("Refusing to replace a materialized dependency directory");
  if (existing) await unlink(target);
  await symlink(native, target, process.platform === "win32" ? "junction" : "dir");
  console.log("Prepared development SDK link from verified official runtime");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3)
    throw Error("Usage: prepare-sdk.mjs <official-runtime-root>");
  await linkPreparedSdk(process.argv[2]);
}
