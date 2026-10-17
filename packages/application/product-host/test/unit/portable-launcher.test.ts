// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

it("delegates portable initialization to the installed product and preserves CLI stdin", async () => {
  // Node resolves the launcher module through macOS temporary-directory aliases.
  root = await realpath(await mkdtemp(join(tmpdir(), "heptalogos-portable-launcher-")));
  const generation = "a".repeat(64);
  const product = join(root, "program", "product", generation);
  const bin = join(root, "bin");
  await mkdir(join(product, "cli"), { recursive: true });
  await mkdir(bin);
  await writeFile(join(root, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(
    join(root, "manifest.json"),
    JSON.stringify({ productGeneration: generation }),
  );
  await copyFile(
    resolve("scripts/package/portable-launcher.mjs"),
    join(bin, "portable-launcher.mjs"),
  );
  await writeFile(
    join(product, "installation.js"),
    `
    import { writeFile } from 'node:fs/promises';
    import { join } from 'node:path';
    export async function initializeProductInstallation(root) {
      await writeFile(join(root, 'initialized-by-product'), root);
    }
  `,
  );
  await writeFile(
    join(product, "cli", "bin.js"),
    `
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), input }));
  `,
  );
  const result = await new Promise<{
    code: number | null;
    output: string;
    error: string;
  }>((done, reject) => {
    const child = spawn(process.execPath, [
      join(bin, "portable-launcher.mjs"),
      "auth",
      "login",
      "--stdin",
    ]);
    let output = "";
    let error = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      error += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => done({ code, output, error }));
    child.stdin.end("private-test-input\n");
  });
  expect(result.error).toBe("");
  expect(result.code).toBe(0);
  expect(JSON.parse(result.output)).toEqual({
    argv: ["auth", "login", "--stdin", "--anchor-root", root],
    input: "private-test-input\n",
  });
  expect(await readFile(join(root, "initialized-by-product"), "utf8")).toBe(root);
});
