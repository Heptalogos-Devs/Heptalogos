// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createManagementClient } from "../../../packages/application/management-client/dist/index.js";
import { openLocalManagementClient } from "../../../packages/application/management-client/dist/node.js";
import {
  makeFixture,
  readRunJson,
  runCli,
  runHost,
  type ProductHostFixture,
  type RunningHost,
} from "../support/fixture.js";
import { cleanupIntegration } from "../support/test-helpers.js";

const postgresBin = process.env.HEPTALOGOS_TEST_PG_BIN;
const suite = postgresBin === undefined ? describe.skip : describe;
let fixture: ProductHostFixture | undefined;
let running: RunningHost | undefined;
afterEach(async () => {
  await cleanupIntegration({ fixture, running });
  fixture = undefined;
  running = undefined;
});

suite("built Management Host authentication and configuration", () => {
  it("claims, logs in, enforces CAS, and preserves identity/configuration over restart without an agent runtime", async () => {
    fixture = await makeFixture(postgresBin!);
    running = await runHost(fixture);
    expect(running.ready.installationId).toBe(fixture.installationId);
    expect(running.ready.productGeneration).toMatch(/^[0-9a-f]{64}$/u);
    const claim = (await readRunJson(fixture, "management-first-claim.json")) as {
      claimId: string;
      claimSecret: string;
    };
    const anonymous = createManagementClient({ origin: running.ready.origin });
    await expect(anonymous.getStatus()).rejects.toMatchObject({ status: 401 });
    const password = "Management-integration-password-2026!";
    const claimed = await runCli(
      fixture,
      ["admin", "claim", "--password-stdin", "--json"],
      password + "\r\n",
    );
    expect(claimed.code, claimed.stderr || claimed.stdout).toBe(0);
    expect(JSON.parse(claimed.stdout)).toHaveProperty("administratorId");
    expect(claimed.stdout).not.toContain(claim.claimSecret);
    await expect(
      anonymous.claimFirstAdministrator({ ...claim, password }),
    ).rejects.toMatchObject({ status: 409 });
    const login = await runCli(
      fixture,
      ["auth", "login", "--password-stdin", "--json"],
      password + "\n",
    );
    expect(login.code, login.stderr).toBe(0);
    expect(JSON.parse(login.stdout)).toMatchObject({ authenticated: true });
    expect(login.stdout).not.toContain(password);
    const local = await openLocalManagementClient({
      anchorRoot: fixture.anchorRoot,
      credentialStore: fixture.credentialStore,
    });
    const sessionToken = await local.readSessionToken();
    expect(sessionToken).toBeDefined();
    const client = createManagementClient({
      origin: running.ready.origin,
      sessionToken,
    });
    expect(await client.getStatus()).toMatchObject({
      management: "available",
      subject: { id: null, enabled: false },
    });
    const settings = {
      nous: {
        runRoot: join(fixture.roots.RUN, "not-installed-nous"),
        expectedInstanceId: null,
      },
      subject: { id: null, enabled: false },
      subjectGateway: { origin: "http://127.0.0.1:1" },
      maintenanceGateway: { origin: "http://127.0.0.1:2" },
    };
    const initial = await client.configure({ expectedRevision: null, settings });
    expect(initial.revision).toBeTypeOf("string");
    const competing = await Promise.allSettled([
      client.configure({ expectedRevision: initial.revision, settings }),
      client.configure({ expectedRevision: initial.revision, settings }),
    ]);
    expect(competing.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = competing.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { status: 409 } });
    const committed = await client.getConfiguration();
    expect(committed.settings).toEqual(settings);
    const status = await client.getStatus();
    expect(status.management).toBe("available");
    expect(
      status.dependencies.every((dependency) => dependency.state !== "available"),
    ).toBe(true);
    for (const args of [
      ["contract"],
      ["status"],
      ["config", "get"],
      ["config", "describe"],
    ]) {
      const result = await runCli(fixture, [...args, "--json"]);
      expect(result.code, result.stderr).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }
    const firstBoot = running.ready.bootId;
    await running.stop();
    running = await runHost(fixture, { includeInitialPort: false });
    expect(running.ready.bootId).not.toBe(firstBoot);
    expect(running.ready.installationId).toBe(fixture.installationId);
    const restored = createManagementClient({
      origin: running.ready.origin,
      sessionToken,
    });
    expect(await restored.getConfiguration()).toEqual(committed);
    await expect(
      readRunJson(fixture, "management-first-claim.json"),
    ).rejects.toBeDefined();
    const logout = await runCli(fixture, ["auth", "logout", "--json"]);
    expect(logout.code, logout.stderr).toBe(0);
    await expect(restored.getStatus()).rejects.toMatchObject({ status: 401 });
  });
});
