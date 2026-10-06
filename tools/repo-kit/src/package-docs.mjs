// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates package README ownership/navigation without imposing a universal
 * heading template or duplicating normative package contracts.
 * @module package-docs
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { markdownTargets } from "./markdown.mjs";
import {
  isWithinPath as isWithin,
  normalizeRepositoryPath as normalize,
} from "./paths.mjs";
import { discoverProductPackages } from "./workspace.mjs";

function packageIndexLinks(packageIndex, packagesRoot) {
  const indexLinks = new Map();
  const unknown = [];
  if (!existsSync(packageIndex) || !statSync(packageIndex).isFile()) {
    return { indexLinks, unknown };
  }

  for (const target of markdownTargets(readFileSync(packageIndex, "utf8"))) {
    const resolvedTarget = resolve(dirname(packageIndex), target);
    if (!isWithin(packagesRoot, resolvedTarget)) continue;
    const packageRelative = normalize(packagesRoot, resolvedTarget).split("/");
    if (packageRelative.length !== 3 || packageRelative[2] !== "README.md") {
      continue;
    }
    const packageName = packageRelative.slice(0, 2).join("/");
    const count = indexLinks.get(packageName) ?? 0;
    indexLinks.set(packageName, count + 1);
    if (!existsSync(resolvedTarget) || !statSync(resolvedTarget).isFile()) {
      unknown.push(packageName);
    }
  }
  return { indexLinks, unknown };
}

function isRelevantKnowledgeLink(repositoryRoot, readme, target) {
  const resolved = resolve(dirname(readme), target);
  if (!isWithin(repositoryRoot, resolved)) return false;
  const relative = normalize(repositoryRoot, resolved);
  return (
    relative.startsWith("docs/architecture/") ||
    relative.startsWith("specs/") ||
    relative.startsWith("project/")
  );
}

/** Validate package README navigation and structural package-index coverage. */
export async function validatePackageDocumentation({
  root = process.cwd(),
  productPackages,
} = {}) {
  const repositoryRoot = resolve(root);
  const packagesRoot = join(repositoryRoot, "packages");
  const errors = [];
  const packages =
    productPackages ?? (await discoverProductPackages({ root: repositoryRoot }));

  for (const relativePath of [
    "packages/README.md",
    "packages/INDEX.md",
    "packages/AGENTS.md",
  ]) {
    const path = join(repositoryRoot, relativePath);
    if (!existsSync(path) || !statSync(path).isFile()) {
      errors.push(relativePath + " is missing");
    }
  }

  const packageIndex = join(packagesRoot, "INDEX.md");
  const { indexLinks, unknown } = packageIndexLinks(packageIndex, packagesRoot);
  for (const packageName of unknown) {
    errors.push("packages/INDEX.md links nonexistent package: " + packageName);
  }

  for (const packageInfo of packages) {
    const readme = join(packageInfo.directory, "README.md");
    if (!existsSync(readme) || !statSync(readme).isFile()) {
      errors.push(
        normalize(repositoryRoot, packageInfo.directory) +
          " package README.md is missing",
      );
    } else {
      const source = readFileSync(readme, "utf8");
      let relevantKnowledgeLinks = 0;
      for (const target of markdownTargets(source)) {
        const resolved = resolve(dirname(readme), target);
        if (!isWithin(repositoryRoot, resolved)) continue;
        if (!existsSync(resolved)) {
          errors.push(
            normalize(repositoryRoot, readme) +
              ": broken package documentation link: " +
              target,
          );
        } else if (isRelevantKnowledgeLink(repositoryRoot, readme, target)) {
          relevantKnowledgeLinks += 1;
        }
      }
      if (relevantKnowledgeLinks === 0) {
        errors.push(
          normalize(repositoryRoot, readme) +
            " must link a relevant current knowledge owner",
        );
      }
    }

    const indexCount = indexLinks.get(packageInfo.directoryName) ?? 0;
    if (indexCount !== 1) {
      errors.push(
        "packages/INDEX.md must link package README exactly once: " +
          packageInfo.manifestName +
          " (found " +
          indexCount +
          ")",
      );
    }
  }

  return { errors, packages };
}
