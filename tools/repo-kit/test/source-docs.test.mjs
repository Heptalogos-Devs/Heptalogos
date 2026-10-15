// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runProcess } from "../src/process.mjs";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));

async function lint(file, input) {
  const result = await runProcess(
    "pnpm",
    [
      "exec",
      "eslint",
      "--no-cache",
      "--format",
      "json",
      "--stdin",
      "--stdin-filename",
      file,
    ],
    { cwd: root, input },
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
    const [missing, duplicate] = await Promise.all([
      lint("tools/repo-kit/src/missing-module.mjs", "export const value = 1;\n"),
      lint(
        "tools/repo-kit/src/duplicate-module.mjs",
        "/**\n * First module description.\n * @module duplicate-module\n */\n/**\n * Second module description.\n * @module duplicate-module\n */\nexport {};\n",
      ),
    ]);
    expect(missing.exitCode).not.toBe(0);
    expect(hasMessage(missing, "Missing @module")).toBe(true);
    expect(duplicate.exitCode).not.toBe(0);
    expect(hasMessage(duplicate, "Duplicate @module")).toBe(true);
  }, 30_000);

  it("requires package entrypoint and exported-contract documentation", async () => {
    const [packageResult, exportResult] = await Promise.all([
      lint("packages/foundation/foundation-contracts/src/index.ts", "export {};\n"),
      lint(
        "tools/repo-kit/src/exported.mjs",
        '/**\n * The probe module owns the exported-contract fixture.\n * @module exported-contract\n */\nimport { join } from "node:path";\nvoid join;\nexport function undocumentedContract() {\n  return "contract";\n}\n',
      ),
    ]);
    expect(packageResult.exitCode).not.toBe(0);
    expect(hasMessage(packageResult, "Missing @packageDocumentation")).toBe(true);
    expect(exportResult.exitCode).not.toBe(0);
    expect(hasMessage(exportResult, "Missing JSDoc comment")).toBe(true);
  }, 30_000);

  it("does not universally require JSDoc for a private local helper", async () => {
    const result = await lint(
      "tools/repo-kit/src/private-helper.mjs",
      '/**\n * The fixture keeps a non-exported helper local to the module.\n * @module private-helper\n */\nfunction privateHelper(value) { return value; }\nvoid privateHelper("value");\n',
    );
    expect(result.exitCode).toBe(0);
    expect(result.messages).toEqual([]);
  }, 30_000);
});
