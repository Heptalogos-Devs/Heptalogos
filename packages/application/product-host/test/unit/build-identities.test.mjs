// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeBuildIdentities,
  renderBuildIdentities,
} from "../../scripts/build-identities.mjs";

const directories = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-build-identities-"));
  directories.push(root);
  const bootstrapRoot = join(root, "packages/bootstrap/bootstrap-runtime");
  const productRoot = join(root, "packages/system/example");
  await Promise.all([
    mkdir(join(bootstrapRoot, "src"), { recursive: true }),
    mkdir(join(productRoot, "src"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n"),
    writeFile(join(root, "package.json"), '{"private":true}\n'),
    writeFile(join(bootstrapRoot, "package.json"), '{"name":"bootstrap"}\n'),
    writeFile(join(bootstrapRoot, "project.json"), '{"name":"bootstrap"}\n'),
    writeFile(join(bootstrapRoot, "tsconfig.json"), "{}\n"),
    writeFile(join(bootstrapRoot, "tsconfig.build.json"), "{}\n"),
    writeFile(join(bootstrapRoot, "src/index.ts"), "export const boot = 1;\n"),
    writeFile(join(productRoot, "package.json"), '{"name":"example"}\n'),
    writeFile(join(productRoot, "src/index.ts"), "export const value = 1;\n"),
  ]);
  return { root, bootstrapRoot, productRoot };
}

describe("build-carried generation identities", () => {
  it("is deterministic and changes only with the corresponding included content", async () => {
    const { root, bootstrapRoot, productRoot } = await fixture();
    const first = await computeBuildIdentities(root);
    expect(await computeBuildIdentities(root)).toEqual(first);
    expect(renderBuildIdentities(first)).not.toContain(root);

    await writeFile(join(productRoot, "src/index.ts"), "export const value = 2;\n");
    const productChanged = await computeBuildIdentities(root);
    expect(productChanged.productGeneration).not.toBe(first.productGeneration);
    expect(productChanged.bootstrapRuntimeGeneration).toBe(
      first.bootstrapRuntimeGeneration,
    );

    await writeFile(join(bootstrapRoot, "src/index.ts"), "export const boot = 2;\n");
    const bootstrapChanged = await computeBuildIdentities(root);
    expect(bootstrapChanged.productGeneration).not.toBe(
      productChanged.productGeneration,
    );
    expect(bootstrapChanged.bootstrapRuntimeGeneration).not.toBe(
      productChanged.bootstrapRuntimeGeneration,
    );
  });
});
