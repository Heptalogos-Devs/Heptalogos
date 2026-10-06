// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Generates and verifies the derived API documentation projection from the
 * TypeDoc declaration graph. Temporary output keeps generated Markdown out of
 * the semantic source path while structured reflection remains fail-closed.
 * @module api-docs
 */

import { mkdtemp, rm, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discoverProductPackages,
  findRepositoryFiles,
  isWithinPath,
  resolvePackageTypesEntryPoint,
  runProcessChecked,
  validateApiReflection,
} from "@heptalogos/repo-kit";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const outputDirectory = resolve(root, "docs/reference/api");
const writeMode = process.argv.includes("--write");

function relativeRepositoryPath(path) {
  return relative(root, path).replaceAll("\\", "/");
}

function relativeFrom(directory, path) {
  return relative(directory, path).replaceAll("\\", "/");
}

if (!isWithinPath(root, outputDirectory) || outputDirectory === root) {
  throw new Error(
    `API documentation output escaped the repository: ${outputDirectory}`,
  );
}

async function markdownFiles(directory) {
  return (
    await findRepositoryFiles({
      root: directory,
      patterns: ["**/*.md"],
    })
  )
    .map((path) => relative(directory, path).replaceAll("\\", "/"))
    .sort();
}

async function discoverApiPackages() {
  const productPackages = await discoverProductPackages({ root });
  if (productPackages.length === 0) {
    throw new Error("API documentation requires at least one product package");
  }
  const apiPackages = productPackages.map((packageInfo) => {
    const entryPoint = resolvePackageTypesEntryPoint({ root, packageInfo });
    if (!isWithinPath(root, entryPoint.entryPoint)) {
      throw new Error(
        `API declaration entrypoint escaped the repository: ${entryPoint.repositoryEntryPoint}`,
      );
    }
    return entryPoint;
  });
  const packageNames = new Set();
  for (const packageInfo of apiPackages) {
    if (packageNames.has(packageInfo.packageName)) {
      throw new Error(
        `Duplicate product package in API discovery: ${packageInfo.packageName}`,
      );
    }
    packageNames.add(packageInfo.packageName);
  }
  return apiPackages;
}

async function generate(directory, apiPackages) {
  const temporaryRoot = dirname(directory);
  const prettierIgnore = join(temporaryRoot, "prettier-ignore");
  const tsconfigPath = join(temporaryRoot, "tsconfig.json");
  const reflectionPath = join(temporaryRoot, "typedoc-reflection.json");
  await writeFile(
    tsconfigPath,
    `${JSON.stringify(
      {
        extends: relativeFrom(temporaryRoot, join(root, "tsconfig.base.json")),
        compilerOptions: {
          types: ["node"],
          baseUrl: root,
          ignoreDeprecations: "6.0",
          paths: Object.fromEntries(
            apiPackages.map(({ packageName, entryPoint }) => [
              packageName,
              [relativeRepositoryPath(entryPoint)],
            ]),
          ),
        },
        files: apiPackages.map(({ entryPoint }) =>
          relativeFrom(temporaryRoot, entryPoint),
        ),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await writeFile(prettierIgnore, "", "utf8");
  await runProcessChecked(
    "pnpm",
    [
      "exec",
      "typedoc",
      "--options",
      "typedoc.json",
      "--tsconfig",
      relativeRepositoryPath(tsconfigPath),
      "--entryPoints",
      ...apiPackages.map(({ repositoryEntryPoint }) => repositoryEntryPoint),
      "--out",
      relativeRepositoryPath(directory),
      "--json",
      relativeRepositoryPath(reflectionPath),
    ],
    { cwd: root },
  );
  await runProcessChecked(
    "pnpm",
    ["exec", "prettier", "--write", "--ignore-path", prettierIgnore, directory],
    { cwd: root },
  );
}

const temporaryParent = join(root, "tmp");
await mkdir(temporaryParent, { recursive: true });
const temporaryRoot = await mkdtemp(join(temporaryParent, "api-docs-"));
const temporaryOutput = join(temporaryRoot, "reference");

try {
  await mkdir(temporaryOutput, { recursive: true });
  const apiPackages = await discoverApiPackages();
  await generate(temporaryOutput, apiPackages);

  const reflection = JSON.parse(
    await readFile(join(temporaryRoot, "typedoc-reflection.json"), "utf8"),
  );
  const reflectionErrors = validateApiReflection({
    root,
    packages: apiPackages,
    reflection,
  });
  if (reflectionErrors.length > 0) {
    throw new Error(
      `TypeDoc API reflection is incomplete:\n- ${reflectionErrors.join("\n- ")}`,
    );
  }

  const generatedFiles = await markdownFiles(temporaryOutput);

  if (writeMode) {
    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(dirname(outputDirectory), { recursive: true });
    await cp(temporaryOutput, outputDirectory, { recursive: true });
    console.log(
      `WROTE docs/reference/api (${generatedFiles.length} Markdown files, ${apiPackages.length} product packages)`,
    );
  } else {
    console.log(
      `PASS generated API documentation is valid (${generatedFiles.length} Markdown files, ${apiPackages.length} product packages)`,
    );
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
