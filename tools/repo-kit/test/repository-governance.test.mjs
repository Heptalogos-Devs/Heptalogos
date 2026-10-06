// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  findSourceTestFiles,
  validateVerifyWorkflow,
} from "../../../scripts/verify/repository.mjs";
import {
  CURRENT_MACHINE_AUTHORITIES,
  discoverResponsibilityRoots,
  validateRootPackageIdentity,
  validateRootTopology,
} from "../src/repository-governance.mjs";

function workflowFixture(actionRef) {
  return [
    "name: verify-manual",
    "",
    "on:",
    "  workflow_dispatch:",
    "    inputs:",
    "      revision:",
    "        required: false",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  verify:",
    "    name: verify ($" + "{{ matrix.os }})",
    "    runs-on: $" + "{{ matrix.os }}",
    "    strategy:",
    "      matrix:",
    "        os: [ubuntu-latest, macos-latest, windows-latest]",
    "    steps:",
    "      - uses: actions/checkout@" + actionRef,
    "        with:",
    "          ref: $" + "{{ inputs.revision || github.sha }}",
    "      - run: pnpm install --frozen-lockfile",
    "      - run: pnpm verify",
    "",
  ].join("\n");
}

describe("repository governance", () => {
  it("requires the private root workspace to use the repository identity", async () => {
    const root = await mkdtemp(join(tmpdir(), "heptalogos-root-identity-"));
    try {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "heptalogos-clean-room", private: true }),
      );
      expect(validateRootPackageIdentity({ root })).toEqual([
        expect.stringContaining("current repository identity"),
      ]);
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "heptalogos", private: true }),
      );
      expect(validateRootPackageIdentity({ root })).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("finds product package tests that remain under src", async () => {
    const root = await mkdtemp(join(tmpdir(), "heptalogos-repository-governance-"));
    try {
      const source = join(root, "packages", "example", "src");
      await mkdir(source, { recursive: true });
      const testPath = join(source, "left-behind.test.ts");
      await writeFile(testPath, "export {}\n");
      expect(
        await findSourceTestFiles({
          root,
          productPackages: [
            {
              directory: join(root, "packages", "example"),
              directoryName: "example",
              manifestName: "@heptalogos/example",
              workspacePackage: {
                name: "@heptalogos/example",
                path: join(root, "packages/example"),
              },
            },
          ],
        }),
      ).toEqual([testPath]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("discovers responsibility roots and requires global index coverage", async () => {
    const root = await mkdtemp(join(tmpdir(), "heptalogos-root-topology-"));
    try {
      const roots = [
        ".agents",
        ".github",
        "docs",
        "packages",
        "project",
        "scripts",
        "specs",
        "tests",
        "tools",
      ];
      for (const directory of roots) {
        await mkdir(join(root, directory), { recursive: true });
      }
      await writeFile(
        join(root, "INDEX.md"),
        roots.map((name) => "[" + name + "](./" + name + "/)").join("\n"),
      );
      expect(discoverResponsibilityRoots({ root })).toEqual(roots);
      await mkdir(join(root, "apps"), { recursive: true });
      expect(validateRootTopology({ root })).toEqual([expect.stringContaining("apps")]);
      await writeFile(
        join(root, "INDEX.md"),
        roots
          .concat("apps")
          .map((name) => "[" + name + "](./" + name + "/)")
          .join("\n"),
      );
      expect(validateRootTopology({ root })).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses only current machine Authority homes", () => {
    expect(CURRENT_MACHINE_AUTHORITIES).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "compatibility-obligations",
          path: "project/governance/compatibility-obligations.json",
        }),
        expect.objectContaining({
          id: "dependency-routing",
          path: "project/dependencies/dependency-routing.json",
        }),
        expect.objectContaining({
          id: "dependency-status",
          path: "project/qualification/dependency-status.json",
        }),
      ]),
    );
  });

  it("accepts a manually dispatched selected-revision workflow", () => {
    expect(
      validateVerifyWorkflow(
        workflowFixture("0123456789abcdef0123456789abcdef01234567"),
      ),
    ).toEqual([]);
  });

  it("rejects an unpinned action", () => {
    expect(validateVerifyWorkflow(workflowFixture("main"))).toContain(
      "GitHub Action must be pinned to a full commit SHA: actions/checkout@main",
    );
  });

  it.each([
    "push",
    "pull_request",
    "pull_request_target",
    "schedule",
    "repository_dispatch",
    "merge_group",
    "workflow_call",
  ])("rejects a %s trigger", (trigger) => {
    const workflow = workflowFixture(
      "0123456789abcdef0123456789abcdef01234567",
    ).replace(
      "  workflow_dispatch:\n",
      "  " + trigger + ": {}\n  workflow_dispatch:\n",
    );
    expect(validateVerifyWorkflow(workflow)).toContain(
      "verify workflow must not auto-trigger via " + trigger,
    );
  });
});
