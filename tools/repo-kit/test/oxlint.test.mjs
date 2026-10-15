// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runProcess } from "../src/process.mjs";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

async function runOxlint(files, config = ".oxlintrc.json") {
  return runProcess(
    "pnpm",
    ["exec", "oxlint", "--type-aware", "--config", config, ...files],
    { cwd: root },
  );
}

async function fixture(relativeDirectory) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "heptalogos-lint-fixture-"));
  const directory = join(temporaryRoot, relativeDirectory);
  await mkdir(directory, { recursive: true });
  for (const config of [".oxlintrc.json", ".oxlintrc-schema-owner.json"])
    await cp(join(root, config), join(temporaryRoot, config));
  await writeFile(
    join(temporaryRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2025",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
      },
      include: ["**/*.ts"],
    }),
  );
  return { temporaryRoot, directory };
}

function outputOf(result) {
  return `${result.stdout}\n${result.stderr}`;
}

describe("Oxlint ownership and type-aware rules", () => {
  it("rejects forbidden schema imports and promise hazards in consumers", async () => {
    const { temporaryRoot, directory } = await fixture(
      "packages/bootstrap/bootstrap-state/src",
    );
    try {
      const ajv = join(directory, "forbidden-ajv.ts");
      const typebox = join(directory, "forbidden-typebox.ts");
      const floating = join(directory, "floating-promise.ts");
      const misused = join(directory, "misused-promise.ts");
      await Promise.all([
        writeFile(ajv, 'import Ajv from "ajv"; export const value = new Ajv();\n'),
        writeFile(
          typebox,
          'import { Type } from "typebox"; export const value = Type.String();\n',
        ),
        writeFile(floating, "async function pending(): Promise<void> {}\npending();\n"),
        writeFile(
          misused,
          "async function callback(): Promise<void> {}\n[1].forEach(callback);\n",
        ),
      ]);

      const results = await Promise.all(
        [ajv, typebox, floating, misused].map((file) =>
          runOxlint([file], join(temporaryRoot, ".oxlintrc-schema-owner.json")),
        ),
      );
      expect(results.every((result) => result.exitCode !== 0)).toBe(true);
      expect(outputOf(results[0])).toMatch(/no-restricted-imports/u);
      expect(outputOf(results[1])).toMatch(/no-restricted-imports/u);
      expect(outputOf(results[2])).toMatch(/no-floating-promises/u);
      expect(outputOf(results[3])).toMatch(/no-misused-promises/u);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("keeps the Nx boundary lane rejecting an invalid package dependency", async () => {
    const result = await runProcess(
      "pnpm",
      [
        "exec",
        "eslint",
        "--no-cache",
        "--stdin",
        "--stdin-filename",
        "packages/foundation/foundation-contracts/src/boundary-probe.ts",
      ],
      {
        cwd: root,
        input:
          'import { MicroSystemSupervisor } from "@heptalogos/runtime-kernel";\nexport const value = MicroSystemSupervisor;\n',
      },
    );
    expect(result.exitCode).not.toBe(0);
    expect(outputOf(result)).toMatch(/enforce-module-boundaries/u);
  }, 30_000);

  it("rejects raw child-process imports outside the repo-kit process owner", async () => {
    const { temporaryRoot, directory } = await fixture("tools/repo-kit/src");
    const file = join(directory, "invalid-process.ts");
    try {
      await writeFile(
        file,
        'import { execFileSync } from "node:child_process"; export const value = execFileSync;\n',
      );
      const result = await runOxlint([file], join(temporaryRoot, ".oxlintrc.json"));
      expect(result.exitCode).not.toBe(0);
      expect(outputOf(result)).toMatch(/no-restricted-imports/u);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
