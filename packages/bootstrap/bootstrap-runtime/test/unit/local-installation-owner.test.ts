// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { chmod, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInstallationId,
  createInstanceId,
  LIFECYCLE_ROOT_IDS,
} from "@heptalogos/foundation-contracts";
import type { BootstrapLocatorV1 } from "../../src/bootstrap/locator.js";
import {
  assertLocalInstallationOwnerFor,
  proveLocalInstallationOwner,
} from "../../src/bootstrap/local-installation-owner.js";
import { resolveBootstrapPathProfile } from "../../src/bootstrap/roots.js";

const directories: string[] = [];

async function makeFixture() {
  const anchorRoot = await mkdtemp(join(tmpdir(), "heptalogos-recovery-anchor-"));
  directories.push(anchorRoot);
  const roots = {} as Record<(typeof LIFECYCLE_ROOT_IDS)[number], string>;
  for (const id of LIFECYCLE_ROOT_IDS) {
    if (id === "PROGRAM") {
      roots[id] = anchorRoot;
      continue;
    }
    const root = await mkdtemp(
      join(tmpdir(), `heptalogos-recovery-${id.toLowerCase()}-`),
    );
    directories.push(root);
    roots[id] = root;
  }
  const locator: BootstrapLocatorV1 = {
    schemaVersion: 1,
    installationId: createInstallationId(),
    instanceId: createInstanceId(),
    roots,
  };
  await writeFile(
    join(anchorRoot, "heptalogos.bootstrap.json"),
    JSON.stringify(locator),
  );
  return { anchorRoot, locator, roots };
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("LOCAL_INSTALLATION_OWNER recovery principal", () => {
  it("proves ownership when unrelated lifecycle roots are unavailable", async () => {
    const fixture = await makeFixture();
    const roots = {
      ...fixture.locator.roots,
      BACKUP: join(tmpdir(), "heptalogos-unavailable-backup"),
      CACHE: join(tmpdir(), "heptalogos-unavailable-cache"),
      PACKAGE_STAGING: join(tmpdir(), "heptalogos-unavailable-package-staging"),
    };
    await writeFile(
      join(fixture.anchorRoot, "heptalogos.bootstrap.json"),
      JSON.stringify({ ...fixture.locator, roots }),
    );

    const principal = await proveLocalInstallationOwner(fixture.anchorRoot);

    expect(principal).toMatchObject({
      kind: "LOCAL_INSTALLATION_OWNER",
      instanceId: fixture.locator.instanceId,
    });
  });

  it("proves and scopes an authentic local installation owner", async () => {
    const fixture = await makeFixture();
    const principal = await proveLocalInstallationOwner(fixture.anchorRoot);

    expect(principal).toMatchObject({
      kind: "LOCAL_INSTALLATION_OWNER",
      installationId: fixture.locator.installationId,
      instanceId: fixture.locator.instanceId,
    });
    const paths = await resolveBootstrapPathProfile(fixture.locator, ["INSTANCE"]);
    expect(() =>
      assertLocalInstallationOwnerFor(
        principal,
        fixture.locator.installationId,
        fixture.locator.instanceId,
        paths.resolve("INSTANCE").canonicalPath,
      ),
    ).not.toThrow();
  });

  it("rejects a shape-compatible forged principal", async () => {
    const fixture = await makeFixture();
    const forged = {
      kind: "LOCAL_INSTALLATION_OWNER" as const,
      installationId: fixture.locator.installationId,
      instanceId: fixture.locator.instanceId,
    };

    let thrown: unknown;
    try {
      assertLocalInstallationOwnerFor(
        forged,
        fixture.locator.installationId,
        fixture.locator.instanceId,
        fixture.roots.INSTANCE,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      problem: { problemCode: "bootstrap.recovery.invalid_principal" },
    });
  });

  it("rejects a principal used for another instance", async () => {
    const first = await makeFixture();
    const second = await makeFixture();
    const principal = await proveLocalInstallationOwner(first.anchorRoot);

    let thrown: unknown;
    try {
      assertLocalInstallationOwnerFor(
        principal,
        second.locator.installationId,
        second.locator.instanceId,
        second.roots.INSTANCE,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      problem: { problemCode: "bootstrap.recovery.scope_mismatch" },
    });
  });

  it.runIf(process.platform !== "win32" && process.geteuid?.() !== 0)(
    "rejects an INSTANCE root without write permission",
    async () => {
      const fixture = await makeFixture();
      await chmod(fixture.roots.INSTANCE, 0o555);
      try {
        await expect(
          proveLocalInstallationOwner(fixture.anchorRoot),
        ).rejects.toMatchObject({
          problem: { problemCode: "bootstrap.recovery.write_probe_failed" },
        });
      } finally {
        await chmod(fixture.roots.INSTANCE, 0o755);
      }
    },
  );

  it("rejects an anchor symlink instead of accepting an alias", async () => {
    const fixture = await makeFixture();
    const parent = await mkdtemp(join(tmpdir(), "heptalogos-recovery-alias-"));
    directories.push(parent);
    const alias = join(parent, "anchor-alias");
    await symlink(
      fixture.anchorRoot,
      alias,
      process.platform === "win32" ? "junction" : undefined,
    );

    await expect(proveLocalInstallationOwner(alias)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.recovery.anchor_link_rejected" },
    });
  });

  it("removes the exclusive proof file before returning", async () => {
    const fixture = await makeFixture();
    await proveLocalInstallationOwner(fixture.anchorRoot);

    const names = await readdir(fixture.roots.INSTANCE);
    expect(
      names.some((name) => name.startsWith(".heptalogos-recovery-owner-probe-")),
    ).toBe(false);
  });
});
