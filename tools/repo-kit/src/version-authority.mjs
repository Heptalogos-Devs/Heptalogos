// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reads machine-readable version Authorities and compares declared toolchain
 * projections without making package manifests a second policy source.
 * @module version-authority
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readYamlFile } from "./yaml.mjs";

function readJson(root, name) {
  return JSON.parse(readFileSync(join(resolve(root), name), "utf8"));
}

function parsePackageManager(value) {
  if (typeof value !== "string") {
    throw new Error("package.json packageManager must be a string");
  }
  const separator = value.indexOf("@");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`package.json packageManager is not name@version: ${value}`);
  }
  return {
    packageManager: value,
    packageManagerName: value.slice(0, separator),
    packageManagerVersion: value.slice(separator + 1),
  };
}

const NODE_VERSION_PROJECTION_FILES = Object.freeze([".node-version", ".nvmrc"]);
const DEPENDENCY_ROUTING_PATH = "project/dependencies/dependency-routing.json";
const STANDING_DEPENDENCY_DOCUMENTS = Object.freeze([
  DEPENDENCY_ROUTING_PATH,
  "project/dependencies/implementation-routing.md",
  "project/dependencies/decision-ledger.md",
  "project/qualification/dependency-matrix.md",
  "project/qualification/dependencies.md",
  "project/qualification/dependency-status.json",
  "project/engineering/repository/toolchain.md",
  "project/engineering/gotchas/bootstrap/proper-lockfile-stale-reclaim.md",
]);

const EXACT_VERSION_PATTERN =
  /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseExactVersion(value) {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(EXACT_VERSION_PATTERN);
  if (match === null) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function validateVersionConstraint(constraint, label) {
  if (!isRecord(constraint)) {
    return [`${label} must be an object with an integer major and optional minor`];
  }
  const errors = [];
  for (const key of Object.keys(constraint)) {
    if (key !== "major" && key !== "minor") {
      errors.push(`${label} contains unsupported field: ${key}`);
    }
  }
  if (!Number.isInteger(constraint.major) || constraint.major < 0) {
    errors.push(`${label}.major must be a non-negative integer`);
  }
  if (
    constraint.minor !== undefined &&
    (!Number.isInteger(constraint.minor) || constraint.minor < 0)
  ) {
    errors.push(`${label}.minor must be a non-negative integer when present`);
  }
  return errors;
}

function validatePackageManagerConstraint(constraint, label) {
  if (!isRecord(constraint)) {
    return [`${label} must be an object with name and major`];
  }
  const errors = [];
  for (const key of Object.keys(constraint)) {
    if (key !== "name" && key !== "major") {
      errors.push(`${label} contains unsupported field: ${key}`);
    }
  }
  if (typeof constraint.name !== "string" || constraint.name.length === 0) {
    errors.push(`${label}.name must be a non-empty string`);
  }
  if (!Number.isInteger(constraint.major) || constraint.major < 0) {
    errors.push(`${label}.major must be a non-negative integer`);
  }
  return errors;
}

function constraintDescription(constraint) {
  return constraint.minor === undefined
    ? `major ${constraint.major}`
    : `major ${constraint.major}, minor ${constraint.minor}`;
}

function exactVersionSatisfies(version, constraint) {
  return (
    version.major === constraint.major &&
    (constraint.minor === undefined || version.minor === constraint.minor)
  );
}

/** Read package-manager and Node baseline values from the root manifest. */
export function readPackageManagerBaseline({ root = process.cwd() } = {}) {
  const packageJson = readJson(root, "package.json");
  const packageManager = parsePackageManager(packageJson.packageManager);
  const node = packageJson.engines?.node;
  if (typeof node !== "string" || node.length === 0) {
    throw new Error("package.json engines.node must be a non-empty string");
  }
  return { node, ...packageManager };
}

/** Read Node-version projection files that must mirror the manifest baseline. */
export function readNodeVersionProjections({ root = process.cwd() } = {}) {
  const repositoryRoot = resolve(root);
  return Object.fromEntries(
    NODE_VERSION_PROJECTION_FILES.map((name) => {
      const value = readFileSync(join(repositoryRoot, name), "utf8").trim();
      if (value.length === 0) {
        throw new Error(`${name} must contain a non-empty Node version`);
      }
      return [name, value];
    }),
  );
}

/** Report drift between declared Node projections and the root baseline. */
export function validateNodeVersionProjections({ root = process.cwd() } = {}) {
  const repositoryRoot = resolve(root);
  const { node } = readPackageManagerBaseline({ root: repositoryRoot });
  const projections = readNodeVersionProjections({ root: repositoryRoot });
  return Object.entries(projections)
    .filter(([, value]) => value !== node)
    .map(
      ([name, value]) =>
        `${name} must match package.json engines.node (${node}); got ${value}`,
    );
}

/** Read one scalar mapping section from the workspace YAML authority. */
export function readWorkspaceSection({ root = process.cwd(), section } = {}) {
  const workspace = readYamlFile(join(resolve(root), "pnpm-workspace.yaml"));
  const value = workspace?.[section];
  if (value === undefined) {
    throw new Error(`pnpm-workspace.yaml ${section} section is missing`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`pnpm-workspace.yaml ${section} section must be a mapping`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, entry]) => {
      if (
        typeof entry !== "string" &&
        typeof entry !== "number" &&
        typeof entry !== "boolean"
      ) {
        throw new Error(`pnpm-workspace.yaml ${section}.${name} must be a scalar`);
      }
      return [name, String(entry)];
    }),
  );
}

