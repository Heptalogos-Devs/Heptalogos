// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Verifies dependency declarations, roles, and import restrictions against the
 * repository dependency Authorities rather than maintaining a second graph.
 * @module dependencies
 */

import { builtinModules } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  authority,
  discoverWorkspacePackages,
  packageRoutes,
  readPackageManagerBaseline,
  readYamlFile,
  readWorkspaceCatalog,
  readWorkspaceSection,
  routes,
  validateStandingDependencyDocuments,
  validateVersionAuthority,
} from "@heptalogos/repo-kit";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const workspacePath = join(root, "pnpm-workspace.yaml");
let workspaceDocument;
try {
  workspaceDocument = readYamlFile(workspacePath);
} catch (error) {
  fail(`workspace YAML Authority is unreadable: ${error.message}`);
  workspaceDocument = {};
}
const qualificationStatusPath = join(
  root,
  "project",
  "qualification",
  "dependency-status.json",
);
const errors = [];
const nodeBuiltinNames = new Set([
  ...builtinModules,
  ...builtinModules
    .filter((name) => !name.startsWith("node:"))
    .map((name) => `node:${name}`),
]);
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

let workspaceCatalog = {};
let workspaceOverrides = {};
let packageManagerBaseline;
try {
  workspaceCatalog = readWorkspaceCatalog({ root });
} catch (error) {
  fail(`workspace catalog Authority is unreadable: ${error.message}`);
}
try {
  workspaceOverrides = readWorkspaceSection({ root, section: "overrides" });
} catch (error) {
  fail(`workspace overrides Authority is unreadable: ${error.message}`);
}
try {
  packageManagerBaseline = readPackageManagerBaseline({ root });
} catch (error) {
  fail(`package manager Authority is unreadable: ${error.message}`);
}

function fail(message) {
  errors.push(message);
}

let qualificationStatus;
try {
  qualificationStatus = JSON.parse(readFileSync(qualificationStatusPath, "utf8"));
} catch (error) {
  fail(`dependency qualification Authority is unreadable: ${error.message}`);
}

const roleDecisionValues = new Set(qualificationStatus?.roleDecisionValues ?? []);
const qualificationDecisions = new Map();
if (!Array.isArray(qualificationStatus?.decisions)) {
  fail("dependency qualification Authority must declare decisions[]");
} else {
  for (const decision of qualificationStatus.decisions) {
    if (typeof decision?.id !== "string" || qualificationDecisions.has(decision.id)) {
      fail(
        "dependency qualification Authority contains a duplicate or invalid decision id",
      );
      continue;
    }
    qualificationDecisions.set(decision.id, decision);
    if (!roleDecisionValues.has(decision.roleDecision)) {
      fail(
        `dependency qualification Authority has invalid roleDecision: ${decision.id}`,
      );
    }
  }
}

for (const roleId of ["runtime.node", "tooling.build", "testing.foundation"]) {
  const route = routes.get(roleId);
  if (!route) fail(`dependency route missing: ${roleId}`);
  else if (route.directive !== "USE") {
    fail(`required dependency route is not adopted for use: ${roleId}`);
  }
}

for (const roleId of routes.keys()) {
  if (!qualificationDecisions.has(roleId)) {
    fail(`dependency route has no qualification decision: ${roleId}`);
  }
}

const materialization = authority.repositoryMaterialization;
if (materialization?.catalogMode !== "strict") {
  fail("dependency routing requires strict catalog mode");
}
if (
  materialization?.packageReferences !==
  "workspace package.json uses catalog: references; pnpm-lock.yaml owns exact resolved closure"
) {
  fail("dependency routing package reference policy is not present");
}
if (!materialization?.packageIdentity?.includes("routes[].packages")) {
  fail("dependency routing package identity authority is not present");
}
const minimumReleaseAge = materialization?.minimumReleaseAge;
if (!Number.isInteger(minimumReleaseAge) || minimumReleaseAge < 0) {
  fail("dependency routing minimumReleaseAge must be a non-negative integer");
}

