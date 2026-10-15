// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("retires prior portable application code without deleting current code or lifecycle state", async () => {
  const { retirePreviousProductPayloads } = await import(
    pathToFileURL(resolve("scripts/package/assemble-portable-product.mjs")).href
  );
  const root = await mkdtemp(join(tmpdir(), "heptalogos-portable-payloads-"));
  try {
    const current = "a".repeat(64);
    const previous = "b".repeat(64);
    for (const name of [current, previous]) {
      const directory = join(root, "program/product", name);
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "payload"), name);
    }
    await mkdir(join(root, "data"));
    await writeFile(join(root, "data/retained"), "retained");
    await retirePreviousProductPayloads(root, current);
    await expect(
      readFile(join(root, "program/product", previous, "payload")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      await readFile(join(root, "program/product", current, "payload"), "utf8"),
    ).toBe(current);
    expect(await readFile(join(root, "data/retained"), "utf8")).toBe("retained");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
