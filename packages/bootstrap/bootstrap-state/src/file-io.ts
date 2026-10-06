// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Provides the narrow file read/write seam used by BootstrapState stores so
 * filesystem errors are normalized without leaking storage policy to callers.
 * @module file-io
 */

import { readFile } from "node:fs/promises";

/** Checks a Node filesystem error code without assuming an unknown shape. */
export function hasNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

/** Reads an optional text file and treats only ENOENT as absence. */
export async function readOptionalTextFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}
