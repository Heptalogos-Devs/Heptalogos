// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { validateKnowledge } from "../src/knowledge.mjs";

const tick = String.fromCharCode(96);

async function writeFixtureFile(root, relativePath, source) {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
}

async function fixtureTree(setup) {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-knowledge-"));
  const tick = String.fromCharCode(96);
  try {
    const files = [
      ["README.md", "# Repository\n"],
      [
        "INDEX.md",
        [
          "# Index",
          "",
          "[Agents](./.agents/skills/AGENTS.md)",
          "[Docs](./docs/README.md)",
          "[Packages](./packages/README.md)",
          "[Project](./project/README.md)",
          "[Specs](./specs/README.md)",
          "",
        ].join("\n"),
      ],
      ["AGENTS.md", "# Agents\n"],
      ["docs/README.md", "# Human Knowledge\n"],
      [
        "docs/INDEX.md",
        [
          "# Docs",
          "",
          "[Product](product/product.md)",
          "[Architecture](architecture/README.md)",
          "[Reference](reference/glossary.md)",
          "",
        ].join("\n"),
      ],
      ["docs/AGENTS.md", "# Docs Agents\n"],
      ["docs/product/product.md", "# Product\n"],
      ["docs/architecture/README.md", "# Architecture\n"],
      ["docs/architecture/INDEX.md", "[System](system.md)\n"],
      ["docs/architecture/system.md", "# System\n"],
      ["docs/reference/glossary.md", "# Glossary\n"],
      ["specs/README.md", "# Specs\n"],
      [
        "specs/INDEX.md",
        [
          "# Specs",
          "",
          "| Spec | Read when | Contract | Owner | Prefix |",
          "| --- | --- | --- | --- | --- |",
          "| [Example](./core/example.md) | Example changes | Example contract | owner | " +
            tick +
            "EX" +
            tick +
            " |",
          "",
        ].join("\n"),
      ],
      ["specs/AGENTS.md", "# Specs Agents\n"],
      ["specs/core/example.md", "# Example\n\n- EX-001 current rule\n"],
      ["project/README.md", "# Project\n"],
      [
        "project/INDEX.md",
        [
          "# Project",
          "",
          "[Governance](governance/constitution.md)",
          "[Dependencies](dependencies/README.md)",
          "[Engineering](engineering/README.md)",
          "[Plans](plans/README.md)",
          "[Qualification](qualification/README.md)",
          "[Roadmap](roadmap/README.md)",
          "",
        ].join("\n"),
      ],
      ["project/AGENTS.md", "# Project Agents\n"],
      ["project/governance/constitution.md", "# Governance\n"],
      ["project/governance/compatibility-obligations.json", "{}\n"],
      ["project/dependencies/README.md", "# Dependencies\n"],
      ["project/dependencies/dependency-routing.json", "{}\n"],
      ["project/engineering/README.md", "# Engineering\n"],
      ["project/plans/README.md", "# Plans\n"],
      ["project/plans/INDEX.md", "# Plan index\n"],
      ["project/qualification/README.md", "# Qualification\n"],
      ["project/qualification/dependency-status.json", "{}\n"],
      ["project/roadmap/README.md", "# Roadmap\n"],
      ["packages/README.md", "# Packages\n"],
      ["packages/INDEX.md", "# Package index\n"],
      ["packages/AGENTS.md", "# Package Agents\n"],
      [".agents/skills/AGENTS.md", "# Skills\n"],
    ];
    for (const [relativePath, source] of files) {
      await writeFixtureFile(root, relativePath, source);
    }
    await setup(root);
    return validateKnowledge({ root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function hasCode(result, code) {
  return result.errors.some((error) => error.code === code);
}

describe("repository knowledge topology", () => {
  it("accepts a complete four-plane knowledge graph", async () => {
    const result = await fixtureTree(async () => {});
    expect(result.errors).toEqual([]);
  });

  it("resolves a canonical machine Authority path from the repository root", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(
        root,
        "project/governance/current.md",
        "project/governance/compatibility-obligations.json\n",
      );
    });
    expect(result.errors).toEqual([]);
  });

  it("keeps an ordinary Authority filename reference source-relative", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(
        root,
        "project/governance/current.md",
        "compatibility-obligations.json\n",
      );
    });
    expect(result.errors).toEqual([]);
  });

  it("resolves a newly discovered responsibility root without an allow-list edit", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(root, "temporary-owner/README.md", "# Temporary owner\n");
      await writeFixtureFile(
        root,
        "INDEX.md",
        [
          "# Index",
          "",
          "[Agents](./.agents/skills/AGENTS.md)",
          "[Docs](./docs/README.md)",
          "[Packages](./packages/README.md)",
          "[Project](./project/README.md)",
          "[Specs](./specs/README.md)",
          "[Temporary](./temporary-owner/README.md)",
          "",
        ].join("\n"),
      );
      await writeFixtureFile(
        root,
        "project/governance/current.md",
        "temporary-owner/compatibility-obligations.json\n",
      );
    });
    const error = result.errors.find(
      ({ code }) => code === "noncanonical-authority-reference",
    );
    expect(error?.message).toContain(
      "resolves to temporary-owner/compatibility-obligations.json",
    );
  });

  it("rejects an Authority document link that escapes the repository", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(
        root,
        "project/governance/current.md",
        "[outside](../../../outside.md)\n",
      );
    });
    expect(hasCode(result, "link-outside-repository")).toBe(true);
  });

  it("validates current links and root index coverage", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(
        root,
        "docs/product/product.md",
        "[missing](missing.md)\n",
      );
      await mkdir(join(root, "new-responsibility"), { recursive: true });
    });
    expect(hasCode(result, "broken-current-link")).toBe(true);
    expect(hasCode(result, "unindexed-responsibility-root")).toBe(true);
  });

  it("does not treat generated API output as current knowledge", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(
        root,
        "docs/reference/api/generated.md",
        "[missing](missing.md)\n",
      );
    });
    expect(result.errors).toEqual([]);
  });

  it("discovers a new responsibility root when the global index covers it", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(
        root,
        "new-responsibility/README.md",
        "# New responsibility\n",
      );
      await writeFixtureFile(
        root,
        "INDEX.md",
        [
          "# Index",
          "",
          "[Agents](./.agents/skills/AGENTS.md)",
          "[Docs](./docs/README.md)",
          "[Packages](./packages/README.md)",
          "[Project](./project/README.md)",
          "[Specs](./specs/README.md)",
          "[New](./new-responsibility/README.md)",
          "",
        ].join("\n"),
      );
    });
    expect(result.errors).toEqual([]);
  });

  it("retains exact validation for duplicate Spec prefixes and requirement IDs", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(
        root,
        "specs/core/other.md",
        "# Other\n\n- EX-001 duplicate\n",
      );
      await writeFixtureFile(
        root,
        "specs/INDEX.md",
        [
          "# Specs",
          "",
          "| Spec | Read when | Contract | Owner | Prefix |",
          "| --- | --- | --- | --- | --- |",
          "| [Example](./core/example.md) | Example | Contract | owner | " +
            tick +
            "EX" +
            tick +
            " |",
          "| [Other](./core/other.md) | Other | Contract | owner | " +
            tick +
            "EX" +
            tick +
            " |",
          "",
        ].join("\n"),
      );
    });
    expect(hasCode(result, "duplicate-spec-prefix")).toBe(true);
    expect(hasCode(result, "duplicate-spec-requirement-id")).toBe(true);
  });

  it("allows nested AGENTS when no generic path rule forbids it", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(root, "docs/architecture/detail/AGENTS.md", "# Detail\n");
    });
    expect(result.errors).toEqual([]);
  });

  it("allows old routes as historical Plan text without a current stub", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(
        root,
        "project/plans/completed/history.md",
        "Historical route: docs/specs/old.md\n",
      );
    });
    expect(result.errors).toEqual([]);
  });

  it("rejects translation sidecars in the current tree", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(root, "docs/product/product.zh.md", "# Translation\n");
    });
    expect(hasCode(result, "translation-disabled")).toBe(true);
  });

  it("rejects a noncanonical current machine Authority reference", async () => {
    const result = await fixtureTree(async (root) => {
      await writeFixtureFile(
        root,
        "project/governance/current.md",
        "[compatibility](../wrong/compatibility-obligations.json)\n",
      );
    });
    expect(hasCode(result, "noncanonical-authority-reference")).toBe(true);
  });
});
