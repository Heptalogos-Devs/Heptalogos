// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolves the installed DBOS package and its package-contained CLI without
 * consulting PATH, a global installation, or a package-manager store path.
 * @module package
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
  DBOS_PACKAGE_NAME,
  DBOS_PACKAGE_VERSION,
  type DurableExecutionPackageResolution,
} from "../contracts.js";
import { durableExecutionProblem } from "../problems.js";

const require = createRequire(import.meta.url);

interface PackageMetadata {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly bin?: unknown;
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function readMetadata(packageJsonPath: string): PackageMetadata {
  try {
    return JSON.parse(readFileSync(packageJsonPath, "utf8")) as PackageMetadata;
  } catch (error) {
    throw durableExecutionProblem(
      "durable.execution.package.invalid_metadata",
      "The installed DBOS package.json could not be read as valid metadata",
      error,
    );
  }
}

function packageRootFromEntry(entryPath: string): string {
  if (!isAbsolute(entryPath)) {
    throw durableExecutionProblem(
      "durable.execution.package.invalid_metadata",
      "The DBOS package entry path is not absolute",
    );
  }

  let directory = dirname(entryPath);
  while (true) {
    const packageJsonPath = resolve(directory, "package.json");
    if (existsSync(packageJsonPath)) {
      const metadata = readMetadata(packageJsonPath);
      if (metadata.name !== DBOS_PACKAGE_NAME) {
        throw durableExecutionProblem(
          "durable.execution.package.invalid_metadata",
          "The resolved package metadata has an unexpected package name",
        );
      }
      return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw durableExecutionProblem(
        "durable.execution.package.not_installed",
        "The installed DBOS package root could not be located",
      );
    }
    directory = parent;
  }
}

function binPath(packageRoot: string, metadata: PackageMetadata): string {
  const bin = metadata.bin;
  const configured =
    typeof bin === "object" &&
    bin !== null &&
    !Array.isArray(bin) &&
    "dbos" in bin &&
    typeof bin.dbos === "string"
      ? bin.dbos
      : undefined;
  if (configured === undefined || configured.length === 0) {
    throw durableExecutionProblem(
      "durable.execution.package.invalid_cli",
      "The installed DBOS package does not declare bin.dbos",
    );
  }

  const candidate = resolve(packageRoot, configured);
  const relativePath = relative(packageRoot, candidate);
  if (
    relativePath.length === 0 ||
    isAbsolute(relativePath) ||
    relativePath === ".." ||
    relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw durableExecutionProblem(
      "durable.execution.package.invalid_cli",
      "The DBOS CLI path escapes the installed package root",
    );
  }
  try {
    if (!lstatSync(candidate).isFile()) {
      throw durableExecutionProblem(
        "durable.execution.package.invalid_cli",
        "The installed DBOS CLI is not a regular file",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.name === "ProblemError") throw error;
    if (isNodeErrorWithCode(error, "ENOENT")) {
      throw durableExecutionProblem(
        "durable.execution.package.invalid_cli",
        "The installed DBOS CLI file is missing",
        error,
      );
    }
    throw durableExecutionProblem(
      "durable.execution.package.invalid_cli",
      "The installed DBOS CLI file could not be inspected",
      error,
    );
  }
  return candidate;
}

/** Resolves a package root fixture using the same metadata validation as production. */
export function resolveDbosPackageFromPackageRoot(
  packageRoot: string,
): DurableExecutionPackageResolution {
  if (!isAbsolute(packageRoot)) {
    throw durableExecutionProblem(
      "durable.execution.package.invalid_metadata",
      "The DBOS package root is not absolute",
    );
  }
  const normalizedRoot = resolve(packageRoot);
  const metadata = readMetadata(resolve(normalizedRoot, "package.json"));
  if (metadata.name !== DBOS_PACKAGE_NAME) {
    throw durableExecutionProblem(
      "durable.execution.package.invalid_metadata",
      "The installed DBOS package metadata has an unexpected package name",
    );
  }
  if (metadata.version !== DBOS_PACKAGE_VERSION) {
    throw durableExecutionProblem(
      "durable.execution.package.invalid_version",
      `The installed DBOS package must be exactly ${DBOS_PACKAGE_VERSION}`,
    );
  }
  const cliPath = binPath(normalizedRoot, metadata);
  return Object.freeze({
    packageName: DBOS_PACKAGE_NAME,
    packageVersion: DBOS_PACKAGE_VERSION,
    packageRoot: normalizedRoot,
    cliPath,
  });
}

/** Resolves the installed exact DBOS package through Node package resolution. */
export function resolveDbosPackage(): DurableExecutionPackageResolution {
  let entryPath: string;
  try {
    entryPath = require.resolve(DBOS_PACKAGE_NAME);
  } catch (error) {
    throw durableExecutionProblem(
      "durable.execution.package.not_installed",
      `The installed package ${DBOS_PACKAGE_NAME} could not be resolved`,
      error,
    );
  }
  return resolveDbosPackageFromPackageRoot(packageRootFromEntry(entryPath));
}
