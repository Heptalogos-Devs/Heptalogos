// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { lstat, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DBOS_PACKAGE_NAME, DBOS_PACKAGE_VERSION } from "../../src/contracts.js";
import {
  resolveDbosPackage,
  resolveDbosPackageFromPackageRoot,
} from "../../src/provider/package.js";

describe("DBOS package resolution", () => {
  it("resolves the installed exact package and package-contained regular CLI", async () => {
    const resolved = resolveDbosPackage();
    expect(resolved.packageName).toBe(DBOS_PACKAGE_NAME);
    expect(resolved.packageVersion).toBe(DBOS_PACKAGE_VERSION);
    expect(resolved.packageRoot).toMatch(/(?:^|[\\/])node_modules[\\/]/u);
    expect(resolved.cliPath.startsWith(resolved.packageRoot)).toBe(true);
    expect((await lstat(resolved.cliPath)).isFile()).toBe(true);
  });

  it.each([
    {
      name: "wrong package name",
      metadata: {
        name: "other-package",
        version: DBOS_PACKAGE_VERSION,
        bin: { dbos: "cli.js" },
      },
      code: "durable.execution.package.invalid_metadata",
    },
    {
      name: "wrong package version",
      metadata: { name: DBOS_PACKAGE_NAME, version: "4.27.5", bin: { dbos: "cli.js" } },
      code: "durable.execution.package.invalid_version",
    },
    {
      name: "missing dbos bin",
      metadata: { name: DBOS_PACKAGE_NAME, version: DBOS_PACKAGE_VERSION, bin: {} },
      code: "durable.execution.package.invalid_cli",
    },
  ])("rejects $name", async ({ metadata, code }) => {
    const packageRoot = await mkdtemp(join(tmpdir(), "heptalogos-dbos-package-"));
    await writeFile(join(packageRoot, "package.json"), JSON.stringify(metadata));
    await writeFile(join(packageRoot, "cli.js"), "export {};\n");

    expect(() => resolveDbosPackageFromPackageRoot(packageRoot)).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({ problemCode: code }),
      }),
    );
  });

  it("rejects a CLI path that escapes the package root or is not a regular file", async () => {
    const packageRoot = await mkdtemp(join(tmpdir(), "heptalogos-dbos-package-"));
    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: DBOS_PACKAGE_NAME,
        version: DBOS_PACKAGE_VERSION,
        bin: { dbos: "../outside.js" },
      }),
    );
    expect(() => resolveDbosPackageFromPackageRoot(packageRoot)).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "durable.execution.package.invalid_cli",
        }),
      }),
    );

    await writeFile(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: DBOS_PACKAGE_NAME,
        version: DBOS_PACKAGE_VERSION,
        bin: { dbos: "cli.js" },
      }),
    );
    await mkdir(join(packageRoot, "cli.js"));
    expect(() => resolveDbosPackageFromPackageRoot(packageRoot)).toThrowError(
      expect.objectContaining({
        problem: expect.objectContaining({
          problemCode: "durable.execution.package.invalid_cli",
        }),
      }),
    );
  });
});
