// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Prepares an isolated development SDK through the selected official Nous installer.
 * @module prepare-native-sdk
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcessChecked } from "@heptalogos/repo-kit";
import { verifySdkInputs, verifyNativeSdk } from "./sdk-inputs.mjs";
import { linkPreparedSdk } from "../../packages/application/openclaw-host/scripts/prepare-sdk.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const inputs = await verifySdkInputs(root);
const installer = dirname(
  dirname(fileURLToPath(import.meta.resolve("@nous-wave/openclaw"))),
);
const bytes = await readFile(join(installer, "patches/manifest.json"));
if (
  createHash("sha256").update(bytes).digest("hex") !==
  inputs.nativeInstaller.patchManifestSha256
)
  throw Error("Installed official native package does not match the sealed input");
const expected = JSON.parse(bytes);
const runtime = join(
  root,
  ".cache/native-sdk",
  inputs.nativeInstaller.sha256,
  process.platform + "-" + process.arch,
);
try {
  await verifyNativeSdk(runtime, expected);
} catch {
  await runProcessChecked(
    process.execPath,
    [join(installer, "bin/install.mjs"), runtime],
    { cwd: root },
  );
}
await linkPreparedSdk(runtime, expected);
console.log("Official native SDK prepared for this checkout");
