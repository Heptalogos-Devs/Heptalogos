// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Materializes a source-free npm package from the verified bundle and locked installed dependencies. */
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const destination = resolve(process.argv[2] ?? join(root, "../../..", "tmp/releases"));
await mkdir(destination, { recursive: true });
const stage = await mkdtemp(join(tmpdir(), "heptalogos-qq-package-"));
try {
  const original = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const dependencies = {};
  for (const name of Object.keys(original.dependencies)) {
    const installed = JSON.parse(
      await readFile(join(root, "node_modules", name, "package.json"), "utf8"),
    );
    dependencies[name] = installed.version;
  }
  const peerDependencies = {};
  for (const name of Object.keys(original.peerDependencies ?? {})) {
    const installed = JSON.parse(
      await readFile(join(root, "node_modules", name, "package.json"), "utf8"),
    );
    peerDependencies[name] = installed.version;
  }
  const {
    devDependencies: _development,
    private: _private,
    scripts: _scripts,
    ...manifest
  } = original;
  await writeFile(
    join(stage, "package.json"),
    JSON.stringify({ ...manifest, dependencies, peerDependencies }, null, 2) + "\n",
  );
  await mkdir(join(stage, "dist"));
  for (const file of [
    "index.js",
    "index.d.ts",
    "routing.d.ts",
    "policy.d.ts",
    "prepare-gateway.js",
    "dispatch.js",
    "gateway-read.js",
    "expression-send.js",
    "world-schedule.js",
    "world-wake-cli.js",
  ]) {
    const contents = await readFile(join(root, "dist", file), "utf8");
    await writeFile(
      join(stage, "dist", file),
      contents.replace(/^\/\/# sourceMappingURL=.*$/gmu, ""),
    );
  }
  for (const file of ["openclaw.plugin.json", "README.md"])
    await copyFile(join(root, file), join(stage, file));
  for (const file of ["LICENSE", "NOTICE"])
    await copyFile(join(root, "../../..", file), join(stage, file));
  const packed = spawnSync(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    { cwd: stage, encoding: "utf8" },
  );
  if (packed.status !== 0) throw Error(packed.stderr || "npm pack failed");
  const result = JSON.parse(packed.stdout)[0];
  console.log(
    JSON.stringify({
      path: join(destination, result.filename),
      integrity: result.integrity,
      files: result.files.map((item) => item.path),
    }),
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
