// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates the deliberate package retrieval projection without generating or
 * comparing explanatory README prose.
 * @module package-index
 */

/* jscpd:ignore-start */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { markdownTargets } from "./markdown.mjs";
import {
  isWithinPath as isWithin,
  normalizeRepositoryPath as normalize,
} from "./paths.mjs";
import { discoverProductPackages } from "./workspace.mjs";
/* jscpd:ignore-end */

/** Validate structural package-index coverage against current workspace packages. */
export async function validatePackageIndex({
  root = process.cwd(),
  text,
  productPackages,
} = {}) {
  const repositoryRoot = resolve(root);
  const packagesRoot = join(repositoryRoot, "packages");
  const packageIndex = join(packagesRoot, "INDEX.md");
  const packages =
    productPackages ?? (await discoverProductPackages({ root: repositoryRoot }));
  const knownPackages = new Set(packages.map(({ directoryName }) => directoryName));
  const counts = new Map();
  const errors = [];

  if (!existsSync(packageIndex) || !statSync(packageIndex).isFile()) {
    return ["packages/INDEX.md is missing"];
  }

  const source = text ?? readFileSync(packageIndex, "utf8");
  for (const target of markdownTargets(source)) {
    const resolvedTarget = resolve(dirname(packageIndex), target);
    if (!isWithin(packagesRoot, resolvedTarget)) continue;
    const relativeTarget = normalize(packagesRoot, resolvedTarget).split("/");
    if (relativeTarget.length !== 3 || relativeTarget[2] !== "README.md") {
      continue;
    }
    const packageName = relativeTarget.slice(0, 2).join("/");
    counts.set(packageName, (counts.get(packageName) ?? 0) + 1);
    if (!knownPackages.has(packageName)) {
      errors.push("packages/INDEX.md links nonexistent package: " + packageName);
    } else if (!existsSync(resolvedTarget) || !statSync(resolvedTarget).isFile()) {
      errors.push("packages/INDEX.md package README link does not resolve: " + target);
    }
  }

  for (const packageName of knownPackages) {
    const count = counts.get(packageName) ?? 0;
    if (count !== 1) {
      errors.push(
        "packages/INDEX.md must link package README exactly once: " +
          packageName +
          " (found " +
          count +
          ")",
      );
    }
  }
  return errors.sort((left, right) => left.localeCompare(right));
}
