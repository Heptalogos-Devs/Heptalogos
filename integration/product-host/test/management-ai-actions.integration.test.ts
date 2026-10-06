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

suite("built Product Host management AI actions", () => {
  it("configures Chat and Responses gateway routes through plan/execute and preserves them on restart", async () => {
    fixture = await makeFixture(postgresBin!);
    running = await runHost(fixture);

    const password = "Administrator-provider-012345";
    const claim = (await readRunJson(fixture, "management-first-claim.json")) as {
      claimId: string;
      claimSecret: string;
    };
    const claimed = await runCli(
      fixture,
      ["admin", "claim", "--password-stdin", "--json"],
      password + "\n",
    );
    expect(claimed.code, claimed.stderr).toBe(0);
    const login = await runCli(
      fixture,
      ["auth", "login", "--password-stdin", "--json"],
      password + "\n",
    );
    expect(login.code, login.stderr).toBe(0);
    expect(claim.claimId).toMatch(/[0-9a-f-]{36}/u);
    expect(claim.claimSecret).toHaveLength(43);

    const local = await openLocalManagementClient({
      anchorRoot: fixture.anchorRoot,
      credentialStore: fixture.credentialStore,
    });
    const sessionToken = await local.readSessionToken();
    expect(sessionToken).toBeDefined();
    const authenticatedLocal = await openLocalManagementClient({
      anchorRoot: fixture.anchorRoot,
      sessionToken,
      credentialStore: fixture.credentialStore,
    });
    const client = authenticatedLocal.client;
    const applyAction = async (action: SystemActionRequestInput) => {
      const plan = await client.planSystemAction(action);
      const executed = await client.executeSystemAction({ plan, action });
      expect(executed.postconditionsVerified).toBe(true);
      return executed;
    };

    const transportValue = {
      schemaVersion: 1 as const,
      timeoutMs: 60_000,
      requestBodyBudgetBytes: 60_000,
      responseBodyBudgetBytes: 1_048_576,
    };
    const configurationAction = {
      actionId: "configuration.revision.create" as const,
      input: {
        definitionId: "ai.gateway.transport.v1" as const,
        scopeRef: {
          schemaVersion: 1 as const,
          resourceKind: "installation",
          resourceId: fixture.installationId,
        },
        value: transportValue,
      },
    };
    const actionCatalog = await runCli(fixture, ["action", "catalog", "--json"]);
    expect(actionCatalog.code, actionCatalog.stderr).toBe(0);
    expect(JSON.parse(actionCatalog.stdout)).toHaveLength(10);
    const cliPlan = await runCli(
      fixture,
      ["action", "plan", "--input-stdin", "--json"],
      JSON.stringify(configurationAction),
    );
    expect(cliPlan.code, cliPlan.stderr).toBe(0);
    expect(JSON.parse(cliPlan.stdout)).not.toHaveProperty("input");
    const configurationPlan = await client.planSystemAction(configurationAction);
    expect(configurationPlan.affectedSemanticOwners).toEqual([
      "system.configuration",
      "system.network-access",
    ]);
    expect(configurationPlan.configurationReadinessSubjectImpact).toMatchObject({
      configurationDefinitionId: "ai.gateway.transport.v1",
      activation: "LIVE",
      consumerRefs: ["system.network-access", "system.ai-runtime"],
      effective: "after-activation",
    });
    expect(configurationPlan.restartReconcileImpact).toMatchObject({
      restartRequired: false,
      activation: "LIVE",
      reconciliation: "staged-until-activation",
    });
    const configurationExecution = await client.executeSystemAction({
      plan: configurationPlan,
      action: configurationAction,
    });
    expect(configurationExecution.postconditionsVerified).toBe(true);
    const configured = (await client.getProductState()) as any;
    const revision = configured.data.configuration.revisions.find(
      (candidate: any) => candidate.definitionId === "ai.gateway.transport.v1",
    ) as {
      revisionId: string;
    };
    expect(revision.revisionId).toMatch(/[0-9a-f-]{36}/u);

    await applyAction({
      actionId: "configuration.activate",
      input: { revisionId: revision.revisionId },
    });

    const gatewayProfileId = createUuidV7Id("GatewayProfileId");
    await applyAction({
      actionId: "gateway-profile.set",
      input: {
        gatewayProfileId,
        baseUrl: "https://gateway.example.com/v1/",
        enabled: false,
      },
    });
    const disabled = await client.getProductState();
    expect(disabled.data.gatewayProfiles[0]).toMatchObject({
      gatewayProfileId,
      baseUrl: "https://gateway.example.com/v1",
      enabled: false,
    });
    expect(disabled.data.aiReadiness).toMatchObject({ state: "BLOCKED" });

    const immutableGatewayAction = {
      actionId: "gateway-profile.set" as const,
      input: {
        gatewayProfileId,
        baseUrl: "https://another-gateway.example.com/v1",
        enabled: false,
      },
    };
    const immutableGatewayPlan = await client.planSystemAction(immutableGatewayAction);
    await expect(
      client.executeSystemAction({
        plan: immutableGatewayPlan,
        action: immutableGatewayAction,
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "ai.gateway_destination_immutable" },
    });

    const submittedGatewayToken = "not-a-real-gateway-token";
    const secretAction = {
      actionId: "secret.set" as const,
      input: {
        purpose: "ai.gateway.bearer-token",
        scopeRef: {
          schemaVersion: 1 as const,
          resourceKind: "gateway-profile",
          resourceId: gatewayProfileId,
        },
        material: submittedGatewayToken,
      },
    };
    const secretPlan = await client.planSystemAction(secretAction);
    expect(JSON.stringify(secretPlan)).not.toContain(submittedGatewayToken);
    await client.executeSystemAction({ plan: secretPlan, action: secretAction });
    const withSecret = await client.getProductState();
    const secret = withSecret.data.secrets[0] as { secretId: string };

    await applyAction({
      actionId: "gateway-profile.set",
      input: {
        gatewayProfileId,
        baseUrl: "https://gateway.example.com/v1",
        apiTokenSecretRef: { schemaVersion: 1, secretId: secret.secretId },
        enabled: true,
      },
    });

    const chatModelProfileId = createUuidV7Id("ModelProfileId");
    const modelCapabilities = [
      "text-generation",
      "structured-output",
      "usage-metadata",
      "abort-timeout",
    ] as Array<
      "text-generation" | "structured-output" | "usage-metadata" | "abort-timeout"
    >;
    const chatModelInput = {
      modelProfileId: chatModelProfileId,
      gatewayProfileId,
      modelIdentifier: "deepseek-chat",
      protocol: "openai-chat" as const,
      consumedCapabilities: modelCapabilities,
    };
    await applyAction({ actionId: "model-profile.set", input: chatModelInput });

    const responsesModelProfileId = createUuidV7Id("ModelProfileId");
    const responsesModelInput = {
      modelProfileId: responsesModelProfileId,
      gatewayProfileId,
      modelIdentifier: "deepseek-responses",
      protocol: "openai-responses" as const,
      consumedCapabilities: modelCapabilities,
    };
    await applyAction({
      actionId: "model-profile.set",
      input: responsesModelInput,
    });
    await applyAction({
      actionId: "model-binding.set",
      input: { role: "subject.primary", modelProfileId: chatModelProfileId },
    });
    await applyAction({
      actionId: "model-binding.set",
      input: {
        role: "subject.expression",
        modelProfileId: responsesModelProfileId,
      },
    });
    const ready = await client.getProductState();
    expect(ready.data.aiReadiness).toMatchObject({ state: "READY", blockers: [] });

    const staleAction = {
      actionId: "model-binding.set" as const,
      input: {
        role: "subject.primary" as const,
        modelProfileId: chatModelProfileId,
      },
    };
    const stalePlan = await client.planSystemAction(staleAction);
    await applyAction({
      actionId: "model-binding.set",
      input: {
        role: "subject.primary",
        modelProfileId: responsesModelProfileId,
      },
    });
    await expect(
      client.executeSystemAction({ plan: stalePlan, action: staleAction }),
    ).rejects.toMatchObject({
      problem: { problemCode: "management.plan_conflict" },
    });

    await running.stop();
    running = await runHost(fixture, { includeInitialPort: false });
    const restartedLocal = await openLocalManagementClient({
      anchorRoot: fixture.anchorRoot,
      credentialStore: fixture.credentialStore,
    });
    const restartedToken = await restartedLocal.readSessionToken();
    expect(restartedToken).toBeDefined();
    const restartedAuthenticated = await openLocalManagementClient({
      anchorRoot: fixture.anchorRoot,
      sessionToken: restartedToken,
      credentialStore: fixture.credentialStore,
    });
    const restarted = await restartedAuthenticated.client.getProductState();
    expect(restarted.data.configuration.revisions).toHaveLength(4);
    expect(restarted.data.configuration.activations).toHaveLength(4);
    expect(restarted.data.gatewayProfiles).toHaveLength(1);
    expect(restarted.data.secrets).toHaveLength(1);
    expect(restarted.data.modelProfiles).toHaveLength(2);
    expect(restarted.data.modelBindings).toHaveLength(2);
    expect(restarted.data.aiReadiness).toMatchObject({ state: "READY" });
  });
});
