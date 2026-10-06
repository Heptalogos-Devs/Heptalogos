// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates the repository knowledge planes, current links, canonical
 * Authorities, and structural retrieval surfaces.
 * @module knowledge
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { findRepositoryFilesSync } from "./discovery.mjs";
import { markdownLinks, markdownTargets } from "./markdown.mjs";
import {
  CURRENT_MACHINE_AUTHORITIES,
  discoverResponsibilityRoots,
} from "./repository-governance.mjs";
import {
  isWithinPath as isWithin,
  normalizeRepositoryPath as normalize,
} from "./paths.mjs";

const requiredEntrypoints = [
  "README.md",
  "INDEX.md",
  "AGENTS.md",
  "docs/README.md",
  "docs/INDEX.md",
  "docs/AGENTS.md",
  "docs/architecture/README.md",
  "docs/architecture/INDEX.md",
  "specs/README.md",
  "specs/INDEX.md",
  "specs/AGENTS.md",
  "project/README.md",
  "project/INDEX.md",
  "project/AGENTS.md",
  "project/plans/INDEX.md",
  "packages/README.md",
  "packages/INDEX.md",
  "packages/AGENTS.md",
  ".agents/skills/AGENTS.md",
  ...CURRENT_MACHINE_AUTHORITIES.map(({ path }) => path),
];

const currentAuthorityByFilename = new Map(
  CURRENT_MACHINE_AUTHORITIES.map((entry) => [basename(entry.path), entry]),
);

