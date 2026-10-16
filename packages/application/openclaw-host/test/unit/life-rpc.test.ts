// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { it, expect } from "vitest";
import {
  cp,
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import { dirname, join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
it("executes Life through the real pinned agent RPC and cannot inherit a binding in the next same-Session run", async () => {
  const resolvedSource = dirname(
    dirname(
      dirname(
        fileURLToPath(import.meta.resolve("openclaw/plugin-sdk/channel-message")),
      ),
    ),
  );
  const source = process.env.HEPTALOGOS_TEST_OPENCLAW_ROOT
    ? resolve(process.env.HEPTALOGOS_TEST_OPENCLAW_ROOT)
    : resolvedSource;
  expect(JSON.parse(await readFile(join(source, "package.json"), "utf8")).version).toBe(
    "2026.9.1",
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
    const linked = new Set<string>();
    // pnpm keeps runtime dependencies beside the package even when its nested node_modules contains only .bin.
    for (const dependencies of [
      join(source, "node_modules"),
      ...(basename(dirname(source)) === "node_modules" ? [dirname(source)] : []),
    ])
      for (const entry of await readdir(dependencies).catch(() => [])) {
        if (entry.startsWith(".") || entry === "openclaw") continue;
        const packages = entry.startsWith("@")
          ? (await readdir(join(dependencies, entry))).map((name) => entry + "/" + name)
          : [entry];
        for (const name of packages) {
          if (linked.has(name)) continue;
          linked.add(name);
          if (name.startsWith("@"))
            await mkdir(join(native, "node_modules", name.split("/")[0]!), {
              recursive: true,
            });
          await symlink(
            await realpath(join(dependencies, name)),
            join(native, "node_modules", name),
            "junction",
          );
        }
      }
    const result = await exec(
      process.execPath,
      [
        fileURLToPath(new URL("../support/life-rpc.ts", import.meta.url)),
        native,
        fileURLToPath(new URL("../../dist/life-tool.js", import.meta.url)),
        fileURLToPath(new URL("../../dist/dispatch.js", import.meta.url)),
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
    expect(result.stdout).toContain('"nativeLifeReadAction":"PASS"');
    expect(result.stdout).toContain('"nativeEarlyAcknowledgement":"PASS"');
    expect(result.stdout).toContain('"unboundNextRun":"PASS"');
    expect(result.stdout).toContain('"paidCalls":0');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}, 120000);
