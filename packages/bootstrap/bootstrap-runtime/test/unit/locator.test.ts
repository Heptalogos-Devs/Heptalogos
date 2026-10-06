// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createInstallationId,
  createInstanceId,
  LIFECYCLE_ROOT_IDS,
  type InstallationId,
  type InstanceId,
  type LifecycleRootId,
} from "@heptalogos/foundation-contracts";
import { loadBootstrapLocator } from "../../src/bootstrap/locator.js";
import type { BootstrapLocatorV1 } from "../../src/bootstrap/locator.js";

const directories: string[] = [];

async function makeAnchor(): Promise<string> {
  const anchor = await mkdtemp(join(tmpdir(), "heptalogos-bootstrap-anchor-"));
  directories.push(anchor);
  return anchor;
}

function makeLocator(
  anchor: string,
  installationId: InstallationId = createInstallationId(),
  instanceId: InstanceId = createInstanceId(),
): BootstrapLocatorV1 {
  return {
    schemaVersion: 1,
    installationId,
    instanceId,
    roots: Object.fromEntries(LIFECYCLE_ROOT_IDS.map((id) => [id, anchor])) as Record<
      LifecycleRootId,
      string
    >,
  };
}

async function writeLocator(anchor: string, value: unknown): Promise<void> {
  await writeFile(
    join(anchor, "heptalogos.bootstrap.json"),
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("bootstrap locator", () => {
  it("loads a valid locator with every stable lifecycle root", async () => {
    const anchor = await makeAnchor();
    const locator = makeLocator(anchor);
    await writeLocator(anchor, locator);

    await expect(loadBootstrapLocator(anchor)).resolves.toEqual(locator);
  });

  it("rejects invalid JSON with a bounded Problem", async () => {
    const anchor = await makeAnchor();
    await writeLocator(anchor, '{"schemaVersion":');

    await expect(loadBootstrapLocator(anchor)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.locator.invalid_json" },
    });
  });

  it("rejects an unknown top-level field instead of dropping it", async () => {
    const anchor = await makeAnchor();
    await writeLocator(anchor, { ...makeLocator(anchor), surprise: true });

    await expect(loadBootstrapLocator(anchor)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.locator.invalid_schema" },
    });
  });

  it("rejects an unknown or missing lifecycle root key", async () => {
    const anchor = await makeAnchor();
    const locator = makeLocator(anchor);
    const { CONFIGURATION: _configuration, ...missingRoot } = locator.roots;

    await writeLocator(anchor, {
      ...locator,
      roots: { ...missingRoot, SURPRISE: anchor },
    });

    await expect(loadBootstrapLocator(anchor)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.locator.invalid_schema" },
    });
  });

  it("rejects a relative root path", async () => {
    const anchor = await makeAnchor();
    const locator = makeLocator(anchor);
    await writeLocator(anchor, {
      ...locator,
      roots: { ...locator.roots, DATA: "relative/data" },
    });

    await expect(loadBootstrapLocator(anchor)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.locator.relative_root" },
    });
  });

  it("rejects an invalid InstallationId", async () => {
    const anchor = await makeAnchor();
    await writeLocator(anchor, {
      ...makeLocator(anchor),
      installationId: "00000000-0000-4000-8000-000000000000",
    });

    await expect(loadBootstrapLocator(anchor)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.locator.invalid_installation_id" },
    });
  });

  it("rejects an invalid InstanceId", async () => {
    const anchor = await makeAnchor();
    await writeLocator(anchor, {
      ...makeLocator(anchor),
      instanceId: "banana",
    });

    await expect(loadBootstrapLocator(anchor)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.locator.invalid_instance_id" },
    });
  });

  it("rejects a PROGRAM root that is inconsistent with the supplied anchor", async () => {
    const anchor = await makeAnchor();
    const other = await makeAnchor();
    const locator = makeLocator(anchor);
    await writeLocator(anchor, {
      ...locator,
      roots: { ...locator.roots, PROGRAM: other },
    });

    await expect(loadBootstrapLocator(anchor)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.locator.program_root_mismatch" },
    });
  });

  it("reports a missing locator with a stable Problem", async () => {
    const anchor = await makeAnchor();

    await expect(loadBootstrapLocator(anchor)).rejects.toMatchObject({
      problem: { problemCode: "bootstrap.locator.not_found" },
    });
  });
});
