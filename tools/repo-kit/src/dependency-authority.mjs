// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads the canonical dependency routing and status Authorities for repository
 * gates without creating a parallel dependency inventory.
 * @module dependency-authority
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const authority = JSON.parse(
  readFileSync(
    join(root, "project", "dependencies", "dependency-routing.json"),
    "utf8",
  ),
);

const routes = new Map();
const packageRoutes = new Map();
for (const route of authority.routes ?? []) {
  if (routes.has(route.roleId)) {
    throw new Error(
      `dependency-routing authority has duplicate roleId: ${route.roleId}`,
    );
  }
  if (!Array.isArray(route.packages)) {
    throw new Error(
      `dependency-routing authority route is missing packages[]: ${route.roleId}`,
    );
  }
  routes.set(route.roleId, route);
  for (const packageName of route.packages) {
    const existingRoute = packageRoutes.get(packageName);
    if (existingRoute === undefined) {
      packageRoutes.set(packageName, route);
      continue;
    }
    if (existingRoute.directive !== route.directive) {
      throw new Error(
        `dependency-routing authority has conflicting directives for package identity: ${packageName}`,
      );
    }
  }
}

const repositoryToolingPackages = new Set(
  authority.repositoryMaterialization?.repositoryToolingPackages ?? [],
);

export { authority, packageRoutes, repositoryToolingPackages, routes };

/** Return the machine-authority route for one dependency identity. */
export function routeForDependency(packageName) {
  return packageRoutes.get(packageName);
}
