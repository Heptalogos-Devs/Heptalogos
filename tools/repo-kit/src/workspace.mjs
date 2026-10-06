// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads workspace package metadata and delegates package-manager inspection to
 * the repo-kit process owner for repository verification commands.
 * @module workspace
 */

import { existsSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { runPnpm } from "./process.mjs";

/** Read all workspace packages through the package-manager owner. */
export async function discoverWorkspacePackages({ cwd = process.cwd() } = {}) {
  const result = await runPnpm(["list", "-r", "--depth", "-1", "--json"], { cwd });
  const entries = JSON.parse(result.stdout);
  if (!Array.isArray(entries)) {
    throw new Error("pnpm recursive package listing did not return an array");
  }
  return entries.map((entry) => ({
    name: entry.name,
    version: entry.version,
    path: entry.path,
    private: entry.private === true,
  }));
}

/** Resolve direct product packages under packages/ from workspace metadata. */
export async function discoverProductPackages({ root = process.cwd() } = {}) {
  const repositoryRoot = resolve(root);
  const packagesRoot = join(repositoryRoot, "packages");
  if (!existsSync(packagesRoot) || !statSync(packagesRoot).isDirectory()) return [];

  const workspacePackages = await discoverWorkspacePackages({ cwd: repositoryRoot });
  return workspacePackages
    .map((workspacePackage) => {
      const directory = resolve(repositoryRoot, workspacePackage.path);
      const directoryName = relative(packagesRoot, directory).replaceAll("\\", "/");
      return { directory, directoryName, workspacePackage };
    })
    .filter(({ directoryName }) => {
      const segments = directoryName.split("/");
      return (
        segments.length === 2 &&
        segments.every((segment) => segment.length > 0) &&
        !directoryName.startsWith("..")
      );
    })
    .map(({ directory, directoryName, workspacePackage }) => {
      if (!existsSync(join(directory, "package.json"))) {
        throw new Error(`packages/${directoryName} is missing package.json`);
      }
      if (
        typeof workspacePackage.name !== "string" ||
        workspacePackage.name.length === 0
      ) {
        throw new Error(`packages/${directoryName}/package.json must declare name`);
      }
      return {
        directory,
        directoryName,
        manifestName: workspacePackage.name,
        workspacePackage,
      };
    })
    .sort((left, right) => left.directoryName.localeCompare(right.directoryName));
}
