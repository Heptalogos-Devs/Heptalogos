// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { createUuidV7Id } from "@heptalogos/foundation-contracts";
import { createOsCredentialStore } from "@heptalogos/os-credential";
import {
  createManagementClient,
  ManagementClientError,
  type SystemActionRequestInput,
} from "../../../packages/application/management-client/dist/index.js";
import { openLocalManagementClient } from "../../../packages/application/management-client/dist/node.js";
import {
  makeFixture,
  readRunJson,
  runCli,
  runHost,
  type ProductHostFixture,
  type RunningHost,
} from "../support/fixture.js";
import { createSubjectGatewayFixture } from "../support/subject-gateway-fixture.js";
import {
  cleanupIntegration,
  holdSubjectAuthorityLock,
  holdWorkItemLock,
  readSubjectFactSnapshot,
  readSubjectRuntimeDescriptor,
} from "../support/test-helpers.js";

const postgresBin = process.env.HEPTALOGOS_TEST_PG_BIN;
const suite = postgresBin === undefined ? describe.skip : describe;
let fixture: ProductHostFixture | undefined;
let running: RunningHost | undefined;
let subjectGateway: Awaited<ReturnType<typeof createSubjectGatewayFixture>> | undefined;

afterEach(async () => {
  await cleanupIntegration({ fixture, running, subjectGateway });
  fixture = undefined;
  running = undefined;
  subjectGateway = undefined;
});

suite("built Product Host management authentication", () => {
  it("starts a fresh Host, exposes client and CLI reads, and preserves restart identity", async () => {
    fixture = await makeFixture(postgresBin!);
    running = await runHost(fixture);
    expect(running.ready.installationId).toBe(fixture.installationId);
    expect(running.ready.productGeneration).toMatch(/^[0-9a-f]{64}$/u);
    expect(running.ready.bootstrapRuntimeGeneration).toMatch(/^[0-9a-f]{64}$/u);
    const endpoint = (await readRunJson(fixture, "management-endpoint.json")) as {
      origin: string;
      bootId: string;
    };
    const claim = (await readRunJson(fixture, "management-first-claim.json")) as {
      claimId: string;
      claimSecret: string;
    };
    expect(endpoint.origin).toBe(running.ready.origin);
    expect(claim.claimSecret).toHaveLength(43);

    const password = "Administrator-password-012345";
    const claimed = await runCli(
      fixture,
      ["admin", "claim", "--password-stdin", "--json"],
      password + "\r\n",
    );
    expect(claimed.code).toBe(0);
    expect(JSON.parse(claimed.stdout)).toHaveProperty("administratorId");
    expect(claimed.stdout).not.toContain(claim.claimSecret);

    const replayClient = createManagementClient({ origin: running.ready.origin });
    await expect(
      replayClient.claimFirstAdministrator({
        claimId: claim.claimId,
        claimSecret: claim.claimSecret,
        password,
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "management.first_claim_consumed" },
    });

    const login = await runCli(
      fixture,
      ["auth", "login", "--password-stdin", "--json"],
      password + "\n",
    );
    expect(login.code).toBe(0);
    const loginJson = JSON.parse(login.stdout) as Record<string, unknown>;
    expect(loginJson.authenticated).toBe(true);
    expect(login.stdout).not.toMatch(/[A-Za-z0-9_-]{43}/u);

    const sessionLocal = await openLocalManagementClient({
      anchorRoot: fixture.anchorRoot,
      credentialStore: fixture.credentialStore,
    });
    const sessionToken = await sessionLocal.readSessionToken();
    expect(sessionToken).toBeDefined();
    const authenticated = await openLocalManagementClient({
      anchorRoot: fixture.anchorRoot,
      sessionToken,
      credentialStore: fixture.credentialStore,
    });
    for (const read of [
      authenticated.client.getSystemStatus(),
      authenticated.client.getHost(),
      authenticated.client.getRuntimeGraph(),
      authenticated.client.getCapabilityGraph(),
      authenticated.client.getReadiness(),
    ]) {
      await expect(read).resolves.toMatchObject({
        schemaVersion: 1,
        contractVersion: "management.v1",
        resource: { schemaVersion: 1 },
        productGeneration: running.ready.productGeneration,
        data: { schemaVersion: 1 },
      });
    }

    for (const command of [
      ["contract"],
      ["status"],
      ["host", "status"],
      ["runtime", "graph"],
      ["capability", "graph"],
      ["readiness"],
    ]) {
      const result = await runCli(fixture, [...command, "--json"]);
      expect(result.code, result.stderr).toBe(0);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    }
    const logout = await runCli(fixture, ["auth", "logout", "--json"]);
    expect(logout.code).toBe(0);

    const firstBootId = running.ready.bootId;
    const firstGeneration = running.ready.productGeneration;
    await running.stop();
    running = await runHost(fixture, { includeInitialPort: false });
    expect(running.ready.bootId).not.toBe(firstBootId);
    expect(running.ready.productGeneration).toBe(firstGeneration);
    expect(running.ready.installationId).toBe(fixture.installationId);
    await expect(
      readRunJson(fixture, "management-first-claim.json"),
    ).rejects.toBeDefined();
  });
});
