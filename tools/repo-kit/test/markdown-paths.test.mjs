// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  firstSectionParagraph,
  markdownLinks,
  markdownTargets,
  section,
} from "../src/markdown.mjs";
import { isWithinPath, normalizeRepositoryPath } from "../src/paths.mjs";

describe("repo-kit Markdown mechanics", () => {
  it("extracts inline and reference links while ignoring fenced examples", () => {
    const source = [
      "[local](<docs/README.md#section>)",
      "[reference][guide]",
      "[remote](https://example.test)",
      "```md",
      "[fenced](ignored.md)",
      "```",
      "[guide]: <docs/guide.md#section>",
    ].join("\n");

    expect(markdownLinks(source, { ignoreFencedCode: true })).toEqual([
      { target: "docs/README.md" },
      { target: "docs/guide.md" },
    ]);
    expect(markdownTargets(source)).toEqual(["docs/README.md", "docs/guide.md"]);
  });

  it("extracts a named section through the Markdown AST", () => {
    expect(section("## Purpose\nfirst\n## Owns\nsecond\n", "Owns")).toBe("\nsecond\n");
    expect(section("# Root\n", "Missing")).toBe("");
    expect(
      firstSectionParagraph(
        "## Purpose\nfirst **value**\n### Child\nchild\n",
        "Purpose",
      ),
    ).toBe("first value");
  });
});

describe("repo-kit path mechanics", () => {
  it("normalizes repository paths and rejects escapes", () => {
    const root = join("C:\\repo", "project");
    const child = join(root, "docs", "README.md");
    expect(normalizeRepositoryPath(root, child)).toBe("docs/README.md");
    expect(isWithinPath(root, child)).toBe(true);
    expect(isWithinPath(root, join(root, "..", "outside.md"))).toBe(false);
  });
});
