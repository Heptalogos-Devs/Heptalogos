// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Classifies the installation-owned PostgreSQL directory layout with fail-closed
 * traversal so unknown material cannot be mistaken for managed cluster state.
 * @module cluster-layout
 */

import { lstat, opendir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";
import {
  PRIVATE_POSTGRES_DATA_LAYOUT_VERSION,
  PRIVATE_POSTGRES_RELATIVE_DATA_PATH,
  type PrivatePostgresPlacement,
} from "./contracts.js";
import { hasNodeErrorCode } from "./error-code.js";

/** Classifies whether the managed data directory is absent, empty, or occupied. */
export type ClusterDirectoryState =
  | { readonly kind: "ABSENT" }
  | { readonly kind: "EMPTY" }
  | { readonly kind: "NON_EMPTY"; readonly entryCountLowerBound: number };

function layoutProblem(
  problemCode: string,
  title: string,
  detail: string,
  category: Problem["category"] = "validation",
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "manual",
    title,
    detail,
  });
}

/** Resolves the canonical private cluster directory below DATA. */
export function resolvePrivatePostgresPlacement(
  dataRoot: string,
): PrivatePostgresPlacement {
  if (!isAbsolute(dataRoot)) {
    throw layoutProblem(
      "private-postgres.layout.invalid_data_root",
      "Private PostgreSQL DATA root is not absolute",
      "The private PostgreSQL DATA root must be an absolute canonical lifecycle root",
    );
  }

  const canonicalDataRoot = resolve(dataRoot);
  const canonicalDataDirectory = resolve(
    canonicalDataRoot,
    PRIVATE_POSTGRES_RELATIVE_DATA_PATH,
  );
  const childRelativePath = relative(canonicalDataRoot, canonicalDataDirectory);
  if (
    childRelativePath !== PRIVATE_POSTGRES_RELATIVE_DATA_PATH ||
    childRelativePath.startsWith("..") ||
    isAbsolute(childRelativePath)
  ) {
    throw layoutProblem(
      "private-postgres.layout.escape",
      "Private PostgreSQL placement escapes DATA",
      "The private PostgreSQL placement must remain under the logical DATA root",
      "integrity",
    );
  }

  return Object.freeze({
    rootId: "DATA",
    relativePath: PRIVATE_POSTGRES_RELATIVE_DATA_PATH,
    dataLayoutVersion: PRIVATE_POSTGRES_DATA_LAYOUT_VERSION,
    canonicalDataDirectory,
  });
}

/** Enumerates the target directory with bounded fail-closed semantics. */
export async function classifyClusterDirectory(
  directory: string,
): Promise<ClusterDirectoryState> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(directory);
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) return { kind: "ABSENT" };
    throw layoutProblem(
      "private-postgres.layout.inspect_failed",
      "Private PostgreSQL target could not be inspected",
      "The private PostgreSQL target directory could not be inspected",
      "unavailable",
    );
  }

  if (!entry.isDirectory()) {
    throw layoutProblem(
      "private-postgres.layout.not_directory",
      "Private PostgreSQL target is not a directory",
      "The private PostgreSQL target must be a directory or absent",
    );
  }

  let handle: Awaited<ReturnType<typeof opendir>> | undefined;
  try {
    handle = await opendir(directory);
    const firstEntry = await handle.read();
    return firstEntry === null
      ? { kind: "EMPTY" }
      : { kind: "NON_EMPTY", entryCountLowerBound: 1 };
  } catch {
    throw layoutProblem(
      "private-postgres.layout.inspect_failed",
      "Private PostgreSQL target could not be enumerated",
      "The private PostgreSQL target directory could not be enumerated",
      "unavailable",
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
