// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Computes the two build-carried generation identities owned by Product Host.
 * Runtime code imports the generated values and never scans the repository.
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultRepositoryRoot = resolve(packageRoot, "../../..");
const defaultOutputPath = resolve(packageRoot, "src/generated/build-identities.ts");
const generatedIdentityPath =
  "packages/application/product-host/src/generated/build-identities.ts";
const rootBuildInputs = new Set([
  "eslint.config.mjs",
  "nx.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "typedoc.json",
  "vitest.config.ts",
]);
const ignoredDirectories = new Set([
  ".codegraph",
  ".git",
  ".nx",
  "coverage",
  "dist",
  "node_modules",
  "tmp",
]);

function normalizePath(root, path) {
  return relative(root, path).split(sep).join("/");
}

function isPackageBuildInput(path) {
  if (!path.startsWith("packages/")) return false;
  if (path === generatedIdentityPath) return false;
  if (path === "packages/application/product-host/src/openclaw.plugin.json")
    return true;
  if (path.includes("/test/") || path.includes("/tests/")) return false;
  if (path.endsWith("/README.md")) return false;
  return (
    path.includes("/src/") ||
    path.endsWith("/package.json") ||
    path.endsWith("/project.json") ||
    /\/tsconfig(?:\.build)?\.json$/u.test(path)
  );
}

function isBootstrapBuildInput(path) {
  if (path.startsWith("packages/bootstrap/bootstrap-runtime/src/")) return true;
  return new Set([
    "packages/bootstrap/bootstrap-runtime/package.json",
    "packages/bootstrap/bootstrap-runtime/project.json",
    "packages/bootstrap/bootstrap-runtime/tsconfig.json",
    "packages/bootstrap/bootstrap-runtime/tsconfig.build.json",
  ]).has(path);
}

async function collectFiles(repositoryRoot, directory, output) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(repositoryRoot, path, output);
      continue;
    }
    if (!entry.isFile()) continue;
    const normalized = normalizePath(repositoryRoot, path);
    if (rootBuildInputs.has(normalized) || isPackageBuildInput(normalized)) {
      output.push(path);
    }
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function entriesFor(repositoryRoot, paths) {
  const sorted = [...paths].sort((left, right) =>
    normalizePath(repositoryRoot, left).localeCompare(
      normalizePath(repositoryRoot, right),
    ),
  );
  return Promise.all(
    sorted.map(async (path) => ({
      path: normalizePath(repositoryRoot, path),
      sha256: sha256(await readFile(path)),
    })),
  );
}

function contentDigest(domain, entries) {
  return sha256(JSON.stringify({ domain, entries }));
}

/** Computes deterministic Product and Bootstrap identities for one source root. */
export async function computeBuildIdentities(repositoryRoot) {
  const resolvedRoot = resolve(repositoryRoot);
  const productPaths = [];
  await collectFiles(resolvedRoot, resolvedRoot, productPaths);
  const productEntries = await entriesFor(resolvedRoot, productPaths);
  const bootstrapEntries = productEntries.filter((entry) =>
    isBootstrapBuildInput(entry.path),
  );
  const subjectEntries = productEntries.filter((entry) =>
    entry.path.startsWith("packages/product/subject/"),
  );
  const sourceContentDigest = contentDigest(
    "heptalogos.product-source/v1",
    productEntries,
  );
  const lockfileSha256 = sha256(
    await readFile(resolve(resolvedRoot, "pnpm-lock.yaml")),
  );
  const productGeneration = sha256(
    JSON.stringify({
      domain: "heptalogos.product-generation/v1",
      schemaVersion: 1,
      product: "heptalogos",
      sourceContentDigest,
      lockfileSha256,
      managementContractVersion: "management.v1",
    }),
  );
  const durableCodeVersion = sha256(
    JSON.stringify({
      domain: "heptalogos.durable-code/v1",
      schemaVersion: 1,
      sourceContentDigest,
    }),
  );
  const bootstrapContentDigest = contentDigest(
    "heptalogos.bootstrap-runtime-source/v1",
    bootstrapEntries,
  );
  const bootstrapRuntimeGeneration = sha256(
    JSON.stringify({
      domain: "heptalogos.bootstrap-runtime-generation/v1",
      schemaVersion: 1,
      package: "@heptalogos/bootstrap-runtime",
      sourceContentDigest: bootstrapContentDigest,
    }),
  );
  const subjectPackageGeneration = sha256(
    JSON.stringify({
      domain: "heptalogos.subject-package-generation/v1",
      schemaVersion: 1,
      package: "@heptalogos/subject",
      sourceContentDigest: contentDigest(
        "heptalogos.subject-package-source/v1",
        subjectEntries,
      ),
    }),
  );
  return Object.freeze({
    productGeneration,
    bootstrapRuntimeGeneration,
    subjectPackageGeneration,
    durableCodeVersion,
  });
}

/** Renders the checked source consumed by the built Product Host. */
export function renderBuildIdentities(identities) {
  return `/**
 * Generated by scripts/build-identities.mjs. Do not edit.
 * @module build-identities
 */
import type {
  PackageGenerationId,
  ProductGenerationId,
} from "@heptalogos/foundation-contracts";
import type { DurableCodeVersion } from "@heptalogos/foundation-contracts";
import type { BootstrapRuntimeGenerationId } from "@heptalogos/bootstrap-state";

/** Product content identity materialized by the build. */
export const PRODUCT_GENERATION_ID = "${identities.productGeneration}" as ProductGenerationId;
/** Bootstrap runtime content identity materialized by the build. */
export const BOOTSTRAP_RUNTIME_GENERATION_ID = "${identities.bootstrapRuntimeGeneration}" as BootstrapRuntimeGenerationId;
/** Subject package content identity used by the generation-pinned Reaction handler. */
export const SUBJECT_PACKAGE_GENERATION_ID = "${identities.subjectPackageGeneration}" as PackageGenerationId;
/** Durable execution code identity projected into DBOS applicationVersion. */
export const DURABLE_CODE_VERSION = "${identities.durableCodeVersion}" as DurableCodeVersion;
`;
}

/** Writes or checks the build-carried identity source. */
export async function materializeBuildIdentities({
  repositoryRoot = defaultRepositoryRoot,
  outputPath = defaultOutputPath,
  check = false,
} = {}) {
  const expected = renderBuildIdentities(await computeBuildIdentities(repositoryRoot));
  if (check) {
    const actual = await readFile(outputPath, "utf8").catch(() => undefined);
    if (actual !== expected) {
      throw new Error("Generated Product Host build identities are out of date");
    }
    return;
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, expected, "utf8");
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        await rename(temporaryPath, outputPath);
        return;
      } catch (error) {
        const actual = await readFile(outputPath, "utf8").catch(() => undefined);
        if (actual === expected) return;
        if (attempt === 7) throw error;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      }
    }
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await materializeBuildIdentities({ check: process.argv.includes("--check") });
}
