// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolves public package declaration entrypoints and validates the structured
 * TypeDoc module set before generated API Markdown is accepted.
 * @module api-docs
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isWithinPath, normalizeRepositoryPath } from "./paths.mjs";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sourcePath(root, fileName) {
  if (typeof fileName !== "string" || fileName.length === 0) return undefined;
  const absolutePath = resolve(root, fileName);
  if (!isWithinPath(root, absolutePath)) return undefined;
  return normalizeRepositoryPath(root, absolutePath);
}

function reflectionChildren(reflection) {
  return reflection && Array.isArray(reflection.children)
    ? reflection.children
    : undefined;
}

/** Resolve the declaration selected by a product package's public export map. */
export function resolvePackageTypesEntryPoint({
  root = process.cwd(),
  packageInfo,
} = {}) {
  if (
    !packageInfo ||
    typeof packageInfo.directory !== "string" ||
    typeof packageInfo.manifestName !== "string"
  ) {
    throw new TypeError("packageInfo must contain directory and manifestName");
  }

  const repositoryRoot = resolve(root);
  const packageDirectory = resolve(packageInfo.directory);
  const manifestPath = join(packageDirectory, "package.json");
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) {
    throw new Error(
      `${normalizeRepositoryPath(repositoryRoot, packageDirectory)} is missing package.json`,
    );
  }

  const manifest = readJson(manifestPath);
  if (manifest.name !== packageInfo.manifestName) {
    throw new Error(
      `${normalizeRepositoryPath(repositoryRoot, manifestPath)} name does not match workspace discovery: ${packageInfo.manifestName}`,
    );
  }

  const packageExport =
    manifest.exports &&
    typeof manifest.exports === "object" &&
    !Array.isArray(manifest.exports)
      ? manifest.exports["."]
      : undefined;
  const typesPath =
    packageExport && typeof packageExport === "object" && !Array.isArray(packageExport)
      ? packageExport.types
      : undefined;
  if (typeof typesPath !== "string" || typesPath.length === 0) {
    throw new Error(
      `${normalizeRepositoryPath(repositoryRoot, manifestPath)} must declare exports["."].types`,
    );
  }
  if (!typesPath.startsWith("./")) {
    throw new Error(
      `${normalizeRepositoryPath(repositoryRoot, manifestPath)} exports["."].types must be package-relative: ${typesPath}`,
    );
  }

  const entryPoint = resolve(packageDirectory, typesPath);
  if (!isWithinPath(packageDirectory, entryPoint)) {
    throw new Error(
      `${normalizeRepositoryPath(repositoryRoot, manifestPath)} exports["."].types escapes the package: ${typesPath}`,
    );
  }
  if (!existsSync(entryPoint) || !statSync(entryPoint).isFile()) {
    throw new Error(
      `${normalizeRepositoryPath(repositoryRoot, entryPoint)} selected by exports["."].types does not exist`,
    );
  }

  return {
    packageName: manifest.name,
    directoryName: packageInfo.directoryName,
    entryPoint,
    repositoryEntryPoint: normalizeRepositoryPath(repositoryRoot, entryPoint),
  };
}

/** Validate the expected product set against TypeDoc's structured reflection. */
export function validateApiReflection({
  root = process.cwd(),
  packages,
  reflection,
} = {}) {
  if (!Array.isArray(packages) || packages.length === 0) {
    return ["API documentation requires a non-empty expected product package set"];
  }

  const errors = [];
  const expectedByPath = new Map();
  const expectedNames = new Set();
  for (const packageInfo of packages) {
    if (
      !packageInfo ||
      typeof packageInfo.packageName !== "string" ||
      typeof packageInfo.repositoryEntryPoint !== "string"
    ) {
      errors.push("API documentation expected package entries are malformed");
      continue;
    }
    if (expectedNames.has(packageInfo.packageName)) {
      errors.push(`Duplicate expected API package: ${packageInfo.packageName}`);
    }
    expectedNames.add(packageInfo.packageName);
    if (expectedByPath.has(packageInfo.repositoryEntryPoint)) {
      errors.push(
        `Duplicate expected API declaration entrypoint: ${packageInfo.repositoryEntryPoint}`,
      );
    }
    expectedByPath.set(packageInfo.repositoryEntryPoint, packageInfo);
  }

  const children = reflectionChildren(reflection);
  if (children === undefined) {
    return [...new Set([...errors, "TypeDoc reflection has no top-level children"])];
  }
  if (children.length !== packages.length) {
    errors.push(
      `TypeDoc reflection package count differs from product discovery: expected ${packages.length}, actual ${children.length}`,
    );
  }

  const matchedChildren = new Set();
  for (const packageInfo of packages) {
    if (
      !packageInfo ||
      typeof packageInfo.packageName !== "string" ||
      typeof packageInfo.repositoryEntryPoint !== "string"
    ) {
      continue;
    }
    const matches = children.filter((child) =>
      Array.isArray(child?.sources)
        ? child.sources.some(
            (source) =>
              sourcePath(root, source?.fileName) === packageInfo.repositoryEntryPoint,
          )
        : false,
    );
    if (matches.length === 0) {
      errors.push(
        `TypeDoc reflection is missing product package ${packageInfo.packageName} (${packageInfo.repositoryEntryPoint})`,
      );
    } else if (matches.length > 1) {
      errors.push(
        `TypeDoc reflection contains multiple top-level modules for ${packageInfo.packageName}`,
      );
    }
    for (const match of matches) matchedChildren.add(match);
  }

  for (const child of children) {
    if (!matchedChildren.has(child)) {
      errors.push(
        `TypeDoc reflection contains an unexpected top-level module: ${String(child?.name ?? "<unnamed>")}`,
      );
    }
  }

  return [...new Set(errors)];
}
