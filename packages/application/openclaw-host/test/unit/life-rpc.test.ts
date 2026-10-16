// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { it, expect } from "vitest";
import {
  cp,
  mkdtemp,
  mkdir,
  readdir,
  realpath,
  stat,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
it("executes Life through the real pinned agent RPC and cannot inherit a binding in the next same-Session run", async () => {
  const source = dirname(
    dirname(
      dirname(
        fileURLToPath(import.meta.resolve("openclaw/plugin-sdk/channel-message")),
      ),
    ),
  );
  const temporary = await mkdtemp(join(tmpdir(), "heptalogos-life-sdk-"));
  const native = join(temporary, "native");
  try {
    // Copy only runtime code; the installed dependency and all operator data remain untouched.
    await cp(join(source, "dist"), join(native, "dist"), { recursive: true });
    await cp(
      join(source, "docs/reference/templates"),
      join(native, "docs/reference/templates"),
      { recursive: true },
    );
    await cp(join(source, "package.json"), join(native, "package.json"));
    await mkdir(join(native, "node_modules"));
    const dependencies = await stat(join(source, "node_modules"))
      .then(() => join(source, "node_modules"))
      .catch(() => dirname(source));
    for (const entry of await readdir(dependencies)) {
      if (entry.startsWith(".") || entry === "openclaw") continue;
      await symlink(
        await realpath(join(dependencies, entry)),
        join(native, "node_modules", entry),
        "junction",
      );
    }
    const result = await exec(
      process.execPath,
      [
        fileURLToPath(new URL("../support/life-rpc.ts", import.meta.url)),
        native,
        fileURLToPath(new URL("../../dist/life-tool.js", import.meta.url)),
      ],
      {
        env: {
          ...process.env,
          NODE_USE_ENV_PROXY: "0",
          NO_PROXY: "127.0.0.1,localhost",
        },
        timeout: 90000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    expect(result.stdout).toContain('"nativeAgentRpcLifeTool":"PASS"');
    expect(result.stdout).toContain('"unboundNextRun":"PASS"');
    expect(result.stdout).toContain('"paidCalls":0');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 120000);
