// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { operateInstalledService, readInstalledServices } from "../../src/services.js";

const mocks = vi.hoisted(() => ({ systemctl: vi.fn(), discovery: vi.fn() }));
vi.mock("execa", () => ({ execa: mocks.systemctl }));
vi.mock("@heptalogos/management-client/node", () => ({
  openLocalManagementClient: mocks.discovery,
}));
const installationId = "0199e800-0000-7000-8000-000000000001";
const directories: string[] = [];
const actualPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
async function fixture(hostUnit = `heptalogos-${installationId}-host.service`) {
  const root = await mkdtemp(join(tmpdir(), "heptalogos-services-"));
  directories.push(root);
  const configuration = join(root, "configuration");
  await mkdir(configuration);
  await writeFile(
    join(root, "heptalogos.bootstrap.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId,
      roots: { CONFIGURATION: configuration },
    }),
  );
  await writeFile(
    join(configuration, "installation-services.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId,
      services: {
        host: { unit: hostUnit, configured: true },
        subject: {
          unit: `heptalogos-${installationId}-subject.service`,
          configured: false,
        },
        maintenance: {
          unit: `heptalogos-${installationId}-maintenance.service`,
          configured: false,
        },
      },
    }),
  );
  return root;
}
beforeEach(() => {
  // These tests exercise the Linux systemd adapter through a mocked command.
  Object.defineProperty(process, "platform", { ...actualPlatform, value: "linux" });
  vi.clearAllMocks();
  mocks.discovery.mockResolvedValue({});
  mocks.systemctl.mockImplementation(async (_command, args) => ({
    exitCode: 0,
    timedOut: false,
    stdout: args.includes("show")
      ? "LoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0"
      : "",
  }));
});
afterEach(async () => {
  Object.defineProperty(process, "platform", actualPlatform);
  await Promise.all(
    directories.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("installed service lifecycle", () => {
  it.each(["darwin", "win32"])(
    "rejects systemd operations on %s before reading descriptors or invoking commands",
    async (platform) => {
      Object.defineProperty(process, "platform", {
        ...actualPlatform,
        value: platform,
      });
      await expect(
        operateInstalledService("unread-descriptor", "host", "start"),
      ).rejects.toMatchObject({
        problemCode: "installation.service_platform_unsupported",
      });
      expect(mocks.systemctl).not.toHaveBeenCalled();
      expect(mocks.discovery).not.toHaveBeenCalled();
    },
  );
  it("rejects unrelated unit names even in a modified descriptor", async () => {
    await expect(
      readInstalledServices(await fixture("some-other-service.service")),
    ).rejects.toMatchObject({ problemCode: "installation.services_invalid" });
    expect(mocks.systemctl).not.toHaveBeenCalled();
  });
  it("stops only the Host unit without contacting Management or the maintenance unit", async () => {
    const result = await operateInstalledService(await fixture(), "host", "stop");
    expect(result).toMatchObject({ state: "inactive", mainPid: 0 });
    expect(mocks.systemctl.mock.calls[0]).toEqual([
      "systemctl",
      ["--user", "--no-pager", "stop", `heptalogos-${installationId}-host.service`],
      { timeout: 55_000, reject: false },
    ]);
    expect(JSON.stringify(mocks.systemctl.mock.calls)).not.toContain("maintenance");
    expect(mocks.discovery).not.toHaveBeenCalled();
  });
  it("reports a maintenance slot as unconfigured with the Host offline", async () => {
    const root = await fixture();
    await expect(
      operateInstalledService(root, "maintenance", "status"),
    ).resolves.toMatchObject({ state: "unconfigured", component: "maintenance" });
    await expect(
      operateInstalledService(root, "maintenance", "start"),
    ).rejects.toMatchObject({ problemCode: "installation.gateway_unconfigured" });
    expect(mocks.systemctl).not.toHaveBeenCalled();
    expect(mocks.discovery).not.toHaveBeenCalled();
  });
  it("waits for the matching Management endpoint after service start", async () => {
    await operateInstalledService(await fixture(), "host", "start");
    expect(mocks.discovery).toHaveBeenCalledOnce();
  });
  it("reports a missing registered unit instead of presenting it as a stopped installation", async () => {
    mocks.systemctl.mockResolvedValue({
      exitCode: 0,
      timedOut: false,
      stdout: "LoadState=not-found\nActiveState=inactive\nMainPID=0",
    });
    await expect(
      operateInstalledService(await fixture(), "host", "status"),
    ).rejects.toMatchObject({ problemCode: "installation.service_unavailable" });
  });
  it("surfaces a bounded service-manager failure without claiming a successful stop", async () => {
    mocks.systemctl.mockResolvedValue({ exitCode: 1, timedOut: true, stdout: "" });
    await expect(
      operateInstalledService(await fixture(), "host", "stop"),
    ).rejects.toMatchObject({
      problemCode: "installation.service_failed",
      exitCode: 7,
    });
  });
});

it("generates a draining Host unit without lifecycle coupling to Gateway slots", async () => {
  const { managementServiceUnit } = await import(
    pathToFileURL(resolve("scripts/package/install-linux-product.mjs")).href
  );
  const unit = managementServiceUnit({
    node: "/private/node",
    host: "/private/host.js",
    anchorRoot: "/private/root with $ and %",
    postgresBin: "/private/postgres/bin",
    initialPostgresPort: 12345,
  });
  expect(unit).toContain('"/private/root with $$ and %%"');
  expect(unit).toContain("WorkingDirectory=/private/root with $ and %%\n");
  expect(unit).toContain("TimeoutStopSec=45s");
  expect(unit).toContain("KillMode=mixed");
  expect(unit).not.toMatch(/PartOf=|Requires=|BindsTo=|maintenance|subject/u);
});
