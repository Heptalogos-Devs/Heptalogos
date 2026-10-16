// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
function run(
  entrypoint: string,
  args: readonly string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [entrypoint, ...args], {
      cwd,
      env: {
        ...process.env,
        NODE_PATH: undefined,
        NODE_OPTIONS: undefined,
        FORCE_COLOR: undefined,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

describe("closed Management application artifact", () => {
  it("copies outside the workspace with its official SDK and without the retired agent runtime", async () => {
    const source = resolve(repositoryRoot, "packages/application/product-host/dist");
    const { ensureArtifactDependencies, verifyPortableLinks } = await import(
      pathToFileURL(
        resolve(repositoryRoot, "scripts/package/assemble-portable-product.mjs"),
      ).href
    );
    await ensureArtifactDependencies(source, "product-host");
    const { readYamlFile } = await import(
      pathToFileURL(resolve(repositoryRoot, "tools/repo-kit/src/yaml.mjs")).href
    );
    expect(readYamlFile(join(source, "pnpm-workspace.yaml")).overrides).toEqual(
      readYamlFile(join(repositoryRoot, "pnpm-workspace.yaml")).overrides,
    );
    const isolated = await mkdtemp(join(tmpdir(), "heptalogos-artifact-smoke-"));
    try {
      const artifact = join(isolated, "application");
      await cp(source, artifact, { recursive: true, verbatimSymlinks: true });
      await verifyPortableLinks(artifact);
      const probe = join(artifact, "closure-probe.mjs");
      await writeFile(
        probe,
        `
        import { createRequire } from 'node:module';
        import assert from 'node:assert/strict';
        const require = createRequire(import.meta.url);
        for (const retired of ['openclaw', '@openclaw/gateway-client', '@heptalogos/ai-runtime', '@heptalogos/runtime-kernel', '@heptalogos/work-queue', '@heptalogos/durable-execution', '@dbos-inc/dbos-sdk']) {
          assert.throws(() => require.resolve(retired), { code: 'MODULE_NOT_FOUND' });
        }
        const { createLifeService } = await import('@heptalogos/subject');
        const life = createLifeService({});
        assert.equal(typeof life.progressIn, 'function');
        assert.equal(typeof life.resumeDue, 'function');
        const sdk = await import('@nous-wave/client');
        assert.equal(typeof sdk.NousError, 'function');
        console.log(JSON.stringify({ closed: true }));
      `,
      );
      const closure = await run(probe, [], isolated);
      expect(closure.code, closure.stderr).toBe(0);
      expect(JSON.parse(closure.stdout)).toEqual({ closed: true });
      const invalid = await run(join(artifact, "bin.js"), [], isolated);
      expect(invalid.code).toBe(1);
      expect(JSON.parse(invalid.stderr)).toMatchObject({
        type: "ERROR",
        problemCode: "product-host.invalid_input",
      });
      const initialized = await run(
        join(artifact, "bin.js"),
        ["init", "--anchor-root", join(isolated, "installation")],
        isolated,
      );
      expect(initialized.code, initialized.stderr).toBe(0);
      const locator = JSON.parse(
        await readFile(
          join(isolated, "installation/heptalogos.bootstrap.json"),
          "utf8",
        ),
      );
      expect(JSON.parse(initialized.stdout)).toMatchObject({
        type: "INITIALIZED",
        installationId: locator.installationId,
      });
    } finally {
      await rm(isolated, { recursive: true, force: true });
    }
  });
});

it("refreshes changed same-version file dependencies and reuses unchanged artifact inputs", async () => {
  const { ensureArtifactDependencies } = await import(
    pathToFileURL(
      resolve(repositoryRoot, "scripts/package/assemble-portable-product.mjs"),
    ).href
  );
  const root = await mkdtemp(join(tmpdir(), "heptalogos-artifact-refresh-"));
  const label = `refresh-${process.pid}-${Date.now()}`;
  try {
    const dependency = join(root, "workspace_modules/fixture");
    await mkdir(dependency, { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "artifact-refresh-proof",
        version: "1.0.0",
        dependencies: { fixture: "file:./workspace_modules/fixture" },
      }),
    );
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({ name: "fixture", version: "1.0.0", main: "index.js" }),
    );
    await writeFile(join(dependency, "index.js"), "export const value = 1;\n");
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    execFileSync("pnpm", ["install", "--lockfile-only"], { cwd: root, stdio: "pipe" });
    await ensureArtifactDependencies(root, label);
    const installed = join(root, "node_modules/fixture/index.js");
    expect(await readFile(installed, "utf8")).toBe("export const value = 1;\n");
    await writeFile(join(dependency, "index.js"), "export const value = 2;\n");
    await ensureArtifactDependencies(root, label);
    expect(await readFile(installed, "utf8")).toBe("export const value = 2;\n");
    const modulesState = join(root, "node_modules/.modules.yaml");
    const before = await stat(modulesState);
    await ensureArtifactDependencies(root, label);
    const after = await stat(modulesState);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.ino).toBe(before.ino);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(join(repositoryRoot, "tmp/product-artifact-state", `${label}.json`), {
      force: true,
    });
  }
}, 30_000);
