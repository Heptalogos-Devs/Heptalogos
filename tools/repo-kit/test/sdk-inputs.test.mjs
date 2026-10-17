// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  verifySdkInputs,
  verifyNativeSdk,
} from "../../../scripts/package/sdk-inputs.mjs";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
it("rejects changed archive inputs and requires exact prepared native file bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-sdk-inputs-"));
  try {
    const vendor = join(root, "vendor/nous-wave");
    await mkdir(vendor, { recursive: true });
    const archive = Buffer.from("isolated checksum fixture, not an executable SDK");
    await writeFile(join(vendor, "fixture.tgz"), archive);
    const entry = {
      file: "fixture.tgz",
      sha256: digest(archive),
      sourceRepository: "https://github.com/Heptalogos-Devs/Nous-Wave",
      sourceCommit: "0".repeat(40),
    };
    const manifest = {
      schemaVersion: 1,
      nativeVersion: "2026.9.1",
      client: { ...entry, package: "@nous-wave/client" },
      nativeInstaller: {
        ...entry,
        package: "@nous-wave/openclaw",
        patchManifestSha256: "1".repeat(64),
      },
    };
    await writeFile(join(vendor, "manifest.json"), JSON.stringify(manifest));
    expect((await verifySdkInputs(root)).client.sha256).toBe(entry.sha256);
    await writeFile(
      join(vendor, "manifest.json"),
      JSON.stringify({
        ...manifest,
        nativeInstaller: { ...manifest.nativeInstaller, sourceCommit: "1".repeat(40) },
      }),
    );
    await expect(verifySdkInputs(root)).rejects.toThrow("same source commit");
    await writeFile(join(vendor, "manifest.json"), JSON.stringify(manifest));
    await writeFile(join(vendor, "fixture.tgz"), "changed");
    await expect(verifySdkInputs(root)).rejects.toThrow("integrity");
    const native = join(root, "node_modules/openclaw");
    await mkdir(native, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ nousManagedRuntime: 1 }),
    );
    const expected = {
      version: "2026.9.1",
      files: { "public-sdk.js": { patched: digest("actual bytes") } },
    };
    await writeFile(
      join(native, "nous-managed-cognition.json"),
      JSON.stringify(expected),
    );
    expected.managedFiles = {
      "controlled.mjs": digest("actual managed implementation"),
    };
    await writeFile(
      join(native, "nous-managed-cognition.json"),
      JSON.stringify(expected),
    );
    await writeFile(join(native, "public-sdk.js"), "actual bytes");
    await writeFile(join(native, "controlled.mjs"), "actual managed implementation");
    expect(await verifyNativeSdk(root, expected)).toBe(native);
    await writeFile(join(native, "public-sdk.js"), "changed bytes");
    await expect(verifyNativeSdk(root, expected)).rejects.toThrow("integrity");
    await expect(
      verifyNativeSdk(root, { ...expected, version: "wrong" }),
    ).rejects.toThrow("selected official artifact");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
