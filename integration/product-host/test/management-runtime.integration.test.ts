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

suite("built Product Host management runtime", () => {
  it("replaces a stale descriptor and shuts down gracefully", async () => {
    fixture = await makeFixture(postgresBin!);
    running = await runHost(fixture);
    const stale = await readRunJson(fixture, "management-endpoint.json");
    await running.crash();
    running = undefined;
    expect(await readRunJson(fixture, "management-endpoint.json")).toEqual(stale);
    running = await runHost(fixture, { includeInitialPort: false });
    const current = await readRunJson(fixture, "management-endpoint.json");
    expect(current).not.toEqual(stale);
    expect((current as { bootId: string }).bootId).toBe(running.ready.bootId);
  });

  it("fails closed on credential recovery and enforces Host-fenced ACLs", async () => {
    fixture = await makeFixture(postgresBin!);
    running = await runHost(fixture);
    const runtimeKey = {
      service: "Heptalogos/" + fixture.installationId,
      account: "bootstrap/private-postgres-runtime-role",
    };
    const runtimePassword = await fixture.credentialStore.withCredential(
      runtimeKey,
      async (bytes) => new TextDecoder().decode(bytes),
    );
    const client = new Client({
      host: "127.0.0.1",
      port: fixture.postgresPort,
      database: "heptalogos",
      user: "heptalogos_runtime",
      password: runtimePassword,
    });
    await client.connect();
    await expect(
      client.query('INSERT INTO "heptalogos"."administrator" DEFAULT VALUES'),
    ).rejects.toBeDefined();
    await client.end();

    await running.stop();
    running = undefined;
    await fixture.credentialStore.delete(runtimeKey);
    const failed = await runHost(fixture, { includeInitialPort: false }).catch(
      (error: Error) => error,
    );
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toContain("bootstrap_credential_missing");
  });

  it("exposes generated-client discovery and the shipping boundary", async () => {
    fixture = await makeFixture(postgresBin!);
    running = await runHost(fixture);
    const local = await openLocalManagementClient({
      anchorRoot: fixture.anchorRoot,
      credentialStore: createOsCredentialStore(),
    });
    const discovery = await local.client.getDiscovery();
    expect(discovery.installationId).toBe(fixture.installationId);
    expect(discovery.compatibility.coreContractVersion).toBe("management.v1");
    expect(local.endpoint.origin).toBe(running.ready.origin);
  });

  it("preserves canonical Problem semantics across HTTP and generated client", async () => {
    fixture = await makeFixture(postgresBin!);
    running = await runHost(fixture);
    const client = createManagementClient({ origin: running.ready.origin });
    const assertProblem = (error: unknown, problemCode: string) => {
      expect(error).toBeInstanceOf(ManagementClientError);
      expect(error).toMatchObject({
        problem: {
          schemaVersion: 1,
          problemCode,
          category: expect.any(String),
          retryClass: expect.any(String),
          status: expect.any(Number),
          title: expect.any(String),
          detail: expect.any(String),
        },
      });
    };

    const invalidInput = await client
      .claimFirstAdministrator({
        claimId: "invalid",
        claimSecret: "invalid",
        password: "invalid",
      })
      .catch((error: unknown) => error);
    assertProblem(invalidInput, "management.first_claim_invalid");

    const invalidCredentials = await client
      .login({ password: "invalid-management-password" })
      .catch((error: unknown) => error);
    assertProblem(invalidCredentials, "management.invalid_credentials");

    let rateLimited: unknown;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      rateLimited = await client
        .claimFirstAdministrator({
          claimId: "invalid",
          claimSecret: "invalid",
          password: "invalid",
        })
        .catch((error: unknown) => error);
    }
    assertProblem(rateLimited, "management.rate_limited");

    const mismatch = await fetch(running.ready.origin + "/management/v1/readiness", {
      headers: { "x-heptalogos-contract-version": "management.v0" },
    });
    expect(mismatch.status).toBe(426);
    await expect(mismatch.json()).resolves.toMatchObject({
      schemaVersion: 1,
      problemCode: "management.contract_unsupported",
      category: "conflict",
      retryClass: "manual",
    });
  });
});
