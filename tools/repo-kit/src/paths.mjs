// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Normalizes repository-relative paths and checks containment for tooling that
 * must report or mutate paths without crossing the repository boundary.
 * @module paths
 */

import { isAbsolute, relative, resolve } from "node:path";

/** Normalize an absolute path to the repository's slash-separated relative form. */
export function normalizeRepositoryPath(root, path) {
  return relative(root, path).replaceAll("\\", "/");
}

/** Test containment after resolving both paths, including the root itself. */
export function isWithinPath(root, path) {
  const remainder = relative(resolve(root), resolve(path));
  return remainder === "" || (!remainder.startsWith("..") && !isAbsolute(remainder));
}
