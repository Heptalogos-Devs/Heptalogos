// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  rename,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("retires prior portable application code without deleting current code or lifecycle state", async () => {
  const { retirePreviousProductPayloads } = await import(
    pathToFileURL(resolve("scripts/package/assemble-portable-product.mjs")).href
  );
  const root = await mkdtemp(join(tmpdir(), "heptalogos-portable-payloads-"));
  try {
    const current = "a".repeat(64);
    const previous = "b".repeat(64);
    for (const name of [current, previous]) {
      const directory = join(root, "program/product", name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "payload"), name);
    }
    await mkdir(join(root, "data"));
    await writeFile(join(root, "data/retained"), "retained");
    await retirePreviousProductPayloads(root, current);
    await expect(
      readFile(join(root, "program/product", previous, "payload")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await readFile(join(root, "program/product", current, "payload"), "utf8"),
    ).toBe(current);
    expect(await readFile(join(root, "data/retained"), "utf8")).toBe("retained");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("rebuilds same-version file dependencies when cached installed bytes drift from unchanged artifact inputs", async () => {
  const { ensureArtifactDependencies } = await import(
    pathToFileURL(resolve("scripts/package/assemble-portable-product.mjs")).href
  );
  const root = await mkdtemp(join(tmpdir(), "heptalogos-materialization-"));
  const label = "materialization-test-" + randomUUID();
  const state = resolve("tmp/product-artifact-state", label + ".json");
  const source = (name: string) =>
    join(root, "workspace_modules", name, "dist/index.js");
  const installed = (name: string) =>
    join(root, "node_modules/@fixture", name, "dist/index.js");
  try {
    const workspace = JSON.parse(await readFile(resolve("package.json"), "utf8"));
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "materialization-fixture",
        version: "1.0.0",
        private: true,
        packageManager: workspace.packageManager,
        dependencies: {
          "@fixture/first": "file:workspace_modules/first",
          "@fixture/second": "file:workspace_modules/second",
        },
      }),
    );
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      JSON.stringify({ packages: [] }),
    );
    for (const name of ["first", "second"]) {
      await mkdir(join(root, "workspace_modules", name, "dist"), { recursive: true });
      await writeFile(
        join(root, "workspace_modules", name, "package.json"),
        JSON.stringify({
          name: "@fixture/" + name,
          version: "0.0.0",
          files: ["dist"],
        }),
      );
      await writeFile(source(name), "old-" + name);
    }
    execSync("pnpm install --lockfile-only", {
      cwd: root,
      env: { ...process.env, CI: "true" },
    });
    await ensureArtifactDependencies(root, label);
    for (const name of ["first", "second"]) {
      expect(await readFile(installed(name), "utf8")).toBe("old-" + name);
      // Replace the artifact input, as a build/cache restore does. Do not modify
      // a pnpm hard link in place and accidentally update its installed copy.
      await writeFile(source(name) + ".next", "new-" + name);
      await rename(source(name) + ".next", source(name));
    }
    const currentDigest = await ensureArtifactDependencies(root, label);
    for (const name of ["first", "second"]) {
      expect(await readFile(installed(name), "utf8")).toBe("new-" + name);
      // Restore stale dependency output without changing the authoritative input.
      await unlink(installed(name));
      await writeFile(installed(name), "old-" + name);
      expect(await readFile(source(name), "utf8")).toBe("new-" + name);
    }
    expect(await ensureArtifactDependencies(root, label)).toBe(currentDigest);
    for (const name of ["first", "second"])
      expect(await readFile(installed(name), "utf8")).toBe("new-" + name);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(state, { force: true });
  }
}, 60_000);
