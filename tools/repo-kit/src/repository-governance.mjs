// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads current repository governance projections and discovers maintained
 * responsibility roots without freezing a snapshot inventory.
 * @module repository-governance
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { markdownTargets } from "./markdown.mjs";

const TRANSIENT_ROOTS = new Set([
  ".codegraph",
  ".git",
  ".nx",
  ".pnpm-store",
  ".superpowers",
  ".vite",
  ".cache",
  ".worktrees",
  "coverage",
  "dist",
  "node_modules",
  "test-results",
  "tmp",
]);

const GLOBAL_INDEX = "INDEX.md";
const CURRENT_REPOSITORY_PACKAGE_NAME = "heptalogos";
const CURRENT_MACHINE_AUTHORITIES = Object.freeze([
  {
    id: "compatibility-obligations",
    kind: "EXECUTABLE_MACHINE_AUTHORITY",
    path: "project/governance/compatibility-obligations.json",
  },
  {
    id: "dependency-routing",
    kind: "EXECUTABLE_MACHINE_AUTHORITY",
    path: "project/dependencies/dependency-routing.json",
  },
  {
    id: "dependency-status",
    kind: "EXECUTABLE_MACHINE_AUTHORITY",
    path: "project/qualification/dependency-status.json",
  },
]);

/** Discover maintained top-level responsibility directories from the tree. */
export function discoverResponsibilityRoots({ root = process.cwd() } = {}) {
  const repositoryRoot = resolve(root);
  if (!existsSync(repositoryRoot) || !statSync(repositoryRoot).isDirectory()) {
    return [];
  }
  return readdirSync(repositoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !TRANSIENT_ROOTS.has(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function rootForTarget(repositoryRoot, target) {
  const resolved = resolve(repositoryRoot, target);
  const relative = resolved
    .slice(repositoryRoot.length)
    .replaceAll("\\", "/")
    .replace(/^\/+/u, "");
  return relative.split("/")[0] ?? "";
}

function rootIndexTargets(repositoryRoot) {
  const indexPath = join(repositoryRoot, GLOBAL_INDEX);
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) return [];
  return markdownTargets(readFileSync(indexPath, "utf8"));
}

/**
 * Validate global navigation coverage for every maintained root.
 *
 * Root names are discovered from the current tree. Adding a legitimate
 * responsibility root therefore requires navigation, not an allow-list edit.
 */
export function validateRootTopology({ root = process.cwd() } = {}) {
  const repositoryRoot = resolve(root);
  const errors = [];
  const indexPath = join(repositoryRoot, GLOBAL_INDEX);
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    return [
      GLOBAL_INDEX + " is missing; it must cover maintained responsibility roots",
    ];
  }

  const roots = discoverResponsibilityRoots({ root: repositoryRoot });
  const coveredRoots = new Set(
    rootIndexTargets(repositoryRoot).map((target) =>
      rootForTarget(repositoryRoot, target),
    ),
  );
  for (const name of roots) {
    if (!coveredRoots.has(name)) {
      errors.push(
        GLOBAL_INDEX + " must link a maintained responsibility root: " + name,
      );
    }
  }
  return errors;
}

/** Validate the private root package identity used by repository tooling. */
export function validateRootPackageIdentity({ root = process.cwd() } = {}) {
  const repositoryRoot = resolve(root);
  const packagePath = join(repositoryRoot, "package.json");
  if (!existsSync(packagePath) || !statSync(packagePath).isFile()) {
    return [
      "root package.json is missing; current repository identity cannot be verified",
    ];
  }

  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch (error) {
    return ["root package.json is unreadable: " + error.message];
  }

  const errors = [];
  if (packageJson.private !== true) {
    errors.push("root package.json must remain private");
  }
  if (packageJson.name !== CURRENT_REPOSITORY_PACKAGE_NAME) {
    errors.push(
      "root package.json name must equal the current repository identity " +
        CURRENT_REPOSITORY_PACKAGE_NAME +
        "; got " +
        JSON.stringify(packageJson.name),
    );
  }
  return errors;
}

export {
  CURRENT_REPOSITORY_PACKAGE_NAME,
  CURRENT_MACHINE_AUTHORITIES,
  TRANSIENT_ROOTS,
};
