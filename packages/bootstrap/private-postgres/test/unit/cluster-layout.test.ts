// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { access, mkdtemp, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  classifyClusterDirectory,
  resolvePrivatePostgresPlacement,
} from "../../src/cluster-layout.js";

describe("private PostgreSQL cluster layout", () => {
  it("resolves exactly DATA/private-postgres", () => {
    const dataRoot = resolve(tmpdir(), "heptalogos-layout-data");
    expect(resolvePrivatePostgresPlacement(dataRoot)).toEqual({
      rootId: "DATA",
      relativePath: "private-postgres",
      dataLayoutVersion: 1,
      canonicalDataDirectory: join(dataRoot, "private-postgres"),
    });
  });

  it("rejects a relative DATA root", () => {
    expect(() => resolvePrivatePostgresPlacement("relative/data")).toThrowError();
  });

  it("does not infer or create a common parent layout", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-data-"));
    const instanceRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-instance-"));
    const placement = resolvePrivatePostgresPlacement(dataRoot);

    expect(placement.canonicalDataDirectory).toBe(join(dataRoot, "private-postgres"));
    expect(placement.canonicalDataDirectory).not.toContain(instanceRoot);
    await expect(access(placement.canonicalDataDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("classifies an absent cluster directory without creating it", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-data-"));
    const target = join(dataRoot, "private-postgres");

    await expect(classifyClusterDirectory(target)).resolves.toEqual({
      kind: "ABSENT",
    });
    await expect(access(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("classifies an empty cluster directory", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-data-"));
    const target = join(dataRoot, "private-postgres");
    await mkdir(target);

    await expect(classifyClusterDirectory(target)).resolves.toEqual({
      kind: "EMPTY",
    });
  });

  it("classifies any non-empty target without treating PG_VERSION as ownership proof", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-data-"));
    const target = join(dataRoot, "private-postgres");
    await mkdir(target);
    await writeFile(join(target, "PG_VERSION"), "18\n");

    await expect(classifyClusterDirectory(target)).resolves.toEqual({
      kind: "NON_EMPTY",
      entryCountLowerBound: 1,
    });
  });

  it("does not enumerate more than needed to establish non-empty state", async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), "heptalogos-pg-data-"));
    const target = join(dataRoot, "private-postgres");
    await mkdir(target);
    await writeFile(join(target, "first"), "1");
    await writeFile(join(target, "second"), "2");

    await expect(classifyClusterDirectory(target)).resolves.toMatchObject({
      kind: "NON_EMPTY",
      entryCountLowerBound: 1,
    });
    await expect(readdir(target)).resolves.toHaveLength(2);
  });
});
