// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plans and performs fail-closed cleanup of configured generated outputs while
 * refusing symlink escapes and unknown directory material.
 * @module clean
 */

import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findRepositoryFilesSync } from "./discovery.mjs";
import {
  isWithinPath as isWithin,
  normalizeRepositoryPath as normalized,
} from "./paths.mjs";

const GENERATED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".nx",
  ".vite",
  "coverage",
  "dist",
  "test-results",
]);
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read repository configuration ${path}: ${error.message}`);
  }
}

function rootGeneratedNames(root) {
  const path = join(root, ".gitignore");
  if (!existsSync(path)) return [];
  const configured = new Set();
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/u)) {
    const line = rawLine.trim();
    const match = line.match(/^\/?([^/]+)\/$/u);
    if (match && GENERATED_DIRECTORY_NAMES.has(match[1])) {
      configured.add(match[1]);
    }
  }
  return [...configured];
}

function configFiles(root) {
  return findRepositoryFilesSync({
    root,
    patterns: ["**/project.json", "**/tsconfig*.json"],
    ignore: [
      ".git/**",
      ".codegraph/**",
      ".nx/**",
      ".pnpm-store/**",
      ".vite/**",
      ".cache/**",
      "coverage/**",
      "dist/**",
      "node_modules/**",
      "test-results/**",
      "tmp/**",
    ],
  });
}

function configuredOutputs(root) {
  const targets = [];
  for (const path of configFiles(root)) {
    const config = readJson(path);
    const directory = dirname(path);
    const compilerOptions = config.compilerOptions ?? {};
    for (const value of [compilerOptions.outDir, compilerOptions.tsBuildInfoFile]) {
      if (typeof value === "string" && value.trim() !== "") {
        targets.push(resolve(directory, value));
      }
    }

    for (const target of Object.values(config.targets ?? {})) {
      for (const output of target?.outputs ?? []) {
        if (typeof output !== "string" || output.trim() === "") continue;
        const resolved = output
          .replaceAll("{projectRoot}", ".")
          .replaceAll("{workspaceRoot}", root);
        targets.push(resolve(directory, resolved));
      }
    }
  }
  return targets;
}

function knownResidue(name) {
  return (
    GENERATED_DIRECTORY_NAMES.has(name) ||
    name.endsWith(".tsbuildinfo") ||
    name.endsWith(".tmp")
  );
}

function orphanPackageTargets(root) {
  const packagesRoot = join(root, "packages");
  if (!existsSync(packagesRoot) || !lstatSync(packagesRoot).isDirectory()) return [];
  const targets = [];
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const directory = join(packagesRoot, entry.name);
    if (existsSync(join(directory, "package.json"))) continue;
    const children = readdirSync(directory, { withFileTypes: true });
    if (
      children.some(
        (child) =>
          child.isDirectory() &&
          !child.isSymbolicLink() &&
          existsSync(join(directory, child.name, "package.json")),
      )
    ) {
      continue;
    }
    const unknown = children.filter((child) => !knownResidue(child.name));
    if (unknown.length > 0) {
      throw new Error(
        `${normalized(root, directory)} contains unknown file or directory: ${unknown
          .map((entry) => entry.name)
          .join(", ")}`,
      );
    }
    targets.push(directory);
  }
  return targets;
}

function existingAncestor(path) {
  let candidate = path;
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return candidate;
    candidate = parent;
  }
  return candidate;
}

function assertSafeTarget(rootPath, rootReal, target) {
  const candidate = resolve(target);
  if (!isWithin(rootPath, candidate) || candidate === rootPath) {
    throw new Error(`clean target is outside repository: ${candidate}`);
  }

  const ancestor = existingAncestor(candidate);
  const ancestorReal = realpathSync.native(ancestor);
  if (!isWithin(rootReal, ancestorReal)) {
    throw new Error(`clean target has an ancestor outside repository: ${candidate}`);
  }

  if (existsSync(candidate)) {
    const stat = lstatSync(candidate);
    if (stat.isSymbolicLink()) {
      throw new Error(`clean target is a symlink: ${candidate}`);
    }
    const targetReal = realpathSync.native(candidate);
    if (!isWithin(rootReal, targetReal)) {
      throw new Error(`clean target symlink escapes repository: ${candidate}`);
    }
  }
}

function compactTargets(root, targets) {
  const unique = [...new Set(targets.map((target) => resolve(target)))].sort(
    (left, right) => left.length - right.length || left.localeCompare(right),
  );
  const compact = [];
  for (const target of unique) {
    if (!compact.some((parent) => isWithin(parent, target))) compact.push(target);
  }
  return compact.sort((left, right) =>
    normalized(root, left).localeCompare(normalized(root, right)),
  );
}

/** Discover validated generated-output targets without mutating the repository. */
export function discoverCleanPlan({ root = process.cwd() } = {}) {
  const repositoryRoot = resolve(root);
  if (!existsSync(repositoryRoot) || !lstatSync(repositoryRoot).isDirectory()) {
    throw new Error(`repository root is missing: ${repositoryRoot}`);
  }
  const rootReal = realpathSync.native(repositoryRoot);
  const targets = configuredOutputs(repositoryRoot);
  for (const name of rootGeneratedNames(repositoryRoot)) {
    targets.push(join(repositoryRoot, name));
  }
  targets.push(...orphanPackageTargets(repositoryRoot));

  const compact = compactTargets(repositoryRoot, targets);
  for (const target of compact) assertSafeTarget(repositoryRoot, rootReal, target);
  return { root: repositoryRoot, targets: compact };
}

/** Remove exactly the targets returned by the fail-closed cleanup plan. */
export function cleanRepository({ root = process.cwd(), dryRun = false } = {}) {
  const plan = discoverCleanPlan({ root });
  if (dryRun) return { ...plan, removed: [] };

  const removed = [];
  for (const target of plan.targets) {
    if (!existsSync(target)) continue;
    rmSync(target, { recursive: true, force: true });
    removed.push(target);
  }
  return { ...plan, removed };
}
