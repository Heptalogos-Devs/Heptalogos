// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

// Intentional duplication: the artifact smoke test owns a dependency-closure
// subprocess probe, while portable qualification owns the full launcher and
// lifecycle process; sharing their process helpers would couple evidence paths.
/* jscpd:ignore-start */
function runArtifactEntry(
  entrypoint: string,
  cwd: string,
): Promise<{
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [entrypoint], {
      cwd,
      env: {
        SystemRoot: process.env.SystemRoot,
        WINDIR: process.env.WINDIR,
        ComSpec: process.env.ComSpec,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        PATH: process.env.PATH,
        NODE_PATH: undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code) =>
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
}
/* jscpd:ignore-end */

describe("built application artifact", () => {
  it("resolves Product Host dependencies without the source workspace", async () => {
    const artifactRoot = resolve(
      repositoryRoot,
      "packages/application/product-host/dist",
    );
    const isolatedRoot = await mkdtemp(join(tmpdir(), "heptalogos-artifact-smoke-"));
    try {
      const result = await runArtifactEntry(join(artifactRoot, "bin.js"), isolatedRoot);
      expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
      expect(result.stderr).not.toContain("Cannot find package");
      expect(JSON.parse(result.stderr)).toMatchObject({
        type: "ERROR",
        problemCode: "product-host.invalid_input",
      });
      expect(result.code).toBe(1);
    } finally {
      await rm(isolatedRoot, { recursive: true, force: true });
    }
  });
});
