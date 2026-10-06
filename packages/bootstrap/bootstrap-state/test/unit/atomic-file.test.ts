// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeAtomicPublishedFile } from "../../src/atomic-file.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("writeAtomicPublishedFile", () => {
  it("atomically publishes the requested bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "heptalogos-atomic-file-"));
    directories.push(directory);
    const file = join(directory, "state.json");

    await writeAtomicPublishedFile(file, '{"revision":1}');
    await expect(readFile(file, "utf8")).resolves.toBe('{"revision":1}');
  });

  it("does not expose platform qualification state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "heptalogos-atomic-file-"));
    directories.push(directory);
    const file = join(directory, "state.json");

    await expect(writeAtomicPublishedFile(file, "{}")).resolves.toBeUndefined();
  });

  it.runIf(process.platform !== "win32")(
    "publishes through the containing-directory sync path on POSIX hosts",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "heptalogos-atomic-file-"));
      directories.push(directory);
      const file = join(directory, "state.json");

      await expect(writeAtomicPublishedFile(file, "{}")).resolves.toBeUndefined();
    },
  );

  it("keeps store and journal behind the crash-safe adapter", async () => {
    const [store, journal] = await Promise.all([
      readFile(new URL("../../src/store.ts", import.meta.url), "utf8"),
      readFile(new URL("../../src/journal.ts", import.meta.url), "utf8"),
    ]);

    expect(store).not.toContain('require("write-file-atomic")');
    expect(journal).not.toContain('require("write-file-atomic")');
    expect(store).toContain('from "./atomic-file.js"');
    expect(journal).toContain('from "./atomic-file.js"');
  });
});
