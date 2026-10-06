// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runProcess } from "../src/process.mjs";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

async function lint(file) {
  const relativePath = relative(root, file).replaceAll("\\", "/");
  const result = await runProcess(
    "pnpm",
    ["exec", "eslint", "--no-cache", "--format", "json", relativePath],
    { cwd: root },
  );
  return {
    ...result,
    messages: result.stdout === "" ? [] : JSON.parse(result.stdout)[0].messages,
  };
}

function hasMessage(result, text) {
  return result.messages.some((message) => message.message.includes(text));
}

describe("source documentation enforcement", () => {
  it("rejects missing and duplicate file headers", async () => {
    const directory = await mkdtemp(
      join(root, "tools", "repo-kit", "src", "jsdoc-probe-"),
    );
    const missingModule = join(directory, "missing-module.mjs");
    const duplicateModule = join(directory, "duplicate-module.mjs");
    try {
      await writeFile(missingModule, "export const value = 1;\n");
      await writeFile(
        duplicateModule,
        "/**\n * First module description.\n * @module duplicate-module\n */\n/**\n * Second module description.\n * @module duplicate-module\n */\nexport {};\n",
      );
      const [missing, duplicate] = await Promise.all([
        lint(missingModule),
        lint(duplicateModule),
      ]);
      expect(missing.exitCode).not.toBe(0);
      expect(hasMessage(missing, "Missing @module")).toBe(true);
      expect(duplicate.exitCode).not.toBe(0);
      expect(hasMessage(duplicate, "Duplicate @module")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it("requires package entrypoint and exported-contract documentation", async () => {
    const directory = await mkdtemp(
      join(root, "packages", "foundation", "jsdoc-probe-"),
    );
    const toolsDirectory = await mkdtemp(
      join(root, "tools", "repo-kit", "src", "jsdoc-probe-"),
    );
    const packageConfig = join(directory, "tsconfig.json");
    const missingPackage = join(directory, "src", "index.ts");
    const missingExport = join(toolsDirectory, "exported.mjs");
    try {
      await mkdir(join(directory, "src"), { recursive: true });
      await writeFile(
        packageConfig,
        '{"extends":"../foundation-contracts/tsconfig.json","include":["src/**/*.ts"]}\n',
      );
      await writeFile(missingPackage, "export {};\n");
      await writeFile(
        missingExport,
        '/**\n * The probe module owns the exported-contract fixture.\n * @module exported-contract\n */\nimport { join } from "node:path";\nvoid join;\nexport function undocumentedContract() {\n  return "contract";\n}\n',
      );
      const [packageResult, exportResult] = await Promise.all([
        lint(missingPackage),
        lint(missingExport),
      ]);
      expect(packageResult.exitCode).not.toBe(0);
      expect(hasMessage(packageResult, "Missing @packageDocumentation")).toBe(true);
      expect(exportResult.exitCode).not.toBe(0);
      expect(hasMessage(exportResult, "Missing JSDoc comment")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(toolsDirectory, { recursive: true, force: true });
    }
  }, 30_000);

  it("does not universally require JSDoc for a private local helper", async () => {
    const directory = await mkdtemp(
      join(root, "tools", "repo-kit", "src", "jsdoc-probe-"),
    );
    const file = join(directory, "private-helper.mjs");
    try {
      await writeFile(
        file,
        '/**\n * The fixture keeps a non-exported helper local to the module.\n * @module private-helper\n */\nfunction privateHelper(value) { return value; }\nvoid privateHelper("value");\n',
      );
      const result = await lint(file);
      expect(result.exitCode).toBe(0);
      expect(result.messages).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
