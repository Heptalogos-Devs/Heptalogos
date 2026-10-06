// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { lstat, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInstallationId,
  createInstanceId,
  LIFECYCLE_ROOT_IDS,
  type LifecycleRootId,
} from "@heptalogos/foundation-contracts";
import { resolveBootstrapPathProfile } from "../../src/bootstrap/roots.js";
import { resolveRuntimeLocations } from "../../src/bootstrap/runtime-locations.js";
import type { BootstrapLocatorV1 } from "../../src/bootstrap/locator.js";

const directories: string[] = [];

async function makeDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function makeRoots(): Promise<Record<LifecycleRootId, string>> {
  const roots = {} as Record<LifecycleRootId, string>;
  for (const id of LIFECYCLE_ROOT_IDS) {
    roots[id] = await makeDirectory(`heptalogos-root-${id.toLowerCase()}-`);
  }
  return roots;
}

function makeLocator(roots: Record<LifecycleRootId, string>): BootstrapLocatorV1 {
  return {
    schemaVersion: 1,
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    roots,
  };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("bootstrap lifecycle roots", () => {
  it("resolves only explicitly requested roots", async () => {
    const roots = await makeRoots();
    roots.BACKUP = join(tmpdir(), "heptalogos-root-unrequested-backup");

    const profile = await resolveBootstrapPathProfile(makeLocator(roots), ["INSTANCE"]);

    expect(profile.list().map((root) => root.id)).toEqual(["INSTANCE"]);
    expect(profile.resolve("INSTANCE").canonicalPath).toBeDefined();
    let thrown: unknown;
    try {
      profile.resolve("BACKUP");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      problem: { problemCode: "bootstrap.root.not_resolved" },
    });
  });

  it("rejects an empty required-root set", async () => {
    const roots = await makeRoots();

    await expect(
      resolveBootstrapPathProfile(makeLocator(roots), []),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.root.empty_requirement" },
    });
  });

  it("resolves independent roots without assuming a common parent", async () => {
    const roots = await makeRoots();
    const profile = await resolveBootstrapPathProfile(
      makeLocator(roots),
      LIFECYCLE_ROOT_IDS,
    );

    expect(profile.resolve("DATA").canonicalPath).not.toBe(
      profile.resolve("CONFIGURATION").canonicalPath,
    );
    expect(profile.list()).toHaveLength(LIFECYCLE_ROOT_IDS.length);
    expect(profile.list().map((root) => root.id)).toEqual([...LIFECYCLE_ROOT_IDS]);
  });

  it("projects repository and Product bootstrap modes through one location contract", async () => {
    const roots = await makeRoots();
    const profile = await resolveBootstrapPathProfile(
      makeLocator(roots),
      LIFECYCLE_ROOT_IDS,
    );

    expect(resolveRuntimeLocations(profile)).toEqual({
      configRoot: profile.resolve("CONFIGURATION").canonicalPath,
      stateRoot: profile.resolve("DATA").canonicalPath,
      cacheRoot: profile.resolve("CACHE").canonicalPath,
      runRoot: profile.resolve("RUN").canonicalPath,
    });
  });

  it("rejects a configured root that does not exist", async () => {
    const roots = await makeRoots();
    roots.DATA = join(tmpdir(), "heptalogos-root-does-not-exist");

    await expect(
      resolveBootstrapPathProfile(makeLocator(roots), LIFECYCLE_ROOT_IDS),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.root.not_found" },
    });
  });

  it("rejects a configured root that is a regular file", async () => {
    const roots = await makeRoots();
    const file = join(await makeDirectory("heptalogos-root-file-parent-"), "root-file");
    await writeFile(file, "not a directory");
    roots.DATA = file;

    await expect(
      resolveBootstrapPathProfile(makeLocator(roots), LIFECYCLE_ROOT_IDS),
    ).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.root.not_directory" },
    });
  });

  it.runIf(process.platform !== "win32")(
    "rejects a configured POSIX symlink root",
    async () => {
      const roots = await makeRoots();
      const target = await makeDirectory("heptalogos-root-symlink-target-");
      const parent = await makeDirectory("heptalogos-root-symlink-parent-");
      const link = join(parent, "root-link");
      await symlink(target, link);
      roots.DATA = link;

      await expect(
        resolveBootstrapPathProfile(makeLocator(roots), LIFECYCLE_ROOT_IDS),
      ).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.root.link_rejected" },
      });
    },
  );

  it.runIf(process.platform === "win32")(
    "rejects a configured Windows junction root",
    async () => {
      const roots = await makeRoots();
      const target = await makeDirectory("heptalogos-root-junction-target-");
      const parent = await makeDirectory("heptalogos-root-junction-parent-");
      const link = join(parent, "root-junction");
      await symlink(target, link, "junction");
      roots.DATA = link;

      const entry = await lstat(link);
      expect(entry.isSymbolicLink()).toBe(true);
      await expect(
        resolveBootstrapPathProfile(makeLocator(roots), LIFECYCLE_ROOT_IDS),
      ).rejects.toMatchObject({
        problem: { problemCode: "bootstrap.root.link_rejected" },
      });
    },
  );

  it("does not create files or directories while resolving roots", async () => {
    const roots = await makeRoots();
    const before = await Promise.all(
      LIFECYCLE_ROOT_IDS.map(async (id) => [id, await readdir(roots[id])] as const),
    );

    await resolveBootstrapPathProfile(makeLocator(roots), LIFECYCLE_ROOT_IDS);

    const after = await Promise.all(
      LIFECYCLE_ROOT_IDS.map(async (id) => [id, await readdir(roots[id])] as const),
    );
    expect(after).toEqual(before);
  });
});