const authorityReferencePattern =
  /(?<![A-Za-z0-9_./\\-])(?:\.\.?\/|[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.json\b/gu;

function localMarkdownLinks(text) {
  return markdownLinks(text, { ignoreFencedCode: true });
}

function localMarkdownTargets(text) {
  return markdownTargets(text, { ignoreFencedCode: true });
}

function isHistoricalPlan(relativePath) {
  return /^project\/plans\/(?:completed|superseded|abandoned)\//u.test(relativePath);
}

function isStandingDocument(relativePath) {
  return !isHistoricalPlan(relativePath);
}

function isAuthorityStandingDocument(relativePath) {
  if (!isStandingDocument(relativePath)) return false;
  if (
    relativePath.startsWith("project/plans/") ||
    relativePath.startsWith("project/qualification/evidence/") ||
    (relativePath.startsWith("project/qualification/results/") &&
      relativePath !== "project/qualification/results/README.md")
  ) {
    return false;
  }
  return true;
}

function authorityForReference(reference) {
  return currentAuthorityByFilename.get(basename(reference.replaceAll("\\", "/")));
}

function resolveAuthorityReference(repository, sourcePath, reference) {
  const normalized = reference.replaceAll("\\", "/");
  const firstSegment = normalized.split("/")[0] ?? "";
  const rootRelative = discoverResponsibilityRoots({ root: repository }).includes(
    firstSegment,
  );
  const target = rootRelative
    ? resolve(repository, normalized)
    : resolve(dirname(sourcePath), normalized);
  return normalize(repository, target);
}

function addError(errors, code, path, message) {
  errors.push({ code, path, message });
}

function validateCanonicalAuthorityReference(
  repository,
  sourcePath,
  reference,
  errors,
  reported,
) {
  const authority = authorityForReference(reference);
  if (!authority) return;
  const resolvedTarget = resolveAuthorityReference(repository, sourcePath, reference);
  if (resolvedTarget === authority.path) return;

  const key = authority.path + "|" + reference + "|" + resolvedTarget;
  if (reported.has(key)) return;
  reported.add(key);
  addError(
    errors,
    "noncanonical-authority-reference",
    normalize(repository, sourcePath),
    "current Authority " +
      authority.path +
      " must be referenced from its canonical home; " +
      reference +
      " resolves to " +
      resolvedTarget,
  );
}

function validateCanonicalAuthorityReferences(sourcePath, source, repository, errors) {
  const reported = new Set();
  for (const { target } of localMarkdownLinks(source)) {
    validateCanonicalAuthorityReference(
      repository,
      sourcePath,
      target,
      errors,
      reported,
    );
  }

  for (const match of source.matchAll(authorityReferencePattern)) {
    const prefix = source.slice(Math.max(0, match.index - 12), match.index);
    if (/(?:https?:|mailto:)[^\s]*$/iu.test(prefix)) continue;
    validateCanonicalAuthorityReference(
      repository,
      sourcePath,
      match[0],
      errors,
      reported,
    );
  }
}

function validateEntrypoints(repository, errors) {
  for (const relativePath of requiredEntrypoints) {
    const path = join(repository, relativePath);
    if (!existsSync(path) || !statSync(path).isFile()) {
      addError(
        errors,
        "missing-entrypoint",
        relativePath,
        "required current knowledge entrypoint is missing",
      );
    }
  }
}

function validateJson(files, repository, errors) {
  for (const path of files.filter((file) => file.endsWith(".json"))) {
    try {
      JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      addError(errors, "invalid-json", normalize(repository, path), error.message);
    }
  }
}

function validateTranslationPolicy(files, repository, errors) {
  for (const path of files) {
    const relativePath = normalize(repository, path);
    if (
      /\.zh\.md$/iu.test(relativePath) ||
      /\.i18n\.ya?ml$/iu.test(relativePath) ||
      /(^|\/)translation-manifest(?:\.[^/]+)?$/iu.test(relativePath)
    ) {
      addError(
        errors,
        "translation-disabled",
        relativePath,
        "translation sidecars and manifests are disabled during PRE_PRODUCTION development",
      );
    }
  }
}

function validateStandingLinks(markdownFiles, repository, errors) {
  for (const path of markdownFiles) {
    const relativePath = normalize(repository, path);
    if (!isStandingDocument(relativePath)) continue;
    const source = readFileSync(path, "utf8");
    if (isAuthorityStandingDocument(relativePath)) {
      validateCanonicalAuthorityReferences(path, source, repository, errors);
    }
    for (const target of localMarkdownTargets(source)) {
      const resolvedTarget = resolve(dirname(path), target);
      if (!isWithin(repository, resolvedTarget)) {
        addError(
          errors,
          "link-outside-repository",
          relativePath,
          "local knowledge link escapes repository: " + target,
        );
      } else if (!existsSync(resolvedTarget)) {
        addError(
          errors,
          "broken-current-link",
          relativePath,
          "local knowledge link does not resolve: " + target,
        );
      }
    }
  }
}

function firstLevelDirectoryCounts(planeRoot, indexPath) {
  const expectedAreas = readdirSync(planeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const counts = new Map(expectedAreas.map((area) => [area, 0]));
  for (const target of localMarkdownTargets(readFileSync(indexPath, "utf8"))) {
    const resolvedTarget = resolve(dirname(indexPath), target);
    if (!isWithin(planeRoot, resolvedTarget)) continue;
    const area = relative(planeRoot, resolvedTarget)
      .replaceAll("\\", "/")
      .split("/")[0];
    if (counts.has(area)) counts.set(area, counts.get(area) + 1);
  }
  return counts;
}

function validatePlaneIndex(planeRoot, indexPath, repository, label, errors) {
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) return;
  for (const [area, count] of firstLevelDirectoryCounts(planeRoot, indexPath)) {
    if (count !== 1) {
      addError(
        errors,
        count === 0 ? "unindexed-knowledge-area" : "duplicate-knowledge-area",
        normalize(repository, join(planeRoot, area)),
        label +
          " INDEX must link each first-level area exactly once (found " +
          count +
          ")",
      );
    }
  }
}

function validateRootIndex(repository, errors) {
  const indexPath = join(repository, "INDEX.md");
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) return;
  const covered = new Set(
    localMarkdownTargets(readFileSync(indexPath, "utf8")).map((target) => {
      const resolved = resolve(dirname(indexPath), target);
      return relative(repository, resolved).replaceAll("\\", "/").split("/")[0];
    }),
  );
  for (const root of discoverResponsibilityRoots({ root: repository })) {
    if (!covered.has(root)) {
      addError(
        errors,
        "unindexed-responsibility-root",
        root,
        "root INDEX must cover maintained responsibility root",
      );
    }
  }
}

function validateArchitectureIndex(docsRoot, repository, errors) {
  const architectureRoot = join(docsRoot, "architecture");
  const indexPath = join(architectureRoot, "INDEX.md");
  if (!existsSync(indexPath)) return;
  const expected = readdirSync(architectureRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name !== "README.md" &&
        entry.name !== "AGENTS.md" &&
        entry.name !== "INDEX.md",
    )
    .map((entry) => join(architectureRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const counts = new Map(expected.map((path) => [normalize(repository, path), 0]));
  for (const target of localMarkdownTargets(readFileSync(indexPath, "utf8"))) {
    const resolvedTarget = resolve(dirname(indexPath), target);
    const relativeTarget = normalize(repository, resolvedTarget);
    if (counts.has(relativeTarget)) {
      counts.set(relativeTarget, counts.get(relativeTarget) + 1);
    }
  }
  for (const [relativeTarget, count] of counts) {
    if (count === 0) {
      addError(
        errors,
        "unindexed-architecture-document",
        relativeTarget,
        "architecture INDEX must link every direct architecture document",
      );
    } else if (count > 1) {
      addError(
        errors,
        "duplicate-architecture-document",
        relativeTarget,
        "architecture INDEX links this document " + count + " times",
      );
    }
  }
}

function validateSpecIndex(specsRoot, repository, errors) {
  const indexPath = join(specsRoot, "INDEX.md");
  if (!existsSync(indexPath)) return;

  const expected = findRepositoryFilesSync({
    root: specsRoot,
    patterns: ["**/*.md"],
  })
    .filter(
      (path) =>
        path !== join(specsRoot, "README.md") &&
        path !== join(specsRoot, "AGENTS.md") &&
        path !== indexPath,
    )
    .map((path) => normalize(repository, path))
    .sort();
  const expectedSet = new Set(expected);
  const linked = new Map();
  const prefixes = new Map();
  const source = readFileSync(indexPath, "utf8");
  const tableLines = source
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  for (const line of tableLines) {
    const cells = line
      .replace(/^\||\|$/gu, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 2 || cells.every((cell) => /^:?-{3,}:?$/u.test(cell))) {
      continue;
    }
    const linkCell = cells.find((cell) => /\[[^\]]+\]\([^)]+\)/u.test(cell));
    const prefixCell = cells.at(-1);
    if (linkCell === undefined || prefixCell === undefined) {
      if (cells[0] === "Spec" || cells[0] === "Prefix") continue;
      addError(
        errors,
        "malformed-spec-index-entry",
        "specs/INDEX.md",
        "each Spec index row must provide a Markdown link and a backticked prefix",
      );
      continue;
    }
    const target = linkCell.match(/\[[^\]]+\]\(([^)]+)\)/u)?.[1]?.trim();
    const prefix = prefixCell.slice(1, -1).trim();
    if (target === undefined || prefix.length === 0) continue;
    const relativeTarget = normalize(repository, resolve(dirname(indexPath), target));
    if (prefixes.has(prefix)) {
      addError(
        errors,
        "duplicate-spec-prefix",
        "specs/INDEX.md",
        "Spec prefix is listed more than once: " + prefix,
      );
    }
    prefixes.set(prefix, relativeTarget);
    linked.set(relativeTarget, (linked.get(relativeTarget) ?? 0) + 1);
    if (!expectedSet.has(relativeTarget)) {
      addError(
        errors,
        "nonexistent-spec-index-entry",
        "specs/INDEX.md",
        "Spec index entry does not point to a current Spec: " + target,
      );
    }
  }
  for (const relativeTarget of expected) {
    const count = linked.get(relativeTarget) ?? 0;
    if (count !== 1) {
      addError(
        errors,
        count === 0 ? "unindexed-spec" : "duplicate-spec-index-entry",
        relativeTarget,
        "specs/INDEX.md must link each Spec exactly once (found " + count + ")",
      );
    }
  }

  const requirementIds = new Map();
  for (const relativePath of expected) {
    const path = join(repository, relativePath);
    const text = readFileSync(path, "utf8");
    const requirementPattern =
      /^\s*(?:[-*]|\d+\.)\s+(?:\x60)?([A-Z][A-Z0-9]*-\d{3})\b/gmu;
    for (const match of text.matchAll(requirementPattern)) {
      const id = match[1];
      const previous = requirementIds.get(id);
      if (previous !== undefined) {
        addError(
          errors,
          "duplicate-spec-requirement-id",
          relativePath,
          "Spec requirement ID " + id + " is already defined in " + previous,
        );
      } else {
        requirementIds.set(id, relativePath);
      }
    }
  }
}

