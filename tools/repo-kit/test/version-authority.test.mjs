// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  readPackageManagerBaseline,
  readNodeVersionProjections,
  readWorkspaceCatalog,
  readWorkspaceSection,
  STANDING_DEPENDENCY_DOCUMENTS,
  validateStandingDependencyDocuments,
  validateNodeVersionProjections,
  validateVersionAuthority,
  resolveExpectedInstalledPackageVersions,
} from "../src/version-authority.mjs";

async function fixtureTree(setup) {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-version-authority-"));
  try {
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@11.22.0",
        engines: { node: "24.19.0" },
      }),
    );
    await writeFile(
      join(root, "pnpm-workspace.yaml"),
      [
        "catalog:",
        "  nx: 23.1.1",
        '  "@typescript/native": "npm:typescript@7.0.2"',
        '  typescript: "npm:@typescript/typescript6@6.0.2"',
        "  vitest: 4.1.11",
        "allowBuilds:",
        "  nx: true",
        "overrides:",
        '  "@types/node": 24.13.3',
      ].join("\n"),
    );
    return await setup(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeRoutingAuthority(root) {
  const workspacePath = join(root, "pnpm-workspace.yaml");
  const workspace = await readFile(workspacePath, "utf8");
  await writeFile(
    workspacePath,
    workspace.replace(
      "allowBuilds:",
      '  "@bybrave/proper-lockfile2": 5.0.0\nallowBuilds:',
    ),
  );
  await mkdir(join(root, "project/dependencies"), { recursive: true });
  await writeFile(
    join(root, "project/dependencies/dependency-routing.json"),
    JSON.stringify({
      schemaVersion: 4,
      routes: [
        {
          roleId: "runtime.node",
          versionConstraint: { major: 24 },
          packages: [],
        },
        {
          roleId: "tooling.build",
          packageManagerConstraint: { name: "pnpm", major: 11 },
          packages: [],
        },
        {
          roleId: "bootstrap.lock",
          versionConstraint: { major: 5 },
          packages: ["@bybrave/proper-lockfile2"],
        },
      ],
    }),
  );
}

describe("repository version Authorities", () => {
  it("reads the exact Node and package-manager baseline from package.json", async () => {
    await fixtureTree(async (root) => {
      expect(readPackageManagerBaseline({ root })).toEqual({
        node: "24.19.0",
        packageManager: "pnpm@11.22.0",
        packageManagerName: "pnpm",
        packageManagerVersion: "11.22.0",
      });
    });
  });

  it("requires Node version-manager projections to match package.json", async () => {
    await fixtureTree(async (root) => {
      await writeFile(join(root, ".node-version"), "24.19.0\n");
      await writeFile(join(root, ".nvmrc"), "24.19.0\n");
      expect(readNodeVersionProjections({ root })).toEqual({
        ".node-version": "24.19.0",
        ".nvmrc": "24.19.0",
      });
      expect(validateNodeVersionProjections({ root })).toEqual([]);

      await writeFile(join(root, ".nvmrc"), "24.19.1\n");
      expect(validateNodeVersionProjections({ root })).toEqual([
        ".nvmrc must match package.json engines.node (24.19.0); got 24.19.1",
      ]);
    });
  });

  it("reads catalog values without confusing aliases with installed versions", async () => {
    await fixtureTree(async (root) => {
      expect(readWorkspaceCatalog({ root })).toEqual({
        nx: "23.1.1",
        "@typescript/native": "npm:typescript@7.0.2",
        typescript: "npm:@typescript/typescript6@6.0.2",
        vitest: "4.1.11",
      });
      expect(readWorkspaceSection({ root, section: "overrides" })).toEqual({
        "@types/node": "24.13.3",
      });
      expect(
        resolveExpectedInstalledPackageVersions({
          root,
          packageNames: ["nx", "@typescript/native", "typescript"],
        }),
      ).toEqual({
        nx: "23.1.1",
        "@typescript/native": "7.0.2",
        typescript: "6.0.2",
      });
    });
  });

  it("checks exact Node and Catalog selections against machine-readable route lines", async () => {
    await fixtureTree(async (root) => {
      await writeRoutingAuthority(root);
      expect(
        validateVersionAuthority({
          root,
          dependencyRouting: JSON.parse(
            await readFile(
              join(root, "project/dependencies/dependency-routing.json"),
              "utf8",
            ),
          ),
        }),
      ).toEqual([]);

      const workspacePath = join(root, "pnpm-workspace.yaml");
      const workspace = await readFile(workspacePath, "utf8");
      await writeFile(
        workspacePath,
        workspace.replace(
          '"@bybrave/proper-lockfile2": 5.0.0',
          '"@bybrave/proper-lockfile2": 6.0.0',
        ),
      );
      expect(validateVersionAuthority({ root })).toEqual([
        expect.stringContaining(
          "@bybrave/proper-lockfile2 6.0.0 is outside the adopted bootstrap.lock line",
        ),
      ]);
    });
  });

  it("rejects a runtime Node selection outside the adopted Node line", async () => {
    await fixtureTree(async (root) => {
      await writeRoutingAuthority(root);
      const packagePath = join(root, "package.json");
      const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
      packageJson.engines.node = "25.0.0";
      await writeFile(packagePath, JSON.stringify(packageJson));
      expect(validateVersionAuthority({ root })).toEqual([
        expect.stringContaining(
          "package.json engines.node 25.0.0 is outside the adopted runtime.node line",
        ),
      ]);
    });
  });

  it("validates package-manager identity and adopted major", async () => {
    await fixtureTree(async (root) => {
      await writeRoutingAuthority(root);
      expect(validateVersionAuthority({ root })).toEqual([]);

      const packagePath = join(root, "package.json");
      const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
      packageJson.packageManager = "npm@11.24.0";
      await writeFile(packagePath, JSON.stringify(packageJson));
      expect(validateVersionAuthority({ root })).toEqual([
        expect.stringContaining("must use pnpm"),
      ]);

      packageJson.packageManager = "pnpm@12.0.0";
      await writeFile(packagePath, JSON.stringify(packageJson));
      expect(validateVersionAuthority({ root })).toEqual([
        expect.stringContaining("outside the adopted package-manager line"),
      ]);

      packageJson.packageManager = "pnpm@11.24";
      await writeFile(packagePath, JSON.stringify(packageJson));
      expect(validateVersionAuthority({ root })).toEqual([
        expect.stringContaining("exact semver"),
      ]);
    });
  });

  it("rejects any copied exact routed package pin, not only the current Catalog patch", async () => {
    await fixtureTree(async (root) => {
      await writeRoutingAuthority(root);
      await mkdir(join(root, "project/qualification/results"), { recursive: true });
      for (const relativePath of STANDING_DEPENDENCY_DOCUMENTS) {
        const path = join(root, relativePath);
        await mkdir(join(path, ".."), { recursive: true });
        await writeFile(path, "");
      }
      await writeFile(
        join(root, "project/dependencies/implementation-routing.md"),
        "@bybrave/proper-lockfile2@5.0.1\n",
      );
      await writeFile(
        join(root, "project/qualification/results/exercised.md"),
        "exercised @bybrave/proper-lockfile2@5.0.0\n",
      );

      expect(
        validateStandingDependencyDocuments({
          root,
          packageNames: ["@bybrave/proper-lockfile2"],
        }),
      ).toEqual([
        expect.stringContaining(
          "@bybrave/proper-lockfile2 (5.0.1) must remain in the pnpm-workspace.yaml Catalog",
        ),
      ]);
    });
  });
});
