// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { cleanRepository, discoverCleanPlan } from "../src/clean.mjs";

async function fixtureTree(setup) {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-clean-"));
  try {
    await writeFile(
      join(root, ".gitignore"),
      "dist/\ncoverage/\n.nx/\ntest-results/\n",
    );
    await writeFile(
      join(root, "tsconfig.build.json"),
      JSON.stringify({
        compilerOptions: {
          outDir: "./dist",
          tsBuildInfoFile: "./dist/tsconfig.build.tsbuildinfo",
        },
      }),
    );
    await setup(root);
    return root;
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

describe("repository cleaner", () => {
  it("derives configured outputs and leaves them untouched in dry-run mode", async () => {
    const root = await fixtureTree(async (rootPath) => {
      await mkdir(join(rootPath, "dist"), { recursive: true });
      await writeFile(join(rootPath, "dist", "generated.js"), "generated\n");
    });
    try {
      const result = cleanRepository({ root, dryRun: true });
      expect(result.targets).toContain(join(root, "dist"));
      await expect(readFile(join(root, "dist", "generated.js"), "utf8")).resolves.toBe(
        "generated\n",
      );
      expect(result.removed).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes existing generated outputs and accepts missing outputs", async () => {
    const root = await fixtureTree(async (rootPath) => {
      await mkdir(join(rootPath, "dist"), { recursive: true });
      await writeFile(join(rootPath, "dist", "generated.js"), "generated\n");
    });
    try {
      const result = cleanRepository({ root });
      expect(result.removed).toContain(join(root, "dist"));
      await expect(
        readFile(join(root, "dist", "generated.js"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes an orphan package only when every entry is generated residue", async () => {
    const root = await fixtureTree(async (rootPath) => {
      await mkdir(join(rootPath, "packages", "orphan", "dist"), { recursive: true });
      await writeFile(
        join(rootPath, "packages", "orphan", "dist", "index.js"),
        "generated\n",
      );
    });
    try {
      const result = cleanRepository({ root });
      expect(result.removed).toContain(join(root, "packages", "orphan"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("aborts before deletion when an orphan package contains unknown files", async () => {
    const root = await fixtureTree(async (rootPath) => {
      await mkdir(join(rootPath, "dist"), { recursive: true });
      await writeFile(join(rootPath, "dist", "generated.js"), "generated\n");
      await mkdir(join(rootPath, "packages", "orphan", "dist"), { recursive: true });
      await writeFile(join(rootPath, "packages", "orphan", "README.md"), "keep\n");
    });
    try {
      expect(() => cleanRepository({ root })).toThrow(/unknown file/u);
      await expect(readFile(join(root, "dist", "generated.js"), "utf8")).resolves.toBe(
        "generated\n",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an output that resolves outside the repository", async () => {
    const root = await fixtureTree(async (rootPath) => {
      await writeFile(
        join(rootPath, "tsconfig.outside.json"),
        JSON.stringify({ compilerOptions: { outDir: "../outside" } }),
      );
    });
    try {
      expect(() => discoverCleanPlan({ root })).toThrow(/outside repository/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked output whose target escapes the repository", async () => {
    let symlinkSupported = true;
    const root = await fixtureTree(async (rootPath) => {
      const outside = await mkdtemp(join(tmpdir(), "heptalogos-clean-outside-"));
      await writeFile(
        join(rootPath, "tsconfig.symlink.json"),
        JSON.stringify({ compilerOptions: { outDir: "./linked-output" } }),
      );
      try {
        await symlink(outside, join(rootPath, "linked-output"), "junction");
      } catch (error) {
        await rm(outside, { recursive: true, force: true });
        if (error?.code === "EPERM" || error?.code === "EACCES") {
          symlinkSupported = false;
          return;
        }
        throw error;
      }
    });
    try {
      if (!symlinkSupported) return;
      expect(() => discoverCleanPlan({ root })).toThrow(/symlink|outside repository/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
