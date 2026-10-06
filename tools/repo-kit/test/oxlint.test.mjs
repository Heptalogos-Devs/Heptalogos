// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runProcess } from "../src/process.mjs";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

async function runOxlint(files, config = ".oxlintrc.json") {
  return runProcess(
    "pnpm",
    [
      "exec",
      "oxlint",
      "--type-aware",
      "--config",
      config,
      ...files.map((file) => relative(root, file)),
    ],
    { cwd: root },
  );
}

function outputOf(result) {
  return `${result.stdout}\n${result.stderr}`;
}

describe("Oxlint ownership and type-aware rules", () => {
  it("rejects forbidden schema imports and promise hazards in consumers", async () => {
    const directory = await mkdtemp(
      join(root, "packages", "bootstrap", "bootstrap-state", "src", "oxlint-probe-"),
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
          runOxlint([file], ".oxlintrc-schema-owner.json"),
        ),
      );
      expect(results.every((result) => result.exitCode !== 0)).toBe(true);
      expect(outputOf(results[0])).toMatch(/no-restricted-imports/u);
      expect(outputOf(results[1])).toMatch(/no-restricted-imports/u);
      expect(outputOf(results[2])).toMatch(/no-floating-promises/u);
      expect(outputOf(results[3])).toMatch(/no-misused-promises/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the Nx boundary lane rejecting an invalid package dependency", async () => {
    const directory = await mkdtemp(
      join(
        root,
        "packages",
        "foundation",
        "foundation-contracts",
        "src",
        "eslint-probe-",
      ),
    );
    const file = join(directory, "invalid-boundary.ts");
    try {
      await writeFile(
        file,
        'import { MicroSystemSupervisor } from "@heptalogos/runtime-kernel";\nexport const value = MicroSystemSupervisor;\n',
      );
      const result = await runProcess(
        "pnpm",
        ["exec", "eslint", "--no-cache", relative(root, file)],
        { cwd: root },
      );
      expect(result.exitCode).not.toBe(0);
      expect(outputOf(result)).toMatch(/enforce-module-boundaries/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("rejects raw child-process imports outside the repo-kit process owner", async () => {
    const directory = await mkdtemp(
      join(root, "tools", "repo-kit", "src", "oxlint-process-probe-"),
    );
    const file = join(directory, "invalid-process.ts");
    try {
      await writeFile(
        file,
        'import { execFileSync } from "node:child_process"; export const value = execFileSync;\n',
      );
      const result = await runOxlint([file]);
      expect(result.exitCode).not.toBe(0);
      expect(outputOf(result)).toMatch(/no-restricted-imports/u);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
