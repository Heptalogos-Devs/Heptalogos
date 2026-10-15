// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLocalManagementClient } from "../../src/local.js";

const installationId = "0199e800-0000-7000-8000-000000000001";
const otherInstallationId = "0199e800-0000-7000-8000-000000000002";
const bootId = "0199e800-0000-7000-8000-000000000003";
const otherBootId = "0199e800-0000-7000-8000-000000000004";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(
  locatorId: unknown = installationId,
  endpointId = installationId,
) {
  const anchorRoot = await mkdtemp(join(tmpdir(), "management-identity-"));
  roots.push(anchorRoot);
  const runRoot = join(anchorRoot, "run");
  await mkdir(runRoot);
  await writeFile(
    join(anchorRoot, "heptalogos.bootstrap.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId: locatorId,
      roots: { RUN: runRoot },
    }),
  );
  await writeFile(
    join(runRoot, "management-endpoint.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId: endpointId,
      bootId,
      origin: "http://127.0.0.1:33333",
    }),
  );
  return anchorRoot;
}

function discoveryFetch(identity = installationId, boot = bootId) {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          installationId: identity,
          bootId: boot,
          apiBasePath: "/v1",
          contractVersion: "management.v1",
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
}

describe("local Management installation identity", () => {
  it("accepts a locator, endpoint and live discovery for the same installation", async () => {
    const local = await openLocalManagementClient({
      anchorRoot: await fixture(),
      fetch: discoveryFetch(),
    });
    expect(local.installationId).toBe(installationId);
  });

  it("rejects an endpoint for another installation before contacting it", async () => {
    const fetch = discoveryFetch(otherInstallationId);
    await expect(
      openLocalManagementClient({
        anchorRoot: await fixture(installationId, otherInstallationId),
        fetch,
      }),
    ).rejects.toThrow("does not match the installation locator");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a locator without a valid installation identity", async () => {
    const fetch = discoveryFetch();
    await expect(
      openLocalManagementClient({ anchorRoot: await fixture("invalid"), fetch }),
    ).rejects.toThrow("locator is invalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [otherInstallationId, bootId],
    [installationId, otherBootId],
  ])(
    "rejects a live identity that disagrees with its descriptor (%s, %s)",
    async (identity, boot) => {
      await expect(
        openLocalManagementClient({
          anchorRoot: await fixture(),
          fetch: discoveryFetch(identity, boot),
        }),
      ).rejects.toThrow("does not match the endpoint descriptor");
    },
  );
});
