// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanCurrentTree } from "../src/current-tree-hygiene.mjs";

async function fixtureTree(setup) {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-hygiene-"));
  try {
    await mkdir(join(root, "project/governance"), { recursive: true });
    await writeFile(
      join(root, "project/governance/compatibility-obligations.json"),
      JSON.stringify({
        schemaVersion: 1,
        compatibilityEpoch: "PRE_PRODUCTION",
        obligations: [],
      }),
    );
    const configuredTrackedPaths = await setup(root);
    const trackedPaths = configuredTrackedPaths ?? [
      "project/governance/compatibility-obligations.json",
    ];
    return scanCurrentTree({ root, trackedPaths });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function hasCode(result, code) {
  return result.findings.some((finding) => finding.code === code);
}

describe("current-tree hygiene scanner", () => {
  it("rejects milestone identity in a current test filename", async () => {
    const result = await fixtureTree(async (root) => {
      await mkdir(join(root, "packages/example"), { recursive: true });
      await writeFile(
        join(root, "packages/example/h2a3-fixture.test.ts"),
        "export {};\n",
      );
      return ["packages/example/h2a3-fixture.test.ts"];
    });

    expect(hasCode(result, "development-provenance")).toBe(true);
  });

  it("rejects milestone, PR, session, and corrective-cycle identity in executable content", async () => {
    const result = await fixtureTree(async (root) => {
      await mkdir(join(root, "scripts/checks"), { recursive: true });
      const path = join(root, "scripts/checks/current.mjs");
      await writeFile(
        path,
        "const marker = 'P4'; const review = 'PR #24'; const session = 'session 7';\n",
      );
      return ["scripts/checks/current.mjs"];
    });

    expect(hasCode(result, "development-provenance")).toBe(true);
  });

  it("does not police ordinary compatibility prose or markdown history", async () => {
    const result = await fixtureTree(async (root) => {
      await mkdir(join(root, "packages/example"), { recursive: true });
      const source = join(root, "packages/example/current.ts");
      const readme = join(root, "packages/example/legacy-notes.md");
      await writeFile(
        source,
        "export const text = 'legacy obsolete previous schema';\n",
      );
      await writeFile(readme, "PR #24 and H2B are historical notes.\n");
      return ["packages/example/current.ts", "packages/example/legacy-notes.md"];
    });

    expect(result.findings).toEqual([]);
  });

  it("does not scan an untracked current-looking path", async () => {
    const result = await fixtureTree(async (root) => {
      await mkdir(join(root, "packages/example"), { recursive: true });
      await writeFile(
        join(root, "packages/example/h2a3-untracked.ts"),
        "const marker = 'PR #24';\n",
      );
      return ["project/governance/compatibility-obligations.json"];
    });

    expect(result.findings).toEqual([]);
  });

  it("requires a well-shaped compatibility register", async () => {
    const root = await mkdtemp(join(tmpdir(), "heptalogos-hygiene-register-"));
    try {
      const missing = scanCurrentTree({ root, trackedPaths: [] });
      expect(hasCode(missing, "compatibility-register")).toBe(true);

      await mkdir(join(root, "project/governance"), { recursive: true });
      await writeFile(
        join(root, "project/governance/compatibility-obligations.json"),
        JSON.stringify({
          schemaVersion: 1,
          compatibilityEpoch: "PRE_PRODUCTION",
          obligations: [{ id: "external-consumer" }],
        }),
      );
      const declared = scanCurrentTree({
        root,
        trackedPaths: ["project/governance/compatibility-obligations.json"],
      });
      expect(declared.findings).toEqual([]);

      await writeFile(
        join(root, "project/governance/compatibility-obligations.json"),
        JSON.stringify({
          schemaVersion: 1,
          compatibilityEpoch: "PRODUCTION",
          obligations: [],
        }),
      );
      const wrongEpoch = scanCurrentTree({
        root,
        trackedPaths: ["project/governance/compatibility-obligations.json"],
      });
      expect(hasCode(wrongEpoch, "compatibility-register")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes a history-neutral current tree", async () => {
    const result = await fixtureTree(async (root) => {
      await mkdir(join(root, "packages/example"), { recursive: true });
      await writeFile(
        join(root, "packages/example/host-maintenance.test.ts"),
        "export const resource = 'host-maintenance';\n",
      );
      return [
        "packages/example/host-maintenance.test.ts",
        "project/governance/compatibility-obligations.json",
      ];
    });

    expect(result.findings).toEqual([]);
  });
});