/** Read the workspace Catalog through the shared YAML authority. */
export function readWorkspaceCatalog({ root = process.cwd() } = {}) {
  return readWorkspaceSection({ root, section: "catalog" });
}

function resolveCatalogVersion(specifier, name) {
  if (typeof specifier !== "string" || specifier.length === 0) {
    throw new Error(`catalog.${name} must be a non-empty string`);
  }
  const target = specifier.startsWith("npm:")
    ? specifier.slice("npm:".length)
    : specifier;
  const separator = target.lastIndexOf("@");
  if (specifier.startsWith("npm:") && separator <= 0) {
    throw new Error(`catalog.${name} npm alias is not package@version: ${specifier}`);
  }
  return separator > 0 ? target.slice(separator + 1) : target;
}

/** Resolve exact installed versions represented by Catalog entries. */
export function resolveExpectedInstalledPackageVersions({
  root = process.cwd(),
  packageNames,
} = {}) {
  const catalog = readWorkspaceCatalog({ root });
  const names = packageNames ?? Object.keys(catalog);
  if (!Array.isArray(names)) throw new TypeError("packageNames must be an array");
  return Object.fromEntries(
    names.map((name) => {
      if (!Object.hasOwn(catalog, name)) {
        throw new Error(`catalog entry is missing: ${name}`);
      }
      return [name, resolveCatalogVersion(catalog[name], name)];
    }),
  );
}

