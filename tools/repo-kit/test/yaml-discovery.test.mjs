// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findRepositoryFiles, findRepositoryFilesSync } from "../src/discovery.mjs";
import { parseYaml, readYamlFile } from "../src/yaml.mjs";

async function fixtureTree(setup) {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-repo-kit-"));
  try {
    return await setup(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("repo-kit YAML mechanics", () => {
  it("parses structured YAML without a line-oriented approximation", () => {
    expect(parseYaml("catalog:\n  package: 1.2.3\n", "fixture")).toEqual({
      catalog: { package: "1.2.3" },
    });
  });

  it("reports YAML parser errors with the source label", () => {
    expect(() => parseYaml("catalog: [", "fixture.yaml")).toThrow(/fixture\.yaml/u);
  });

  it("reads YAML files through the same parser", async () => {
    await fixtureTree(async (root) => {
      const path = join(root, "config.yaml");
      await writeFile(path, "enabled: true\n");
      expect(readYamlFile(path)).toEqual({ enabled: true });
    });
  });
});

describe("repo-kit read-only discovery", () => {
  it("uses patterns and ignores to return sorted absolute files", async () => {
    await fixtureTree(async (root) => {
      await mkdir(join(root, "src", "nested"), { recursive: true });
      await mkdir(join(root, "src", "fixtures"), { recursive: true });
      await writeFile(join(root, "src", "b.ts"), "");
      await writeFile(join(root, "src", "nested", "a.ts"), "");
      await writeFile(join(root, "src", "fixtures", "ignored.ts"), "");

      const expected = [
        join(root, "src", "b.ts"),
        join(root, "src", "nested", "a.ts"),
      ].sort((left, right) => left.localeCompare(right));
      const options = {
        root,
        patterns: ["src/**/*.ts"],
        ignore: ["src/fixtures/**"],
      };
      expect(findRepositoryFilesSync(options)).toEqual(expected);
      await expect(findRepositoryFiles(options)).resolves.toEqual(expected);
    });
  });
});
