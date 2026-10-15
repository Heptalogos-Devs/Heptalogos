// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeProductInstallation } from "../../src/installation.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function anchor() {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-initialize-"));
  directories.push(root);
  return root;
}

describe("Product installation initialization", () => {
  it("returns one complete identity to concurrent initializers", async () => {
    const root = await anchor();
    const [first, second] = await Promise.all([
      initializeProductInstallation(root),
      initializeProductInstallation(root),
    ]);
    expect(first).toEqual(second);
    expect(
      JSON.parse(await readFile(join(root, "heptalogos.bootstrap.json"), "utf8")),
    ).toEqual(first);
    expect(first.roots.PROGRAM).toBe(root);
    expect(first.roots.RUN).toBe(join(root, "run"));
  });

  it("preserves an existing identity and custom lifecycle roots byte for byte", async () => {
    const root = await anchor();
    const initial = await initializeProductInstallation(root);
    const existing = {
      ...initial,
      roots: { ...initial.roots, DATA: join(root, "retained-data") },
    };
    const text = JSON.stringify(existing);
    await writeFile(join(root, "heptalogos.bootstrap.json"), text);
    expect(await initializeProductInstallation(root)).toEqual(existing);
    expect(await readFile(join(root, "heptalogos.bootstrap.json"), "utf8")).toBe(text);
  });

  it("rejects an invalid existing locator without replacing it", async () => {
    const root = await anchor();
    const path = join(root, "heptalogos.bootstrap.json");
    await writeFile(path, "incomplete existing locator");
    await expect(initializeProductInstallation(root)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("incomplete existing locator");
  });

  it("rejects relative installation roots", async () => {
    await expect(initializeProductInstallation("relative-root")).rejects.toThrow(
      "absolute",
    );
  });
});