/** Validate dependency routing and installed-version projections against Authorities. */
export function validateVersionAuthority({
  root = process.cwd(),
  dependencyRouting,
  catalog,
  packageManagerBaseline,
} = {}) {
  const repositoryRoot = resolve(root);
  const errors = [];
  let routing = dependencyRouting;
  if (routing === undefined) {
    try {
      routing = readJson(repositoryRoot, DEPENDENCY_ROUTING_PATH);
    } catch (error) {
      return [`dependency routing Authority is unreadable: ${error.message}`];
    }
  }

  let catalogValues = catalog;
  if (catalogValues === undefined) {
    try {
      catalogValues = readWorkspaceCatalog({ root: repositoryRoot });
    } catch (error) {
      errors.push(`workspace catalog Authority is unreadable: ${error.message}`);
      catalogValues = {};
    }
  }

  let baseline = packageManagerBaseline;
  if (baseline === undefined) {
    try {
      baseline = readPackageManagerBaseline({ root: repositoryRoot });
    } catch (error) {
      errors.push(`package manager Authority is unreadable: ${error.message}`);
      baseline = undefined;
    }
  }

  if (!Array.isArray(routing?.routes)) {
    errors.push("dependency routing Authority must declare routes[]");
    return errors;
  }

  const nodeRoute = routing.routes.find((route) => route?.roleId === "runtime.node");
  if (nodeRoute === undefined) {
    errors.push(
      "dependency route missing machine-readable runtime.node version constraint",
    );
  } else if (baseline?.node !== undefined) {
    const nodeConstraint = nodeRoute.versionConstraint;
    errors.push(
      ...validateVersionConstraint(
        nodeConstraint,
        "dependency route runtime.node versionConstraint",
      ),
    );
    const nodeVersion = parseExactVersion(baseline.node);
    if (nodeVersion === undefined) {
      errors.push(
        `package.json engines.node must be an exact semver selection for runtime.node validation: ${baseline.node}`,
      );
    } else if (
      isRecord(nodeConstraint) &&
      validateVersionConstraint(nodeConstraint, "runtime.node").length === 0 &&
      !exactVersionSatisfies(nodeVersion, nodeConstraint)
    ) {
      errors.push(
        `package.json engines.node ${baseline.node} is outside the adopted runtime.node line (${constraintDescription(nodeConstraint)})`,
      );
    }
  }

  const toolingRoute = routing.routes.find(
    (route) => route?.roleId === "tooling.build",
  );
  if (toolingRoute === undefined) {
    errors.push(
      "dependency route missing machine-readable tooling.build package-manager constraint",
    );
  } else {
    const packageManagerConstraint = toolingRoute.packageManagerConstraint;
    errors.push(
      ...validatePackageManagerConstraint(
        packageManagerConstraint,
        "dependency route tooling.build packageManagerConstraint",
      ),
    );
    if (baseline !== undefined) {
      const managerVersion = parseExactVersion(baseline.packageManagerVersion);
      if (baseline.packageManagerName !== packageManagerConstraint?.name) {
        errors.push(
          `package.json packageManager must use ${packageManagerConstraint?.name ?? "the adopted package manager"}; got ${baseline.packageManagerName}`,
        );
      }
      if (managerVersion === undefined) {
        errors.push(
          `package.json packageManager version must be an exact semver selection: ${baseline.packageManagerVersion}`,
        );
      } else if (
        isRecord(packageManagerConstraint) &&
        validatePackageManagerConstraint(
          packageManagerConstraint,
          "tooling.build packageManagerConstraint",
        ).length === 0 &&
        managerVersion.major !== packageManagerConstraint.major
      ) {
        errors.push(
          `package.json packageManager ${baseline.packageManager} is outside the adopted package-manager line (major ${packageManagerConstraint.major})`,
        );
      }
    }
  }

  const validatePackageSelection = (route, packageName, constraint) => {
    const label = `dependency route ${route.roleId} package ${packageName} versionConstraint`;
    errors.push(...validateVersionConstraint(constraint, label));
    if (!Object.hasOwn(catalogValues, packageName)) return;

    let selectedVersion;
    try {
      selectedVersion = resolveCatalogVersion(catalogValues[packageName], packageName);
    } catch (error) {
      errors.push(
        `catalog selection for ${packageName} is unreadable: ${error.message}`,
      );
      return;
    }
    const parsedVersion = parseExactVersion(selectedVersion);
    if (parsedVersion === undefined) {
      errors.push(
        `catalog selection for ${packageName} must be an exact semver for route-line validation: ${selectedVersion}`,
      );
      return;
    }
    if (
      validateVersionConstraint(constraint, label).length === 0 &&
      !exactVersionSatisfies(parsedVersion, constraint)
    ) {
      errors.push(
        `catalog selection for ${packageName} ${selectedVersion} is outside the adopted ${route.roleId} line (${constraintDescription(constraint)})`,
      );
    }
  };

  for (const route of routing.routes) {
    if (route?.roleId === "runtime.node") continue;
    const packages = Array.isArray(route?.packages) ? route.packages : [];
    if (route?.versionConstraint !== undefined) {
      if (packages.length !== 1) {
        errors.push(
          `dependency route ${route?.roleId} versionConstraint requires exactly one package identity`,
        );
      } else {
        validatePackageSelection(route, packages[0], route.versionConstraint);
      }
    }

    if (route?.packageVersionConstraints === undefined) continue;
    if (!isRecord(route.packageVersionConstraints)) {
      errors.push(
        `dependency route ${route?.roleId} packageVersionConstraints must be an object`,
      );
      continue;
    }
    for (const [packageName, constraint] of Object.entries(
      route.packageVersionConstraints,
    )) {
      if (!packages.includes(packageName)) {
        errors.push(
          `dependency route ${route?.roleId} constrains a package not listed in packages[]: ${packageName}`,
        );
        continue;
      }
      validatePackageSelection(route, packageName, constraint);
    }
  }

  return errors;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function packageExactVersionPattern(packageName) {
  return new RegExp(
    `(?<![A-Za-z0-9_./-])${escapeRegExp(packageName)}(?:@|\\s*(?:=|:)\\s*|\\s+)v?(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)(?![0-9A-Za-z.-])`,
    "giu",
  );
}

const exactNodeVersionPattern =
  /\bnode(?:\.js)?(?:@|\s*(?:=|:)\s*|\s+)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?![0-9A-Za-z.-])/giu;

/** Ensure standing dependency documents do not become competing version Authorities. */
export function validateStandingDependencyDocuments({
  root = process.cwd(),
  packageNames = [],
} = {}) {
  const repositoryRoot = resolve(root);
  const errors = [];
  for (const relativePath of STANDING_DEPENDENCY_DOCUMENTS) {
    const path = join(repositoryRoot, relativePath);
    if (!readFileSyncSafely(path)) {
      errors.push(`standing dependency document is missing: ${relativePath}`);
      continue;
    }
    const source = readFileSync(path, "utf8");
    for (const packageName of packageNames) {
      if (typeof packageName !== "string" || packageName.length === 0) continue;
      const pattern = packageExactVersionPattern(packageName);
      for (const match of source.matchAll(pattern)) {
        errors.push(
          `${relativePath}: exact selected version for ${packageName} (${match[1]}) must remain in the pnpm-workspace.yaml Catalog, not a standing dependency document`,
        );
      }
    }
    for (const match of source.matchAll(exactNodeVersionPattern)) {
      errors.push(
        `${relativePath}: exact Node selection (${match[1]}) must remain in package.json engines.node, not a standing dependency document`,
      );
    }
  }
  return errors;
}

function readFileSyncSafely(path) {
  try {
    readFileSync(path, "utf8");
    return true;
  } catch {
    return false;
  }
}

export { DEPENDENCY_ROUTING_PATH, STANDING_DEPENDENCY_DOCUMENTS };
