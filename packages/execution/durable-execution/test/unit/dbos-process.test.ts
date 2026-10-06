// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  dbosProcessDiagnostic,
  runDbosCli,
  sanitizeDbosDiagnostic,
} from "../../src/provider/process.js";

async function script(source: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "heptalogos-dbos-process-"));
  const path = join(directory, "fixture.mjs");
  await writeFile(path, source, "utf8");
  return path;
}

describe("DBOS process adapter", () => {
  it("uses process.execPath, shell-free arguments, and sanitized PostgreSQL inheritance", async () => {
    const cliPath = await script(
      "console.log(JSON.stringify({ pgpassword: process.env.PGPASSWORD, pghost: process.env.PGHOST, pgoptions: process.env.PGOPTIONS, lc: process.env.LC_ALL, lang: process.env.LANG }));\n",
    );
    const inherited = {
      PGPASSWORD: "inherited-secret",
      PGHOST: "inherited-host",
      PGOPTIONS: "inherited-role",
    };
    const previous = new Map(
      Object.keys(inherited).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, inherited);
    try {
      const result = await runDbosCli({
        cliPath,
        args: [],
        timeoutMs: 10_000,
        env: { PGPASSWORD: "explicit-secret" },
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        pgpassword: "explicit-secret",
        pghost: undefined,
        pgoptions: undefined,
        lc: "C",
        lang: "C",
      });
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("maps invalid executable, timeout, and bounded diagnostics to safe Problems", async () => {
    await expect(
      runDbosCli({ cliPath: "relative-cli.js", args: [], timeoutMs: 1_000 }),
    ).rejects.toMatchObject({
      problem: { problemCode: "durable.execution.process.invalid_executable" },
    });

    const cliPath = await script("await new Promise(() => {});\n");
    await expect(
      runDbosCli({ cliPath, args: [], timeoutMs: 20 }),
    ).rejects.toMatchObject({
      problem: { problemCode: "durable.execution.process.timed_out" },
    });

    const diagnostic = sanitizeDbosDiagnostic(
      `PGPASSWORD=secret postgres://user:secret@example/db ${"x".repeat(10_000)}`,
    );
    expect(diagnostic).not.toContain("secret");
    expect(diagnostic.length).toBeLessThanOrEqual(4_097);
    expect(
      dbosProcessDiagnostic({ exitCode: 1, stdout: "stdout", stderr: "stderr" }),
    ).toBe("stdout\nstderr");
  });

  it("does not rely on executable permission bits for a Node CLI file", async () => {
    const cliPath = await script("process.stdout.write('ok');\n");
    await chmod(cliPath, 0o644);
    await expect(
      runDbosCli({ cliPath, args: [], timeoutMs: 10_000 }),
    ).resolves.toMatchObject({ exitCode: 0, stdout: "ok" });
  });
});
