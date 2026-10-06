// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolves the approved PostgreSQL executable/toolchain placement and rejects
 * ambiguous or unsafe paths before Bootstrap delegates process control.
 * @module toolchain
 */

import { lstat } from "node:fs/promises";
import { isAbsolute as isPosixAbsolute, join as posixJoin } from "node:path/posix";
import { isAbsolute as isWindowsAbsolute, join as windowsJoin } from "node:path/win32";
import {
  createProblemError,
  type Problem,
  ProblemError,
} from "@heptalogos/foundation-contracts";
import {
  PRIVATE_POSTGRES_ARCHITECTURE_MAJOR,
  PRIVATE_POSTGRES_QUALIFIED_VERSION,
  type PrivatePostgresToolchain,
} from "./contracts.js";
import { runPostgresTool } from "./process-adapter.js";
import { hasNodeErrorCode } from "./error-code.js";

// IMPLEMENTATION_CONSTANT: bounded internal version-probe budget; not an installation setting.
const TOOLCHAIN_VERSION_TIMEOUT_MS = 30_000;
const BASE_EXECUTABLE_NAMES = [
  "postgres",
  "initdb",
  "pg_ctl",
  "pg_controldata",
  "pg_isready",
] as const;

/** Names the platform-specific PostgreSQL executables resolved by the adapter. */
export interface PrivatePostgresExecutablePaths {
  readonly postgres: string;
  readonly initdb: string;
  readonly pgCtl: string;
  readonly pgControldata: string;
  readonly pgIsReady: string;
}

/** Reports the parsed major/patch version of a PostgreSQL executable. */
export interface ParsedPostgresVersion {
  readonly major: typeof PRIVATE_POSTGRES_ARCHITECTURE_MAJOR;
  readonly version: typeof PRIVATE_POSTGRES_QUALIFIED_VERSION;
}

function toolchainProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "validation",
  retryClass: Problem["retryClass"] = "manual",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass,
    title,
    detail,
  });
}

function pathApi(platform: NodeJS.Platform): {
  isAbsolute(path: string): boolean;
  join(...paths: string[]): string;
} {
  return platform === "win32"
    ? { isAbsolute: isWindowsAbsolute, join: windowsJoin }
    : { isAbsolute: isPosixAbsolute, join: posixJoin };
}

/** Resolves approved executable names for the current platform. */
export function privatePostgresExecutableNames(
  platform: NodeJS.Platform,
): readonly string[] {
  return platform === "win32"
    ? BASE_EXECUTABLE_NAMES.map((name) => `${name}.exe`)
    : BASE_EXECUTABLE_NAMES;
}

/** Resolves executable paths from an approved PostgreSQL bin directory. */
export function resolvePrivatePostgresExecutablePaths(
  binDirectory: string,
  platform: NodeJS.Platform = process.platform,
): PrivatePostgresExecutablePaths {
  const paths = pathApi(platform);
  if (!paths.isAbsolute(binDirectory)) {
    throw toolchainProblem(
      "private-postgres.toolchain.invalid_bin_directory",
      "PostgreSQL bin directory is not absolute",
      "The private PostgreSQL toolchain must be provided through an absolute bin directory",
    );
  }

  const [postgres, initdb, pgCtl, pgControldata, pgIsReady] =
    privatePostgresExecutableNames(platform).map((name) =>
      paths.join(binDirectory, name),
    );
  return { postgres, initdb, pgCtl, pgControldata, pgIsReady };
}

async function requireRegularTool(path: string, name: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (!entry.isFile()) {
      throw toolchainProblem(
        "private-postgres.toolchain.tool_not_file",
        "PostgreSQL tool is not a regular file",
        `The required PostgreSQL tool ${name} is not a regular file`,
      );
    }
  } catch (error) {
    if (error instanceof ProblemError) throw error;
    if (hasNodeErrorCode(error, "ENOENT")) {
      throw toolchainProblem(
        "private-postgres.toolchain.tool_missing",
        "Required PostgreSQL tool is missing",
        `The required PostgreSQL tool ${name} is not present in the explicit bin directory`,
        "unavailable",
      );
    }
    throw toolchainProblem(
      "private-postgres.toolchain.tool_unreadable",
      "Required PostgreSQL tool could not be inspected",
      `The required PostgreSQL tool ${name} could not be inspected`,
      "unavailable",
    );
  }
}

/** Parses `postgres --version` output into the supported version contract. */
export function parsePostgresVersion(output: string): ParsedPostgresVersion {
  const match = /^\S+\s+\(PostgreSQL\)\s+(\d+)\.(\d+)(?:\s+\([^()\r\n]*\))?\s*$/u.exec(
    output,
  );
  const version = match ? `${match[1]}.${match[2]}` : undefined;
  if (version !== PRIVATE_POSTGRES_QUALIFIED_VERSION) {
    throw toolchainProblem(
      "private-postgres.toolchain.invalid_version",
      "PostgreSQL tool version is not qualified",
      `Every private PostgreSQL tool must report the exact qualified version ${PRIVATE_POSTGRES_QUALIFIED_VERSION}`,
    );
  }
  return Object.freeze({
    major: PRIVATE_POSTGRES_ARCHITECTURE_MAJOR,
    version: PRIVATE_POSTGRES_QUALIFIED_VERSION,
  });
}

/** Resolves and validates the complete private PostgreSQL toolchain. */
export async function resolvePrivatePostgresToolchain(
  binDirectory: string,
): Promise<PrivatePostgresToolchain> {
  const paths = resolvePrivatePostgresExecutablePaths(binDirectory);
  const entries = [
    ["postgres", paths.postgres],
    ["initdb", paths.initdb],
    ["pg_ctl", paths.pgCtl],
    ["pg_controldata", paths.pgControldata],
    ["pg_isready", paths.pgIsReady],
  ] as const;

  for (const [name, path] of entries) await requireRegularTool(path, name);

  for (const [name, path] of entries) {
    const result = await runPostgresTool(path, ["--version"], {
      timeoutMs: TOOLCHAIN_VERSION_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      throw toolchainProblem(
        "private-postgres.toolchain.version_probe_failed",
        "PostgreSQL tool version probe failed",
        `The PostgreSQL tool ${name} did not report its version successfully`,
        "unavailable",
      );
    }
    parsePostgresVersion(result.stdout);
  }

  return Object.freeze({
    version: PRIVATE_POSTGRES_QUALIFIED_VERSION,
    major: PRIVATE_POSTGRES_ARCHITECTURE_MAJOR,
    binDirectory,
    postgres: paths.postgres,
    initdb: paths.initdb,
    pgCtl: paths.pgCtl,
    pgControldata: paths.pgControldata,
    pgIsReady: paths.pgIsReady,
  });
}
