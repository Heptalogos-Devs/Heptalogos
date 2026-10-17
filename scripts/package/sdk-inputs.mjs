// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Verifies the unchanged official archives consumed by the checkout and native SDK preparation.
 * @module sdk-inputs
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/** Checks fixed archive bytes before the existing package manager or installer consumes them. */
export async function verifySdkInputs(root = repositoryRoot) {
  const directory = join(root, "vendor/nous-wave");
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.nativeVersion !== "2026.9.1")
    throw Error("Unsupported official SDK input manifest");
  for (const [key, name] of [
    ["client", "@nous-wave/client"],
    ["nativeInstaller", "@nous-wave/openclaw"],
  ]) {
    const item = manifest[key];
    if (
      item.package !== name ||
      basename(item.file) !== item.file ||
      !item.file.endsWith(".tgz") ||
      item.sourceRepository !== "https://github.com/Heptalogos-Devs/Nous-Wave" ||
      !/^[a-f0-9]{40}$/.test(item.sourceCommit)
    )
      throw Error("Official SDK archive identity is invalid");
    const actual = createHash("sha256")
      .update(await readFile(join(directory, item.file)))
      .digest("hex");
    if (actual !== item.sha256)
      throw Error("Official SDK archive integrity failed: " + key);
  }
  if (manifest.client.sourceCommit !== manifest.nativeInstaller.sourceCommit)
    throw Error("Official SDK archives must come from the same source commit");
  if (!/^[a-f0-9]{64}$/.test(manifest.nativeInstaller.patchManifestSha256))
    throw Error("Official SDK patch manifest identity is invalid");
  return manifest;
}
/** Requires the exact prepared public SDK files, rather than trusting a version or a marker alone. */
export async function verifyNativeSdk(runtimeRoot, expected) {
  const runtime = JSON.parse(await readFile(join(runtimeRoot, "package.json"), "utf8"));
  if (runtime.nousManagedRuntime !== 1)
    throw Error("SDK runtime is not owned by the official installer");
  const native = join(runtimeRoot, "node_modules/openclaw");
  const marker = JSON.parse(
    await readFile(join(native, "nous-managed-cognition.json"), "utf8"),
  );
  if (JSON.stringify(marker) !== JSON.stringify(expected))
    throw Error("Prepared native SDK is not the selected official artifact");
  const files = [
    ...Object.entries(expected.files).map(([path, hashes]) => [path, hashes.patched]),
    ...Object.entries(expected.managedFiles ?? {}),
  ];
  for (const [path, expectedHash] of files) {
    if (path.startsWith("/") || path.split(/[\\/]/).includes(".."))
      throw Error("Invalid native SDK manifest path");
    const actual = createHash("sha256")
      .update(await readFile(join(native, path)))
      .digest("hex");
    if (actual !== expectedHash)
      throw Error("Official SDK preparation integrity failed");
  }
  return native;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifySdkInputs();
  console.log("Official sealed SDK archive integrity PASS");
}
