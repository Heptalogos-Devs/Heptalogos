// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const effects = vi.hoisted(() => [] as { command: string; args: string[] }[]);
vi.mock("@heptalogos/repo-kit", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@heptalogos/repo-kit");
  return {
    ...actual,
    runProcessSyncChecked: (command: string, args: string[]) => {
      if (command !== "systemctl" && !command.endsWith("pg_controldata"))
        throw Error("Unexpected update process " + command);
      effects.push({ command, args });
      return {
        stdout: args.includes("--property=MainPID") ? "0\n" : "",
        stderr: "",
        exitCode: 0,
      };
    },
    runProcessSync: (command: string, args: string[]) => {
      if (!command.endsWith("pg_ctl"))
        throw Error("Unexpected materialization process " + command);
      effects.push({ command, args });
      return { stdout: "", stderr: "", exitCode: 3, failed: true };
    },
  };
});
const { digestTree } =
  await import("../../../scripts/package/assemble-portable-product.mjs");
const { updateLinuxProduct } =
  await import("../../../scripts/package/update-linux-product.mjs");
const generation = "a".repeat(64);
const provider = "node_modules/@heptalogos/canonical-schema/dist/migration-provider.js";
const workspaceProvider =
  "workspace_modules/@heptalogos/canonical-schema/dist/migration-provider.js";