const workspacePackages = await discoverWorkspacePackages({ cwd: root });
const packageManifests = workspacePackages.map(({ path }) =>
  join(path, "package.json"),
);
const manifests = [];
const workspacePackageNames = new Set();
for (const manifestPath of packageManifests) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifests.push({ manifest, path: manifestPath });
  if (typeof manifest.name === "string" && manifest.name.length > 0) {
    workspacePackageNames.add(manifest.name);
  } else if (manifestPath !== join(root, "package.json")) {
    fail(`${manifestPath}: workspace package manifest must declare name`);
  }
}

const externalDependencyNames = new Set();
for (const { manifest, path: manifestPath } of manifests) {
  for (const section of dependencySections) {
    for (const [name, specifier] of Object.entries(manifest[section] ?? {})) {
      if (nodeBuiltinNames.has(name)) {
        fail(
          `${manifestPath}: ${section}.${name} is a Node builtin, not a package dependency`,
        );
        continue;
      }
      if (typeof specifier !== "string") {
        fail(`${manifestPath}: ${section}.${name} must use a string specifier`);
        continue;
      }
      if (workspacePackageNames.has(name)) {
        if (!specifier.startsWith("workspace:")) {
          fail(
            `${manifestPath}: ${section}.${name} targets a workspace package and must use workspace: (got ${specifier})`,
          );
        }
        continue;
      }
      if (specifier.startsWith("workspace:")) {
        fail(
          `${manifestPath}: ${section}.${name} uses workspace: but no workspace package owns that name`,
        );
        continue;
      }
      if (specifier !== "catalog:") {
        fail(
          `${manifestPath}: ${section}.${name} must use catalog: (got ${specifier})`,
        );
      }
      externalDependencyNames.add(name);
    }
  }
}

const toolingRoute = routes.get("tooling.build");
if (!toolingRoute) {
  fail("dependency route missing: tooling.build");
} else {
  for (const name of toolingRoute.packages) {
    if (!externalDependencyNames.has(name)) {
      fail(`required toolchain dependency missing: ${name}`);
    }
  }
}

for (const name of externalDependencyNames) {
  const route = packageRoutes.get(name);
  if (route && route.directive !== "USE") {
    fail(`dependency route is not adopted for use: ${name} -> ${route.roleId}`);
  }
}

for (const error of validateVersionAuthority({
  root,
  dependencyRouting: authority,
  catalog: workspaceCatalog,
  packageManagerBaseline,
})) {
  fail(error);
}

for (const name of externalDependencyNames) {
  if (!Object.hasOwn(workspaceCatalog, name)) {
    fail(`catalog entry missing for direct external dependency: ${name}`);
  }
}

for (const error of validateStandingDependencyDocuments({
  root,
  packageNames: [...packageRoutes.keys()],
})) {
  fail(error);
}

if (workspaceDocument.catalogMode !== "strict") fail("catalogMode is not strict");
if (workspaceDocument.strictPeerDependencies !== true) {
  fail("strictPeerDependencies must be explicitly enabled");
}
if (workspaceDocument.engineStrict !== true) {
  fail("engineStrict must be explicitly enabled");
}
if (Object.hasOwn(workspaceDocument, "minimumReleaseAgeExclude")) {
  fail(
    "minimumReleaseAgeExclude must be absent from the PRE_PRODUCTION workspace policy",
  );
}
if (
  Number.isInteger(minimumReleaseAge) &&
  workspaceDocument.minimumReleaseAge !== minimumReleaseAge
) {
  fail(`minimumReleaseAge must be explicitly pinned to ${minimumReleaseAge} minutes`);
}
if (Object.hasOwn(workspaceDocument, "nodeLinker")) {
  fail("nodeLinker must remain pnpm's explicit default: isolated");
}
if (workspaceOverrides["@types/node"] !== workspaceCatalog["@types/node"]) {
  fail(
    `@types/node override must match catalog Authority (expected ${workspaceCatalog["@types/node"]})`,
  );
}
if (!existsSync(join(root, "pnpm-lock.yaml"))) fail("pnpm-lock.yaml is missing");

const lockNames = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) =>
    [
      "package-lock.json",
      "yarn.lock",
      "npm-shrinkwrap.json",
      "bun.lock",
      "bun.lockb",
    ].includes(name),
  );
for (const name of lockNames) {
  fail(`second package-resolution authority present: ${name}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exitCode = 1;
} else {
  console.log(
    "PASS dependency routes; workspace/internal, external npm, Node builtin, and adopted provider rules are valid",
  );
}