/** Validate current repository knowledge structure, links, and Authority homes. */
export function validateKnowledge({ root = process.cwd() } = {}) {
  const repository = resolve(root);
  const errors = [];
  validateEntrypoints(repository, errors);
  const files = findRepositoryFilesSync({
    root: repository,
    patterns: [
      "*.md",
      "docs/**/*.md",
      "docs/**/*.json",
      "specs/**/*.md",
      "specs/**/*.json",
      "project/**/*.md",
      "project/**/*.json",
    ],
    ignore: [
      "docs/reference/api/**",
      "project/plans/completed/**",
      "project/plans/superseded/**",
      "project/plans/abandoned/**",
    ],
  });
  const markdownFiles = files.filter((path) => path.endsWith(".md"));
  const jsonFiles = files.filter((path) => path.endsWith(".json"));
  validateJson(jsonFiles, repository, errors);
  validateTranslationPolicy(files, repository, errors);
  validateStandingLinks(markdownFiles, repository, errors);
  validateRootIndex(repository, errors);
  validatePlaneIndex(
    join(repository, "docs"),
    join(repository, "docs", "INDEX.md"),
    repository,
    "docs",
    errors,
  );
  validatePlaneIndex(
    join(repository, "project"),
    join(repository, "project", "INDEX.md"),
    repository,
    "project",
    errors,
  );
  validateArchitectureIndex(join(repository, "docs"), repository, errors);
  validateSpecIndex(join(repository, "specs"), repository, errors);

  // Intentional duplication: current-tree and knowledge validators sort their
  // independent diagnostic shapes locally to keep the modules decoupled.
  /* jscpd:ignore-start */
  errors.sort((left, right) =>
    (left.code + ":" + left.path + ":" + left.message).localeCompare(
      right.code + ":" + right.path + ":" + right.message,
    ),
  );
  /* jscpd:ignore-end */
  return {
    errors,
    markdownCount: markdownFiles.length,
    jsonCount: jsonFiles.length,
  };
}

export { requiredEntrypoints };