const directories: string[] = [];
async function put(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}
async function writePayload(root: string, latest: boolean) {
  await put(join(root, "bin.js"), "export {};\n");
  await put(
    join(root, "generated/build-identities.js"),
    `export const PRODUCT_GENERATION_ID = "${generation}";\n`,
  );
  await put(join(root, "cli/bin.js"), "export {};\n");
  const code = latest
    ? 'export const migrations = ["0017", "0018"];\n'
    : 'export const migrations = ["0017"];\n';
  for (const path of [provider, workspaceProvider]) {
    await put(join(root, path), code);
    // A new migration file alone did not prevent the actual stale-provider incident.
    await put(
      join(dirname(join(root, path)), "0018-retained-result-domain-time.js"),
      "export const repair = true;\n",
    );
  }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "frozen-product-update-"));
  directories.push(root);
  const candidate = join(root, "frozen"),
    target = join(root, "installed"),
    mutable = join(root, "mutable-dist");
  const product = join(candidate, "program/product", generation);
  await writePayload(product, true);
  const hostDigest = await digestTree(product),
    cliDigest = await digestTree(join(product, "cli"));
  await put(
    join(candidate, "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      productGeneration: generation,
      target: { os: process.platform, arch: process.arch },
      components: [
        { name: "product-host", digest: hostDigest },
        { name: "reference-cli", digest: cliDigest },
      ],
    }),
  );
  await writePayload(mutable, true);
  // Freeze first; a later Nx restore brings the mutable workspace and resolved
  // node_modules provider back to 0017, while leaving the new 0018 file present.
  await writePayload(mutable, false);
  await cp(mutable, join(target, "program/product", generation), { recursive: true });
  const roots = Object.fromEntries(
    ["CONFIGURATION", "DATA", "INSTANCE", "SECRET", "BLOB", "BACKUP"].map((name) => [
      name,
      join(target, name.toLowerCase()),
    ]),
  );
  for (const path of Object.values(roots))
    await put(join(path, "original-state"), "preserve-existing-state\n");
  const unit = "heptalogos-fixture.service",
    installationId = "fixture-installation";
  await put(
    join(target, "manifest.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId,
      platform: process.platform,
      arch: process.arch,
      managementUnit: unit,
      productGeneration: generation,
      assembly: { hostDigest: "old-input-digest", cliDigest: "old-cli-input-digest" },
    }),
  );
  await put(
    join(target, "heptalogos.bootstrap.json"),
    JSON.stringify({ installationId, roots }),
  );
  await put(
    join(roots.CONFIGURATION!, "installation-services.json"),
    JSON.stringify({ installationId, services: { host: { unit } } }),
  );
  await put(
    join(roots.CONFIGURATION!, "systemd", unit),
    `ExecStart=${join(target, "program/product", generation, "bin.js")}\n`,
  );
  await put(join(target, "bin/heptalogos"), "old launcher\n");
  return { candidate, target, mutable, roots, product, hostDigest, cliDigest };
}
beforeEach(() => {
  effects.length = 0;
});
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
describe.runIf(process.platform === "linux")("frozen Product updater", () => {
  it("installs the exact frozen closure despite stale mutable artifacts, preserving a cold backup and same-generation identity", async () => {
    const f = await fixture();
    const before = await readFile(join(f.target, "heptalogos.bootstrap.json"), "utf8");
    const result = await updateLinuxProduct({
      target: f.target,
      candidate: f.candidate,
    });
    expect(result.updated).toBe(true);
    expect(await digestTree(join(f.target, "program/product", generation))).toBe(
      f.hostDigest,
    );
    expect(
      await readFile(join(f.target, "program/product", generation, provider), "utf8"),
    ).toContain('"0018"');
    expect(await readFile(join(f.mutable, provider), "utf8")).not.toContain('"0018"');
    expect(
      await readFile(join(result.backup, "product-payload", provider), "utf8"),
    ).not.toContain('"0018"');
    for (const path of Object.values(f.roots))
      expect(await readFile(join(path, "original-state"), "utf8")).toBe(
        "preserve-existing-state\n",
      );
    expect(await readFile(join(f.target, "heptalogos.bootstrap.json"), "utf8")).toBe(
      before,
    );
    expect(
      JSON.parse(await readFile(join(f.target, "manifest.json"), "utf8")),
    ).toMatchObject({
      productGeneration: generation,
      assembly: { hostDigest: f.hostDigest, cliDigest: f.cliDigest },
    });
    expect(
      effects.some((x) => x.command === "systemctl" && x.args.includes("stop")),
    ).toBe(true);
    effects.length = 0;
    expect(
      await updateLinuxProduct({ target: f.target, candidate: f.candidate }),
    ).toMatchObject({ updated: false, generation });
    expect(effects).toEqual([]);
  });
  it.each([provider, "cli/bin.js"])(
    "rejects candidate tampering in %s before service effects",
    async (path) => {
      const f = await fixture();
      await put(join(f.product, path), "changed after manifest freeze\n");
      await expect(
        updateLinuxProduct({ target: f.target, candidate: f.candidate }),
      ).rejects.toThrow("closure does not match");
      expect(effects).toEqual([]);
      expect(
        await readFile(join(f.target, "program/product", generation, provider), "utf8"),
      ).not.toContain('"0018"');
    },
  );
  it("rejects a v1 candidate and upgrades v1 installation metadata through the normal cold backup", async () => {
    const f = await fixture();
    const path = join(f.candidate, "manifest.json");
    const candidate = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...candidate, schemaVersion: 1 }));
    await expect(
      updateLinuxProduct({ target: f.target, candidate: f.candidate }),
    ).rejects.toThrow("manifest schemaVersion 2");
    expect(effects).toEqual([]);
    await writeFile(path, JSON.stringify(candidate));
    await cp(f.product, join(f.target, "program/product", generation), {
      recursive: true,
    });
    const result = await updateLinuxProduct({
      target: f.target,
      candidate: f.candidate,
    });
    expect(result.updated).toBe(true);
    expect(
      JSON.parse(await readFile(join(result.backup, "manifest.json"), "utf8"))
        .schemaVersion,
    ).toBe(1);
    expect(
      JSON.parse(await readFile(join(f.target, "manifest.json"), "utf8")).schemaVersion,
    ).toBe(2);
  });
  it("requires an explicit frozen candidate without falling back to workspace dist", async () => {
    const f = await fixture();
    await expect(updateLinuxProduct({ target: f.target })).rejects.toThrow(
      "--candidate is required",
    );
    expect(effects).toEqual([]);
  });
});
