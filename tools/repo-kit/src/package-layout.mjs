// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates the current two-level product-package topology and its durable
 * navigation/boundary invariants without maintaining a package inventory.
 * @module package-layout
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findRepositoryFilesSync } from "./discovery.mjs";
import { isWithinPath, normalizeRepositoryPath } from "./paths.mjs";
import { validatePackageIndex } from "./package-index.mjs";

function packageManifests(repositoryRoot) {
  const packagesRoot = join(repositoryRoot, "packages");
  return findRepositoryFilesSync({
    root: packagesRoot,
    patterns: ["**/package.json"],
    ignore: ["**/node_modules/**", "**/dist/**", "**/.nx/**"],
  }).map((manifestPath) => {
    const relativePath = normalizeRepositoryPath(packagesRoot, manifestPath);
    const segments = relativePath.split("/");
    return { manifestPath, relativePath, segments };
  });
}

function readManifest(manifestPath) {
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { __error: error };
  }
}

function groupErrors(repositoryRoot) {
  const packagesRoot = join(repositoryRoot, "packages");
  if (!existsSync(packagesRoot) || !statSync(packagesRoot).isDirectory()) {
    return ["packages/ is missing"];
  }

  const errors = [];
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const groupDirectory = join(packagesRoot, entry.name);
    if (!existsSync(join(groupDirectory, "README.md"))) {
      errors.push(`packages/${entry.name}/README.md is missing for package group`);
    }
  }
  return errors;
}

function packageEntries(repositoryRoot, errors) {
  const packagesRoot = join(repositoryRoot, "packages");
  const entries = [];
  const names = new Map();
  for (const { manifestPath, relativePath, segments } of packageManifests(
    repositoryRoot,
  )) {
    if (segments.length !== 3 || segments[2] !== "package.json") {
      errors.push(
        `${normalizeRepositoryPath(repositoryRoot, manifestPath)} must be packages/<group>/<package>/package.json`,
      );
      continue;
    }

    const groupName = segments[0];
    const packageName = segments[1];
    const packageDirectory = join(packagesRoot, groupName, packageName);
    const manifest = readManifest(manifestPath);
    if (manifest.__error !== undefined) {
      errors.push(`${relativePath} is not valid JSON: ${manifest.__error.message}`);
      continue;
    }
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      errors.push(`${relativePath} must declare a package name`);
    } else {
      if (!manifest.name.startsWith("@heptalogos/")) {
        errors.push(`${relativePath} package name must remain @heptalogos/*`);
      }
      const previous = names.get(manifest.name);
      if (previous !== undefined) {
        errors.push(
          `package name is not unique: ${manifest.name} in ${previous} and ${relativePath}`,
        );
      } else {
        names.set(manifest.name, relativePath);
      }
    }
    entries.push({
      directory: packageDirectory,
      directoryName: `${groupName}/${packageName}`,
      manifestName: manifest.name,
    });
  }
  return entries;
}

function packageForPath(path, packageRoots) {
  return packageRoots.find(({ directory }) => isWithinPath(directory, path));
}

const IMPORT_PATTERN = /\b(?:from\s*|import\s*\(|require\s*\(\s*)["'](\.[^"']*)["']/gu;

function relativeImportErrors(repositoryRoot, packages) {
  const packagesRoot = join(repositoryRoot, "packages");
  const packageRoots = packages.map(({ directory }) => ({ directory }));
  const errors = [];
  const sourceFiles = findRepositoryFilesSync({
    root: packagesRoot,
    patterns: ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    ignore: ["**/node_modules/**", "**/dist/**", "**/.nx/**", "**/coverage/**"],
  });

  for (const sourcePath of sourceFiles) {
    const currentPackage = packageForPath(sourcePath, packageRoots);
    if (currentPackage === undefined) continue;
    const source = readFileSync(sourcePath, "utf8");
    for (const match of source.matchAll(IMPORT_PATTERN)) {
      const target = resolve(dirname(sourcePath), match[1]);
      const targetPackage = packageForPath(target, packageRoots);
      if (
        targetPackage !== undefined &&
        targetPackage.directory !== currentPackage.directory
      ) {
        errors.push(
          `${normalizeRepositoryPath(repositoryRoot, sourcePath)} crosses package root with relative import: ${match[1]}`,
        );
      }
    }
  }
  return errors;
}

/** Validate the current discoverable package topology and physical boundaries. */
export async function validatePackageLayout({ root = process.cwd() } = {}) {
  const repositoryRoot = resolve(root);
  const errors = [...groupErrors(repositoryRoot)];
  const packages = packageEntries(repositoryRoot, errors);

  if (packages.length === 0) errors.push("packages/ contains no product package");
  errors.push(...relativeImportErrors(repositoryRoot, packages));
  for (const error of await validatePackageIndex({
    root: repositoryRoot,
    productPackages: packages,
  })) {
    errors.push(error);
  }

  return {
    errors: [...new Set(errors)].sort((left, right) => left.localeCompare(right)),
    packages,
  };
}
