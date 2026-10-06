#!/usr/bin/env node

// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Validates the generic structural contract for current repository Skills.
 * @module agents
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findRepositoryFilesSync,
  isWithinPath,
  markdownLinks,
  parseYaml,
} from "@heptalogos/repo-kit";

const scriptFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptFile), "../..");
const skillsRoot = path.join(repoRoot, ".agents", "skills");
const errors = [];

function relativePath(file) {
  return path.relative(repoRoot, file).replaceAll(path.sep, "/");
}

function fail(message) {
  errors.push(message);
}

function requireFile(file, label = relativePath(file)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    fail(`Missing file: ${label}`);
    return false;
  }
  return true;
}

function requireDirectory(directory, label = relativePath(directory)) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    fail(`Missing directory: ${label}`);
    return false;
  }
  return true;
}

function parseFrontmatter(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/u);
  if (!match) {
    fail(`Missing YAML frontmatter: ${relativePath(file)}`);
    return undefined;
  }
  try {
    const parsed = parseYaml(match[1], file);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`Skill frontmatter must be a mapping: ${relativePath(file)}`);
      return undefined;
    }
    return parsed;
  } catch (error) {
    fail(`Invalid YAML frontmatter: ${relativePath(file)}: ${error.message}`);
    return undefined;
  }
}

function validateMarkdownLinks(file, source) {
  for (const { target } of markdownLinks(source)) {
    let decodedTarget;
    try {
      decodedTarget = decodeURI(target);
    } catch (error) {
      fail(
        `Invalid Skill reference: ${relativePath(file)}: ${target}: ${error.message}`,
      );
      continue;
    }
    const resolved = path.resolve(path.dirname(file), decodedTarget);
    if (!isWithinPath(repoRoot, resolved)) {
      fail(`Skill reference escapes repository: ${relativePath(file)}: ${target}`);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      fail(`Broken Skill reference: ${relativePath(file)}: ${target}`);
    }
  }
}

function validateSkillDirectory(skillDirectory, names) {
  const skillFile = path.join(skillDirectory, "SKILL.md");
  if (!requireFile(skillFile)) return;

  const skillFiles = findRepositoryFilesSync({
    root: skillDirectory,
    patterns: ["**/*.md"],
  });
  let frontmatter;
  for (const file of skillFiles) {
    const source = fs.readFileSync(file, "utf8");
    validateMarkdownLinks(file, source);
    if (file === skillFile) frontmatter = parseFrontmatter(source, file);
  }

  if (frontmatter === undefined) return;
  const skillName = frontmatter.name;
  if (typeof skillName !== "string" || skillName.trim() === "") {
    fail(`Skill frontmatter name is required: ${relativePath(skillFile)}`);
  } else {
    if (skillName !== path.basename(skillDirectory)) {
      fail(
        `Skill frontmatter name must match directory: ${relativePath(skillDirectory)} -> ${skillName}`,
      );
    }
    const previous = names.get(skillName);
    if (previous !== undefined) {
      fail(
        `Duplicate Skill name: ${skillName} in ${previous} and ${relativePath(skillFile)}`,
      );
    } else {
      names.set(skillName, relativePath(skillFile));
    }
  }

  if (
    typeof frontmatter.description !== "string" ||
    frontmatter.description.trim() === ""
  ) {
    fail(`Skill description is required: ${relativePath(skillFile)}`);
  }
}

requireFile(path.join(repoRoot, "AGENTS.md"));
if (requireDirectory(skillsRoot, ".agents/skills")) {
  const skillDirectories = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(skillsRoot, entry.name, "SKILL.md")),
    )
    .map((entry) => path.join(skillsRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const names = new Map();
  for (const skillDirectory of skillDirectories) {
    validateSkillDirectory(skillDirectory, names);
  }
}

const skillFiles = fs.existsSync(skillsRoot)
  ? findRepositoryFilesSync({ root: skillsRoot, patterns: ["*/SKILL.md"] })
  : [];
console.log("Heptalogos procedural Skill validation");
console.log(`repo root: ${repoRoot}`);
console.log(`skills: ${skillFiles.length}`);
console.log(`skill files: ${skillFiles.length}`);

if (errors.length > 0) {
  console.error(`\nFAIL (${errors.length})`);
  for (const error of errors) console.error(`  - ${error}`);
  process.exitCode = 1;
} else {
  console.log("\nPASS");
}
