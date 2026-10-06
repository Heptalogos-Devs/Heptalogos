// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runGitSync,
  runNode,
  runPnpm,
  runProcessChecked,
  runProcessSync,
} from "../src/process.mjs";
import { readPackageManagerBaseline } from "../src/version-authority.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, "fixtures/echo-argv.mjs");
const repoRoot = resolve(here, "../../..");

describe("repository process runner", () => {
  it("preserves argv without shell parsing", async () => {
    const argv = [
      "space value",
      'quote"value',
      "amp&value",
      "paren(value)",
      "caret^value",
    ];
    const result = await runNode(fixture, argv, { cwd: repoRoot });
    expect(JSON.parse(result.stdout)).toEqual(argv);
  });

  it("runs the repository pnpm shim without cmd.exe command-string construction", async () => {
    const result = await runPnpm(["--version"], { cwd: repoRoot });
    expect(result.stdout.trim()).toBe(
      readPackageManagerBaseline({ root: repoRoot }).packageManagerVersion,
    );
  });

  it("returns structured non-zero results when rejection is disabled", async () => {
    const result = await runProcessChecked(
      process.execPath,
      ["-e", "process.exit(7)"],
      {
        cwd: repoRoot,
        reject: false,
      },
    );
    expect(result.exitCode).toBe(7);
    expect(result.failed).toBe(true);
  });

  it("normalizes synchronous process results and preserves non-zero outcomes", () => {
    const result = runProcessSync(process.execPath, ["-e", "process.exit(7)"], {
      cwd: repoRoot,
      reject: false,
    });
    expect(result.exitCode).toBe(7);
    expect(result.failed).toBe(true);
    expect(result.stdout).toBe("");
  });

  it("routes synchronous repository commands through the process owner", async () => {
    const result = runGitSync(["rev-parse", "--show-toplevel"], { cwd: repoRoot });
    expect(await realpath(result.stdout.trim())).toBe(repoRoot);
  });

  it("passes environment variables to the child process", async () => {
    const result = await runNode(
      "-e",
      [
        "process.stdout.write(JSON.stringify({ probe: process.env.HEPTALOGOS_PROBE ?? null, inheritsPath: Boolean(process.env.PATH) }))",
      ],
      { cwd: repoRoot, env: { HEPTALOGOS_PROBE: "windows-env-probe" } },
    );
    expect(JSON.parse(result.stdout)).toEqual({
      probe: "windows-env-probe",
      inheritsPath: true,
    });
  });

  it("runs the child in the requested working directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "heptalogos-repo-kit-cwd-"));
    try {
      const result = await runNode("-e", ["process.stdout.write(process.cwd())"], {
        cwd: directory,
      });
      const [childCwd, expected] = await Promise.all([
        realpath(result.stdout),
        realpath(directory),
      ]);
      expect(childCwd).toBe(expected);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
