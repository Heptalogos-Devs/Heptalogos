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

suite("built Product Host Subject Chat", () => {
  it("applies Subject expression revisions to the real Expression consumer", async () => {
    fixture = await makeFixture(postgresBin!);
    subjectGateway = await createSubjectGatewayFixture();
    running = await runHost(fixture);

    const password = "Subject-config-password-012345";
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

    const local = await openLocalManagementClient({
      anchorRoot: fixture.anchorRoot,
      credentialStore: fixture.credentialStore,
    });
    const sessionToken = await local.readSessionToken();
    expect(sessionToken).toBeDefined();
    const authenticated = await openLocalManagementClient({
      anchorRoot: fixture.anchorRoot,
      sessionToken,
      credentialStore: fixture.credentialStore,
    });
    const client = authenticated.client;
    const applyAction = async (action: SystemActionRequestInput) => {
      const plan = await client.planSystemAction(action);
      const executed = await client.executeSystemAction({ plan, action });
      expect(executed.postconditionsVerified).toBe(true);
      return executed;
    };

    const initial = (await client.getProductState()) as any;
    expect(
      initial.data.configuration.definitions.map(
        (definition: any) => definition.definitionId,
      ),
    ).toEqual(
      expect.arrayContaining([
        "ai.gateway.transport.v1",
        "subject.cognition.runtime.v1",
        "subject.expression.v1",
        "management.http.admission.v1",
      ]),
    );
    const subjectBeforeStart = initial.data.subject;
    const subjectScope = {
      schemaVersion: 1 as const,
      resourceKind: "subject",
      resourceId: subjectBeforeStart.subjectId,
    };
    const initialExpressionActivation = initial.data.configuration.activations.find(
      (activation: any) =>
        activation.definitionId === "subject.expression.v1" &&
        activation.scopeRef.resourceId === subjectBeforeStart.subjectId,
    );
    expect(initialExpressionActivation).toBeDefined();
    const initialExpressionRevision = initial.data.configuration.revisions.find(
      (revision: any) =>
        revision.revisionId === initialExpressionActivation!.activeRevisionId,
    );
    expect(initialExpressionRevision?.value).toEqual({
      schemaVersion: 1,
      maxOutputTokens: 256,
    });
    const initialCognitionActivation = initial.data.configuration.activations.find(
      (activation: any) =>
        activation.definitionId === "subject.cognition.runtime.v1" &&
        activation.scopeRef.resourceId === subjectBeforeStart.subjectId,
    );
    expect(initialCognitionActivation).toBeDefined();
    const initialCognitionRevision = initial.data.configuration.revisions.find(
      (revision: any) =>
        revision.revisionId === initialCognitionActivation!.activeRevisionId,
    );
    expect(initialCognitionRevision?.value).toEqual({
      schemaVersion: 1,
      enabled: true,
      maxOutputTokens: 256,
      runTimeoutMs: 60_000,
      maxContextBytes: 65_536,
    });
    const initialHttpAdmissionActivation = initial.data.configuration.activations.find(
      (activation: any) =>
        activation.definitionId === "management.http.admission.v1" &&
        activation.scopeRef.resourceId === fixture!.installationId,
    );
    expect(initialHttpAdmissionActivation).toBeDefined();
    const initialHttpAdmissionRevision = initial.data.configuration.revisions.find(
      (revision: any) =>
        revision.revisionId === initialHttpAdmissionActivation!.activeRevisionId,
    );
    expect(initialHttpAdmissionRevision?.value).toEqual({
      schemaVersion: 1,
      bodyLimitBytes: 65_536,
      claimRateLimit: { max: 5, windowMs: 60_000 },
      loginRateLimit: { max: 10, windowMs: 60_000 },
    });
    const httpAdmissionPlan = await client.planSystemAction({
      actionId: "configuration.activate",
      input: { revisionId: initialHttpAdmissionActivation!.activeRevisionId },
    });
    expect(httpAdmissionPlan.affectedSemanticOwners).toEqual([
      "system.configuration",
      "application.product-host",
    ]);
    expect(httpAdmissionPlan.configurationReadinessSubjectImpact).toMatchObject({
      configurationDefinitionId: "management.http.admission.v1",
      activation: "RESTART_HOST",
      consumerRefs: ["application.product-host.http"],
      effective: "active-revision",
    });
    expect(httpAdmissionPlan.restartReconcileImpact).toMatchObject({
      restartRequired: true,
      activation: "RESTART_HOST",
      reconciliation: "restart-host",
    });

    const invalidAction: SystemActionRequestInput = {
      actionId: "configuration.revision.create",
      input: {
        definitionId: "subject.expression.v1",
        scopeRef: subjectScope,
        value: { schemaVersion: 1, maxOutputTokens: 0 },
      },
    };
    const invalid = await client
      .planSystemAction(invalidAction)
      .catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(ManagementClientError);
    expect(invalid).toMatchObject({
      problem: { problemCode: "configuration.invalid_input" },
    });
    await expect(client.getProductState()).resolves.toMatchObject({
      data: {
        configuration: {
          revisions: initial.data.configuration.revisions,
        },
      },
    });

    const transportScope = {
      schemaVersion: 1 as const,
      resourceKind: "installation",
      resourceId: fixture!.installationId,
    };
    const transport = await applyAction({
      actionId: "configuration.revision.create",
      input: {
        definitionId: "ai.gateway.transport.v1",
        scopeRef: transportScope,
        value: {
          schemaVersion: 1,
          timeoutMs: 30_000,
          requestBodyBudgetBytes: 60_000,
          responseBodyBudgetBytes: 1_048_576,
        },
      },
    });
    const transportRevision = transport.result as { revisionId: string };
    await applyAction({
      actionId: "configuration.activate",
      input: { revisionId: transportRevision.revisionId },
    });

    const gatewayProfileId = createUuidV7Id("GatewayProfileId");
    await applyAction({
      actionId: "gateway-profile.set",
      input: {
        gatewayProfileId,
        baseUrl: subjectGateway.baseUrl,
        enabled: true,
      },
    });
    const capabilities: Array<
      "text-generation" | "structured-output" | "usage-metadata" | "abort-timeout"
    > = ["text-generation", "structured-output", "usage-metadata", "abort-timeout"];
    const primaryModelProfileId = createUuidV7Id("ModelProfileId");
    const expressionModelProfileId = createUuidV7Id("ModelProfileId");
    await applyAction({
      actionId: "model-profile.set",
      input: {
        modelProfileId: primaryModelProfileId,
        gatewayProfileId,
        modelIdentifier: "subject-primary-config",
        protocol: "openai-chat",
        consumedCapabilities: capabilities,
      },
    });
    await applyAction({
      actionId: "model-profile.set",
      input: {
        modelProfileId: expressionModelProfileId,
        gatewayProfileId,
        modelIdentifier: "subject-expression-config",
        protocol: "openai-responses",
        consumedCapabilities: capabilities,
      },
    });
    await applyAction({
      actionId: "model-binding.set",
      input: { role: "subject.primary", modelProfileId: primaryModelProfileId },
    });
    await applyAction({
      actionId: "model-binding.set",
      input: {
        role: "subject.expression",
        modelProfileId: expressionModelProfileId,
      },
    });

    await applyAction({
      actionId: "subject.start",
      input: {
        subjectId: subjectBeforeStart.subjectId,
        expectedAuthorityRevision: subjectBeforeStart.authorityRevision,
      },
    });
    await expect
      .poll(async () => (await client.getProductState()).data.subject.actualState, {
        timeout: 10_000,
        interval: 100,
      })
      .toBe("READY");
    const send = async (clientMessageId: string, text: string) => {
      const response = await fetch(
        running!.ready.origin + "/subject-chat/v1/messages",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${sessionToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ clientMessageId, text }),
        },
      );
      return { response, body: (await response.json()) as Record<string, any> };
    };

    const first = await send("subject-config-message-1", "Default budget");
    expect(first.response.status, JSON.stringify(first.body)).toBe(200);
    await expect
      .poll(() => subjectGateway!.expressionBudgets().length, {
        timeout: 20_000,
        interval: 100,
      })
      .toBe(1);
    expect(subjectGateway.expressionBudgets()[0]).toBe(256);

    const nextRevision = await applyAction({
      actionId: "configuration.revision.create",
      input: {
        definitionId: "subject.expression.v1",
        scopeRef: subjectScope,
        value: { schemaVersion: 1, maxOutputTokens: 128 },
      },
    });
    const next = nextRevision.result as { revisionId: string };
    const activeBeforeChange = (
      (await client.getProductState()) as any
    ).data.configuration.activations.find(
      (activation: any) =>
        activation.definitionId === "subject.expression.v1" &&
        activation.scopeRef.resourceId === subjectBeforeStart.subjectId,
    );
    expect(activeBeforeChange).toBeDefined();
    await applyAction({
      actionId: "configuration.activate",
      input: {
        revisionId: next.revisionId,
        expectedActiveRevisionId: activeBeforeChange!.activeRevisionId,
      },
    });
    const effectiveAfterChange = (await client.getProductState()) as any;
    const activeAfterChange = effectiveAfterChange.data.configuration.activations.find(
      (activation: any) =>
        activation.definitionId === "subject.expression.v1" &&
        activation.scopeRef.resourceId === subjectBeforeStart.subjectId,
    );
    expect(activeAfterChange?.activeRevisionId).toBe(next.revisionId);
    expect(
      effectiveAfterChange.data.configuration.revisions.find(
        (revision: any) => revision.revisionId === next.revisionId,
      )?.value,
    ).toEqual({ schemaVersion: 1, maxOutputTokens: 128 });

    const second = await send("subject-config-message-2", "Changed budget");
    expect(second.response.status, JSON.stringify(second.body)).toBe(200);
    await expect
      .poll(() => subjectGateway!.expressionBudgets().length, {
        timeout: 20_000,
        interval: 100,
      })
      .toBe(2);
    expect(subjectGateway.expressionBudgets()[1]).toBe(128);

    const staleRevision = await applyAction({
      actionId: "configuration.revision.create",
      input: {
        definitionId: "subject.expression.v1",
        scopeRef: subjectScope,
        value: { schemaVersion: 1, maxOutputTokens: 192 },
      },
    });
    const stale = staleRevision.result as { revisionId: string };
    const staleAction: SystemActionRequestInput = {
      actionId: "configuration.activate",
      input: {
        revisionId: stale.revisionId,
        expectedActiveRevisionId: activeBeforeChange!.activeRevisionId,
      },
    };
    const stalePlan = await client.planSystemAction(staleAction);
    await expect(
      client.executeSystemAction({ plan: stalePlan, action: staleAction }),
    ).rejects.toMatchObject({
      problem: { problemCode: "configuration.activation_conflict" },
    });
    await expect(client.getProductState()).resolves.toMatchObject({
      data: {
        configuration: {
          activations: expect.arrayContaining([
            expect.objectContaining({
              definitionId: "subject.expression.v1",
              activeRevisionId: next.revisionId,
            }),
          ]),
        },
      },
    });
  });
});
