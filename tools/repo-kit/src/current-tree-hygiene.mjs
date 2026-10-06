// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Provides the reusable current-tree identity and compatibility-register
 * checks used by repository verification.
 * @module current-tree-hygiene
 */

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { runGitSync } from "./process.mjs";

const SELF_EXEMPTIONS = new Set([
  "tools/repo-kit/src/current-tree-hygiene.mjs",
  "tools/repo-kit/test/current-tree-hygiene.test.mjs",
  "scripts/verify/current-tree-hygiene.mjs",
]);

const DEVELOPMENT_IDENTITY_PATTERN =
  /(?<![a-z0-9])(?:[hmpts]\d+(?:[a-z](?:[-_]?\d+)?|[-_]?s)?)(?![a-z0-9])/iu;
const PR_ID_PATTERN = /(?<![a-z0-9])pr\s*#?\s*\d+(?![a-z0-9])/iu;
const CORRECTIVE_CYCLE_PATTERN =
  /\b(?:corrective[-_ ]?cycle[-_ ]?\d+|session[-_ ]?(?:id[-_ ]?)?\d+)\b/iu;

/** Patterns identifying development-only identities forbidden in current surfaces. */
export const DEVELOPMENT_PROVENANCE_PATTERNS = Object.freeze([
  DEVELOPMENT_IDENTITY_PATTERN,
  PR_ID_PATTERN,
  CORRECTIVE_CYCLE_PATTERN,
]);

/** Detect milestone, PR, session, or corrective-cycle identity in a value. */
export function containsDevelopmentProvenance(value) {
  if (typeof value !== "string") return false;
  return DEVELOPMENT_PROVENANCE_PATTERNS.some((pattern) => pattern.test(value));
}

const SCAN_ROOTS = [
  "AGENTS.md",
  ".agents",
  ".github",
  "tests",
  "packages",
  "scripts",
  "tools",
  "package.json",
  "project.json",
  "pnpm-workspace.yaml",
  "nx.json",
  "eslint.config.mjs",
  "vitest.config.ts",
];

function normalize(root, file) {
  return relative(root, file).replaceAll("\\", "/");
}

function addFinding(findings, code, path, message) {
  findings.push({ code, path, message });
}

function normalizeTrackedPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function isScannedPath(relativePath) {
  return (
    SCAN_ROOTS.some(
      (scanRoot) =>
        relativePath === scanRoot || relativePath.startsWith(scanRoot + "/"),
    ) || /^tsconfig.*\.json$/iu.test(relativePath)
  );
}

function isIdentityContentPath(relativePath) {
  return (
    !/\.(?:md|mdx)$/iu.test(relativePath) &&
    !/(?:^|\/)README\.md$/iu.test(relativePath) &&
    !/(?:^|\/)INDEX\.md$/iu.test(relativePath)
  );
}

function pathStats(path) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

/** Read tracked repository paths through Git for deterministic hygiene coverage. */
export function listTrackedPaths({ root = process.cwd() } = {}) {
  const output = runGitSync(["ls-files", "-z"], { cwd: resolve(root) }).stdout;
  return output
    .split("\0")
    .filter((path) => path.length > 0)
    .map(normalizeTrackedPath);
}

function scanCompatibilityRegister(root, findings) {
  const path = join(root, "project", "governance", "compatibility-obligations.json");
  const relativePath = normalize(root, path);
  if (!existsSync(path)) {
    addFinding(
      findings,
      "compatibility-register",
      relativePath,
      "compatibility obligation register is missing",
    );
    return;
  }

  let register;
  try {
    register = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    addFinding(
      findings,
      "compatibility-register",
      relativePath,
      "compatibility obligation register is invalid JSON: " + error.message,
    );
    return;
  }

  if (
    register?.schemaVersion !== 1 ||
    register?.compatibilityEpoch !== "PRE_PRODUCTION" ||
    !Array.isArray(register?.obligations)
  ) {
    addFinding(
      findings,
      "compatibility-register",
      relativePath,
      "compatibility obligation register must declare schemaVersion 1, PRE_PRODUCTION, and obligations[]",
    );
  }
}

/** Scan current executable/test identities and the compatibility register. */
export function scanCurrentTree({ root = process.cwd(), trackedPaths } = {}) {
  const repositoryRoot = resolve(root);
  const findings = [];
  const files = new Set(
    (trackedPaths ?? listTrackedPaths({ root: repositoryRoot }))
      .map(normalizeTrackedPath)
      .filter(isScannedPath)
      .filter(
        (relativePath) => pathStats(join(repositoryRoot, relativePath)) !== undefined,
      ),
  );

  for (const relativePath of [...files].sort((left, right) =>
    left.localeCompare(right),
  )) {
    if (SELF_EXEMPTIONS.has(relativePath)) continue;
    const file = join(repositoryRoot, relativePath);
    const stats = pathStats(file);
    if (stats === undefined) {
      addFinding(findings, "read-error", relativePath, "tracked path disappeared");
      continue;
    }
    if (!stats.isFile()) continue;

    if (containsDevelopmentProvenance(relativePath)) {
      addFinding(
        findings,
        "development-provenance",
        relativePath,
        "current executable/test identity contains development milestone or provenance",
      );
    }

    if (!isIdentityContentPath(relativePath)) continue;
    let content;
    try {
      content = readFileSync(file, "utf8");
    } catch (error) {
      addFinding(findings, "read-error", relativePath, error.message);
      continue;
    }
    if (containsDevelopmentProvenance(content)) {
      addFinding(
        findings,
        "development-provenance",
        relativePath,
        "current executable/test identity contains development milestone or provenance",
      );
    }
  }

  scanCompatibilityRegister(repositoryRoot, findings);
  findings.sort((left, right) =>
    (left.code + ":" + left.path + ":" + left.message).localeCompare(
      right.code + ":" + right.path + ":" + right.message,
    ),
  );
  return { root: repositoryRoot, findings };
}

/** Self-referential scanner paths excluded from their own provenance diagnostics. */
export const currentTreeHygieneSelfExemptions = [...SELF_EXEMPTIONS];
