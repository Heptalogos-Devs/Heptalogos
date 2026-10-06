// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePackageLayout } from "../src/package-layout.mjs";

async function fixtureTree(setup) {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-package-layout-"));
  try {
    await mkdir(join(root, "packages", "foundation", "alpha", "src"), {
      recursive: true,
    });
    await mkdir(join(root, "packages", "execution", "beta", "src"), {
      recursive: true,
    });
    await writeFile(
      join(root, "packages", "foundation", "README.md"),
      "# Foundation\n",
    );
    await writeFile(join(root, "packages", "execution", "README.md"), "# Execution\n");
    await writeFile(
      join(root, "packages", "foundation", "alpha", "package.json"),
      JSON.stringify({ name: "@heptalogos/alpha" }),
    );
    await writeFile(
      join(root, "packages", "execution", "beta", "package.json"),
      JSON.stringify({ name: "@heptalogos/beta" }),
    );
    await writeFile(
      join(root, "packages", "foundation", "alpha", "README.md"),
      "# Alpha\n",
    );
    await writeFile(
      join(root, "packages", "execution", "beta", "README.md"),
      "# Beta\n",
    );
    await writeFile(
      join(root, "packages", "INDEX.md"),
      "[alpha](./foundation/alpha/README.md)\n[beta](./execution/beta/README.md)\n",
    );
    await setup(root);
    return validatePackageLayout({ root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("package layout invariants", () => {
  it("accepts discoverable two-level packages and current index coverage", async () => {
    const result = await fixtureTree(async () => undefined);
    expect(result.errors).toEqual([]);
    expect(result.packages.map(({ directoryName }) => directoryName)).toEqual([
      "execution/beta",
      "foundation/alpha",
    ]);
  });

  it("rejects a flat package directory", async () => {
    const result = await fixtureTree(async (root) => {
      await mkdir(join(root, "packages", "flat"), { recursive: true });
      await writeFile(
        join(root, "packages", "flat", "package.json"),
        JSON.stringify({ name: "@heptalogos/flat" }),
      );
      await writeFile(join(root, "packages", "flat", "README.md"), "# Flat\n");
    });
    expect(result.errors).toContain(
      "packages/flat/package.json must be packages/<group>/<package>/package.json",
    );
  });

  it("rejects a package manifest placed at group level", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFile(
        join(root, "packages", "foundation", "package.json"),
        JSON.stringify({ name: "@heptalogos/foundation" }),
      );
    });
    expect(result.errors).toContain(
      "packages/foundation/package.json must be packages/<group>/<package>/package.json",
    );
  });

  it("rejects a physical relative import that crosses package roots", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFile(
        join(root, "packages", "foundation", "alpha", "src", "index.ts"),
        'import value from "../../../execution/beta/src/index.js";\nexport { value };\n',
      );
      await writeFile(
        join(root, "packages", "execution", "beta", "src", "index.ts"),
        "export default true;\n",
      );
    });
    expect(
      result.errors.some((error) =>
        error.includes("crosses package root with relative import"),
      ),
    ).toBe(true);
  });

  it("discovers a newly added group without an allow-list edit", async () => {
    const result = await fixtureTree(async (root) => {
      await mkdir(join(root, "new-group", "placeholder"), { recursive: true });
      await rm(join(root, "new-group"), { recursive: true, force: true });
      await mkdir(join(root, "packages", "new-group", "gamma"), {
        recursive: true,
      });
      await writeFile(
        join(root, "packages", "new-group", "README.md"),
        "# New group\n",
      );
      await writeFile(
        join(root, "packages", "new-group", "gamma", "package.json"),
        JSON.stringify({ name: "@heptalogos/gamma" }),
      );
      await writeFile(
        join(root, "packages", "new-group", "gamma", "README.md"),
        "# Gamma\n",
      );
      await writeFile(
        join(root, "packages", "INDEX.md"),
        "[alpha](./foundation/alpha/README.md)\n[beta](./execution/beta/README.md)\n[gamma](./new-group/gamma/README.md)\n",
      );
    });
    expect(result.errors).toEqual([]);
    expect(result.packages.map(({ directoryName }) => directoryName)).toContain(
      "new-group/gamma",
    );
  });
});
