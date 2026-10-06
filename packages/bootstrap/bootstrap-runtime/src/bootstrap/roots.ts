// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Resolves the canonical Bootstrap path profile and lifecycle roots so every
 * store and journal uses the same installation-scoped filesystem topology.
 * @module roots
 */

import { lstat, realpath } from "node:fs/promises";
import {
  createProblemError,
  type ProblemError,
  type InstallationId,
  type InstanceId,
  type LifecycleRootId,
} from "@heptalogos/foundation-contracts";
import type { BootstrapLocatorV1 } from "./locator.js";
import { hasNodeErrorCode } from "../shared/error-code.js";

/** Holds one canonicalized lifecycle root and its configured source path. */
export interface ResolvedLifecycleRoot {
  readonly id: LifecycleRootId;
  readonly configuredPath: string;
  readonly canonicalPath: string;
}

/** Provides the identity-scoped lifecycle root lookup used by Bootstrap stores. */
export interface BootstrapPathProfile {
  readonly installationId: InstallationId;
  readonly instanceId: InstanceId;
  /** Returns the canonical path for a required lifecycle root. */
  resolve(root: LifecycleRootId): ResolvedLifecycleRoot;
  /** Returns all roots resolved for the current Bootstrap operation. */
  list(): readonly ResolvedLifecycleRoot[];
}

function rootProblem(problemCode: string, title: string, detail: string): ProblemError {
  return createProblemError({
    problemCode,
    category: "integrity",
    retryClass: "manual",
    title,
    detail,
  });
}

async function resolveRoot(
  id: LifecycleRootId,
  configuredPath: string,
): Promise<ResolvedLifecycleRoot> {
  let entry: Awaited<ReturnType<typeof lstat>>;
  try {
    entry = await lstat(configuredPath);
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) {
      throw rootProblem(
        "bootstrap.root.not_found",
        "Bootstrap lifecycle root is missing",
        `Configured lifecycle root ${id} does not exist`,
      );
    }
    throw rootProblem(
      "bootstrap.root.realpath_failed",
      "Bootstrap lifecycle root could not be inspected",
      `Configured lifecycle root ${id} could not be inspected`,
    );
  }

  if (entry.isSymbolicLink()) {
    throw rootProblem(
      "bootstrap.root.link_rejected",
      "Bootstrap lifecycle root link is not accepted",
      `Configured lifecycle root ${id} must not be a terminal symlink or junction`,
    );
  }
  if (!entry.isDirectory()) {
    throw rootProblem(
      "bootstrap.root.not_directory",
      "Bootstrap lifecycle root is not a directory",
      `Configured lifecycle root ${id} is not a directory`,
    );
  }

  let canonicalPath: string;
  try {
    canonicalPath = await realpath(configuredPath);
  } catch {
    throw rootProblem(
      "bootstrap.root.realpath_failed",
      "Bootstrap lifecycle root could not be canonicalized",
      `Configured lifecycle root ${id} could not be canonicalized`,
    );
  }

  // Bootstrap state verifies the configured terminal entry only. Parent-component TOCTOU and
  // every Windows reparse-point class remain platform-qualification boundaries.
  return { id, configuredPath, canonicalPath };
}

/** Resolves and validates the lifecycle roots required by Bootstrap. */
export async function resolveBootstrapPathProfile(
  locator: BootstrapLocatorV1,
  requiredRoots: readonly LifecycleRootId[],
): Promise<BootstrapPathProfile> {
  if (requiredRoots.length === 0) {
    throw rootProblem(
      "bootstrap.root.empty_requirement",
      "At least one bootstrap lifecycle root is required",
      "Bootstrap path resolution must declare the lifecycle roots needed by the caller",
    );
  }
  const uniqueRequiredRoots = [...new Set(requiredRoots)];
  const resolvedRoots = await Promise.all(
    uniqueRequiredRoots.map((id) => resolveRoot(id, locator.roots[id])),
  );
  const roots = Object.freeze([...resolvedRoots]);
  const byId = new Map(roots.map((root) => [root.id, root]));

  return {
    installationId: locator.installationId,
    instanceId: locator.instanceId,
    resolve(root: LifecycleRootId): ResolvedLifecycleRoot {
      const resolved = byId.get(root);
      if (!resolved) {
        throw rootProblem(
          "bootstrap.root.not_resolved",
          "Bootstrap lifecycle root is not available",
          `Lifecycle root ${root} is not available in the bootstrap path profile`,
        );
      }
      return resolved;
    },
    list(): readonly ResolvedLifecycleRoot[] {
      return roots;
    },
  };
}
