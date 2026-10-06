// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Materializes the Management client from the ProductHost-owned OpenAPI
 * artifact. The generated output is checked in and is never hand-edited.
 */

import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient as generateClient } from "@hey-api/openapi-ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..", "..");
const generatedRoot = join(packageRoot, "src", "generated");
const checkMode = process.argv.includes("--check");
const inputPath = resolve(
  packageRoot,
  "../product-host/generated/management.openapi.json",
);

const temporaryRoot = await mkdtemp(join(tmpdir(), "heptalogos-management-client-"));
const outputRoot = checkMode ? join(temporaryRoot, "generated") : generatedRoot;
try {
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await generateClient({
    input: inputPath,
    output: {
      path: outputRoot,
      importFileExtension: ".js",
      tsConfigPath: join(packageRoot, "tsconfig.build.json"),
    },
    plugins: ["@hey-api/client-fetch", "@hey-api/typescript", "@hey-api/sdk"],
  });

  if (checkMode) {
    const files = async (root) => {
      const names = [];
      for (const entry of await readdir(root, { withFileTypes: true })) {
        const path = join(root, entry.name);
        if (entry.isDirectory()) names.push(...(await files(path)));
        else names.push(path);
      }
      return names.sort((left, right) => left.localeCompare(right));
    };
    const expected = await files(generatedRoot);
    const actual = await files(outputRoot);
    const relativeNames = (root, paths) =>
      paths.map((path) => relative(root, path)).sort();
    const expectedNames = relativeNames(generatedRoot, expected);
    const actualNames = relativeNames(outputRoot, actual);
    if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) {
      throw new Error("Generated Management client file set is out of date");
    }
    for (let index = 0; index < expected.length; index += 1) {
      const [expectedContent, actualContent] = await Promise.all([
        readFile(expected[index], "utf8"),
        readFile(actual[index], "utf8"),
      ]);
      if (expectedContent !== actualContent) {
        throw new Error(
          "Generated Management client is out of date: " +
            relative(repositoryRoot, expected[index]),
        );
      }
    }
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
