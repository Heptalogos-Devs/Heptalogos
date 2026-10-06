// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validatePackageDocumentation } from "../src/package-docs.mjs";

const packageReadme = [
  "# Example",
  "",
  "This package owns the example semantic boundary.",
  "",
  "[Current Architecture](../../../docs/architecture/authority.md)",
  "",
].join("\n");

async function fixtureTree(setup) {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-package-docs-"));
  try {
    await mkdir(join(root, "packages/foundation/example"), { recursive: true });
    await mkdir(join(root, "docs/architecture"), { recursive: true });
    await writeFile(join(root, "packages/AGENTS.md"), "# Package agents\n");
    await writeFile(join(root, "packages/README.md"), "# Packages\n");
    await writeFile(
      join(root, "packages/INDEX.md"),
      "[example](./foundation/example/README.md)\n",
    );
    await writeFile(join(root, "packages/foundation/example/README.md"), packageReadme);
    await writeFile(join(root, "docs/architecture/authority.md"), "# Architecture\n");
    const result = await setup(root);
    return (
      result ??
      validatePackageDocumentation({
        root,
        productPackages: [
          {
            directory: join(root, "packages/foundation/example"),
            directoryName: "foundation/example",
            manifestName: "@heptalogos/example",
          },
        ],
      })
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function hasError(result, text) {
  return result.errors.some((error) => error.includes(text));
}

describe("package documentation topology", () => {
  it("accepts a README with package-specific headings", async () => {
    const result = await fixtureTree(async () => undefined);
    expect(result.errors).toEqual([]);
  });

  it("fails when a package README is missing", async () => {
    const result = await fixtureTree(async (root) => {
      await rm(join(root, "packages/foundation/example/README.md"));
      return undefined;
    });
    expect(hasError(result, "package README.md is missing")).toBe(true);
  });

  it("allows a nested package AGENTS file when a package needs one", async () => {
    const result = await fixtureTree(async (root) => {
      await mkdir(join(root, "packages/foundation/example/src"), { recursive: true });
      await writeFile(
        join(root, "packages/foundation/example/src/AGENTS.md"),
        "# Local scope\n",
      );
      return undefined;
    });
    expect(result.errors).toEqual([]);
  });

  it("fails when a package README link is broken", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFile(
        join(root, "packages/foundation/example/README.md"),
        packageReadme.replace("authority.md", "missing.md"),
      );
      return undefined;
    });
    expect(hasError(result, "broken package documentation link")).toBe(true);
  });

  it("requires a link to a relevant current knowledge owner", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFile(
        join(root, "packages/foundation/example/README.md"),
        "# Example\n",
      );
      return undefined;
    });
    expect(hasError(result, "relevant current knowledge owner")).toBe(true);
  });

  it("rejects omitted, duplicate, and unknown package index entries", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFile(
        join(root, "packages/INDEX.md"),
        "[missing](./foundation/missing/README.md)\n[example](./foundation/example/README.md)\n[example again](./foundation/example/README.md)\n",
      );
      return undefined;
    });
    expect(hasError(result, "links nonexistent package")).toBe(true);
    expect(hasError(result, "exactly once")).toBe(true);
  });
});
