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

suite("built Product Host Subject re-entry", () => {
  it("runs the local Subject Chat vertical slice through DBOS and canonical facts", async () => {
    fixture = await makeFixture(postgresBin!);
    subjectGateway = await createSubjectGatewayFixture();
    running = await runHost(fixture);

    const password = "Subject-l4-password-012345";
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
    let client = authenticated.client;
    const applyAction = async (action: SystemActionRequestInput) => {
      const plan = await client.planSystemAction(action);
      const executed = await client.executeSystemAction({ plan, action });
      expect(executed.postconditionsVerified).toBe(true);
      return executed;
    };
    const scopeRef = {
      schemaVersion: 1 as const,
      resourceKind: "installation",
      resourceId: fixture.installationId,
    };
    const transportRevision = await applyAction({
      actionId: "configuration.revision.create",
      input: {
        definitionId: "ai.gateway.transport.v1",
        scopeRef,
        value: {
          schemaVersion: 1,
          timeoutMs: 30_000,
          requestBodyBudgetBytes: 60_000,
          responseBodyBudgetBytes: 1_048_576,
        },
      },
    });
    const transport = transportRevision.result as { revisionId: string };
    await applyAction({
      actionId: "configuration.activate",
      input: { revisionId: transport.revisionId },
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
        modelIdentifier: "subject-primary",
        protocol: "openai-chat",
        consumedCapabilities: capabilities,
      },
    });
    await applyAction({
      actionId: "model-profile.set",
      input: {
        modelProfileId: expressionModelProfileId,
        gatewayProfileId,
        modelIdentifier: "subject-expression",
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
    const setModelProfile = async (
      modelProfileId: string,
      modelIdentifier: string,
      protocol: "openai-chat" | "openai-responses",
    ) => {
      await applyAction({
        actionId: "model-profile.set",
        input: {
          modelProfileId,
          gatewayProfileId,
          modelIdentifier,
          protocol,
          consumedCapabilities: capabilities,
        },
      });
    };

    const beforeStart = await client.getProductState();
    const subjectBeforeStart = beforeStart.data.subject;
    expect(subjectBeforeStart.desiredState).toBe("STOPPED");
    const started = await applyAction({
      actionId: "subject.start",
      input: {
        subjectId: subjectBeforeStart.subjectId,
        expectedAuthorityRevision: subjectBeforeStart.authorityRevision,
      },
    });
    expect(started.result).toMatchObject({ desiredState: "RUNNING" });
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
    const staleStopState = await client.getProductState();
    const staleStopAction: SystemActionRequestInput = {
      actionId: "subject.stop",
      input: {
        subjectId: subjectBeforeStart.subjectId,
        expectedAuthorityRevision: staleStopState.data.subject.authorityRevision,
      },
    };
    const staleStopPlan = await client.planSystemAction(staleStopAction);
    const authorityLock = await holdSubjectAuthorityLock(fixture);
    const stopPromise = client.executeSystemAction({
      plan: staleStopPlan,
      action: staleStopAction,
    });
    await authorityLock.waitForWaiters(1);
    const staleInboundPromise = send(
      "subject-l4-message-stale-prepared-inbound",
      "Prepared under the old Subject authority",
    );
    await authorityLock.waitForWaiters(2);
    await authorityLock.release();
    const [staleInbound, stoppedByRace] = await Promise.all([
      staleInboundPromise,
      stopPromise,
    ]);
    expect(staleInbound.response.status, JSON.stringify(staleInbound.body)).toBe(400);
    expect(staleInbound.body.problemCode).toBe("subject.stale_authority_revision");
    expect(stoppedByRace.postconditionsVerified).toBe(true);
    const stoppedAfterRace = await client.getProductState();
    expect(stoppedAfterRace.data.subject.desiredState).toBe("STOPPED");
    await applyAction({
      actionId: "subject.start",
      input: {
        subjectId: subjectBeforeStart.subjectId,
        expectedAuthorityRevision: stoppedAfterRace.data.subject.authorityRevision,
      },
    });
    await expect
      .poll(async () => (await client.getProductState()).data.subject.actualState, {
        timeout: 10_000,
        interval: 100,
      })
      .toBe("READY");
    const first = await send("subject-l4-message-1", "Hello Subject");
    expect(first.response.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({
      status: "ACCEPTED",
      message: { direction: "INBOUND" },
    });

    let page: Record<string, any> | undefined;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const response = await fetch(
        running.ready.origin + "/subject-chat/v1/messages?limit=100",
        {
          headers: { authorization: `Bearer ${sessionToken}` },
        },
      );
      page = (await response.json()) as Record<string, any>;
      if (
        Array.isArray(page.messages) &&
        page.messages.some((message) => message.direction === "OUTBOUND")
      )
        break;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    expect(
      page?.messages,
      `primaryCount=${subjectGateway?.primaryInvocationCount()} expressionCount=${subjectGateway?.expressionInvocationCount()} facts=${JSON.stringify(await readSubjectFactSnapshot(fixture, first.body.message.conversationId as string))}`,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: "INBOUND", text: "Hello Subject" }),
        expect.objectContaining({
          direction: "OUTBOUND",
          text: "local expressed reply",
        }),
      ]),
    );
    const firstFacts = await readSubjectFactSnapshot(
      fixture,
      first.body.message.conversationId,
    );
    expect(firstFacts.reactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "REPLIED",
          communicationCommitId: expect.any(String),
          primaryCognitionProvenance: expect.objectContaining({
            schemaVersion: 1,
            provider: "openclaw",
            openclawVersion: expect.any(String),
            profile: "subject",
            modelProvider: "heptalogos",
            terminalToolName: "heptalogos_propose_communication",
            terminalStatus: "error",
          }),
        }),
      ]),
    );
    const firstRuntime = await readSubjectRuntimeDescriptor(fixture);
    expect(firstRuntime.pid).toBeGreaterThan(0);
    expect(firstRuntime.runtimeGeneration).toMatch(/^[0-9a-f]{64}:/u);
    expect(subjectGateway.primaryInvocationCount()).toBe(1);
    expect(subjectGateway.expressionInvocationCount()).toBe(1);

    const replay = await send("subject-l4-message-1", "Hello Subject");
    expect(replay.body).toMatchObject({
      status: "EXISTING",
      message: { sequence: first.body.message.sequence },
    });
    const conflict = await send("subject-l4-message-1", "Changed text");
    expect(conflict.response.status).toBe(409);
    expect(conflict.body.problemCode).toBe("messaging.idempotency_conflict");

    const conversationId = first.body.message.conversationId as string;
    const noCommunicationModelProfileId = createUuidV7Id("ModelProfileId");
    await setModelProfile(
      noCommunicationModelProfileId,
      "subject-primary-no-communication",
      "openai-chat",
    );
    await applyAction({
      actionId: "model-binding.set",
      input: {
        role: "subject.primary",
        modelProfileId: noCommunicationModelProfileId,
      },
    });
    const noCommunication = await send(
      "subject-l4-message-no-communication",
      "Please consider this quietly",
    );
    const noCommunicationState = await client.getProductState();
    expect(
      noCommunication.response.status,
      JSON.stringify({
        body: noCommunication.body,
        subject: noCommunicationState.data.subject,
        hostStderr: running?.stderr(),
      }),
    ).toBe(200);
    await expect
      .poll(
        async () => {
          const snapshot = await readSubjectFactSnapshot(fixture!, conversationId);
          return (
            snapshot.outboundCount === 1 &&
            snapshot.reactions.some(
              (reaction) =>
                reaction.communicationCommitId === null &&
                reaction.state === "NO_COMMUNICATION",
            )
          );
        },
        { timeout: 20_000, interval: 250 },
      )
      .toBe(true);
    const noCommunicationFacts = await readSubjectFactSnapshot(fixture, conversationId);
    expect(noCommunicationFacts.reactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: "NO_COMMUNICATION",
          communicationCommitId: null,
        }),
      ]),
    );
    expect(noCommunicationFacts.outboundCount).toBe(1);
    const noCommunicationRuntime = JSON.parse(
      await readFile(
        `${fixture.roots.RUN}/subject-openclaw/subject-openclaw-runtime.json`,
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(noCommunicationRuntime.lastToolEvent).toMatchObject({
      name: "heptalogos_complete_without_communication",
    });

    const beforeStop = await client.getProductState();
    await applyAction({
      actionId: "subject.stop",
      input: {
        subjectId: subjectBeforeStart.subjectId,
        expectedAuthorityRevision: beforeStop.data.subject.authorityRevision,
      },
    });
    const stopped = await client.getProductState();
    expect(stopped.data.subject).toMatchObject({
      subjectId: subjectBeforeStart.subjectId,
      desiredState: "STOPPED",
      actualState: "STOPPED",
    });
    const rejectedWhileStopped = await send(
      "subject-l4-message-stopped",
      "This must not be accepted",
    );
    expect(rejectedWhileStopped.response.status).toBe(409);
    expect(rejectedWhileStopped.body.problemCode).toBe("subject.not_running");

    await applyAction({
      actionId: "gateway-profile.set",
      input: {
        gatewayProfileId,
        baseUrl: subjectGateway.baseUrl,
        enabled: false,
      },
    });
    const stoppedForBlockedStart = await client.getProductState();
    await applyAction({
      actionId: "subject.start",
      input: {
        subjectId: subjectBeforeStart.subjectId,
        expectedAuthorityRevision:
          stoppedForBlockedStart.data.subject.authorityRevision,
      },
    });
    await expect
      .poll(async () => (await client.getProductState()).data.subject.actualState, {
        timeout: 10_000,
        interval: 100,
      })
      .toBe("BLOCKED");
    const rejectedWithoutDependency = await send(
      "subject-l4-message-blocked",
      "This must wait for dependencies",
    );
    expect(rejectedWithoutDependency.response.status).toBe(503);
    expect(rejectedWithoutDependency.body.problemCode).toBe(
      "subject.dependencies_unavailable",
    );
    const blockedFacts = await readSubjectFactSnapshot(fixture, conversationId);
    expect(blockedFacts.reactions).toHaveLength(noCommunicationFacts.reactions.length);
    await applyAction({
      actionId: "gateway-profile.set",
      input: {
        gatewayProfileId,
        baseUrl: subjectGateway.baseUrl,
        enabled: true,
      },
    });
    await expect
      .poll(async () => (await client.getProductState()).data.subject.actualState, {
        timeout: 10_000,
        interval: 100,
      })
      .toBe("READY");

    const slowPrimaryModelProfileId = createUuidV7Id("ModelProfileId");
    await setModelProfile(
      slowPrimaryModelProfileId,
      "subject-primary-slow",
      "openai-chat",
    );
    await applyAction({
      actionId: "model-binding.set",
      input: { role: "subject.primary", modelProfileId: slowPrimaryModelProfileId },
    });
    const beforePreCommitStop = await client.getProductState();
    const preCommitStop = await send(
      "subject-l4-message-stop-before-commit",
      "Stop before communication commit",
    );
    expect(preCommitStop.response.status).toBe(200);
    await subjectGateway.waitForSlowPrimary();
    await applyAction({
      actionId: "subject.stop",
      input: {
        subjectId: subjectBeforeStart.subjectId,
        expectedAuthorityRevision: beforePreCommitStop.data.subject.authorityRevision,
      },
    });
    subjectGateway.releaseSlowPrimary();
    await expect
      .poll(
        async () => {
          const snapshot = await readSubjectFactSnapshot(fixture!, conversationId);
          return (
            snapshot.outboundCount === 1 &&
            snapshot.reactions.some((reaction) => reaction.state === "SUPERSEDED")
          );
        },
        { timeout: 30_000, interval: 250 },
      )
      .toBe(true);
    const preCommitStopFacts = await readSubjectFactSnapshot(fixture, conversationId);
    expect(preCommitStopFacts.reactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "SUPERSEDED", communicationCommitId: null }),
      ]),
    );

    const restartedAfterPreCommitStop = await client.getProductState();
    await applyAction({
      actionId: "subject.start",
      input: {
        subjectId: subjectBeforeStart.subjectId,
        expectedAuthorityRevision:
          restartedAfterPreCommitStop.data.subject.authorityRevision,
      },
    });
    await expect
      .poll(async () => (await client.getProductState()).data.subject.actualState, {
        timeout: 10_000,
        interval: 100,
      })
      .toBe("READY");

    const supersededA = await send("subject-l4-message-a", "Message A");
    expect(supersededA.response.status).toBe(200);
    await subjectGateway.waitForSlowPrimary();
    const supersededB = await send("subject-l4-message-b", "Message B");
    expect(supersededB.response.status).toBe(200);
    subjectGateway.releaseSlowPrimary();
    await subjectGateway.waitForSlowPrimary();
    subjectGateway.releaseSlowPrimary();
    await expect
      .poll(
        async () => {
          const snapshot = await readSubjectFactSnapshot(fixture!, conversationId);
          return (
            snapshot.outboundCount === 2 &&
            snapshot.reactions.some((reaction) => reaction.state === "SUPERSEDED") &&
            snapshot.reactions.some(
              (reaction) =>
                reaction.state === "REPLIED" && reaction.communicationCommitId !== null,
            )
          );
        },
        { timeout: 30_000, interval: 250 },
      )
      .toBe(true);
    const supersessionFacts = await readSubjectFactSnapshot(fixture, conversationId);
    expect(supersessionFacts.reactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "SUPERSEDED", communicationCommitId: null }),
      ]),
    );
    expect(
      subjectGateway
        .primaryRequestMessages()
        .some(
          (messages) =>
            messages.some((message) => message.includes("Message A")) &&
            messages.every((message) => !message.includes("Hello Subject")) &&
            messages.every(
              (message) => !message.includes("Please consider this quietly"),
            ),
        ),
    ).toBe(true);

    await applyAction({
      actionId: "model-binding.set",
      input: { role: "subject.primary", modelProfileId: primaryModelProfileId },
    });
    const slowExpressionModelProfileId = createUuidV7Id("ModelProfileId");
    await setModelProfile(
      slowExpressionModelProfileId,
      "subject-expression-slow",
      "openai-responses",
    );
    await applyAction({
      actionId: "model-binding.set",
      input: {
        role: "subject.expression",
        modelProfileId: slowExpressionModelProfileId,
      },
    });
    const primaryBeforeSubjectRuntimeRestart = subjectGateway.primaryInvocationCount();
    const postCommitStopMessage = await send(
      "subject-l4-message-stop-after-commit",
      "Stop after communication commit",
    );
    expect(postCommitStopMessage.response.status).toBe(200);
    await subjectGateway.waitForSlowExpression();
    await expect
      .poll(
        async () => {
          const snapshot = await readSubjectFactSnapshot(fixture!, conversationId);
          const latest = snapshot.reactions[snapshot.reactions.length - 1];
          return (
            snapshot.outboundCount === 2 &&
            latest?.state === "COMMUNICATION_COMMITTED" &&
            latest.communicationCommitId !== null
          );
        },
        { timeout: 20_000, interval: 250 },
      )
      .toBe(true);
    const runtimeBeforeKill = await readSubjectRuntimeDescriptor(fixture);
    expect(runtimeBeforeKill.pid).not.toBe(process.pid);
    process.kill(runtimeBeforeKill.pid, "SIGKILL");
    const beforePostCommitStop = await client.getProductState();
    await applyAction({
      actionId: "subject.stop",
      input: {
        subjectId: subjectBeforeStart.subjectId,
        expectedAuthorityRevision: beforePostCommitStop.data.subject.authorityRevision,
      },
    });
    subjectGateway.releaseSlowExpression();
    await expect
      .poll(
        async () => {
          const snapshot = await readSubjectFactSnapshot(fixture!, conversationId);
          const latest = snapshot.reactions[snapshot.reactions.length - 1];
          return snapshot.outboundCount === 3 && latest?.state === "REPLIED";
        },
        { timeout: 45_000, interval: 250 },
      )
      .toBe(true);
    expect(subjectGateway.primaryInvocationCount()).toBe(
      primaryBeforeSubjectRuntimeRestart + 1,
    );
    await expect
      .poll(
        async () => {
          try {
            await readSubjectRuntimeDescriptor(fixture!);
            return false;
          } catch {
            return true;
          }
        },
        { timeout: 30_000, interval: 250 },
      )
      .toBe(true);
    await expect
      .poll(async () => (await client.getProductState()).data.subject.actualState, {
        timeout: 10_000,
        interval: 100,
      })
      .toBe("STOPPED");

    const beforeRestart = await client.getProductState();
    await applyAction({
      actionId: "subject.start",
      input: {
        subjectId: subjectBeforeStart.subjectId,
        expectedAuthorityRevision: beforeRestart.data.subject.authorityRevision,
      },
    });
    await expect
      .poll(async () => (await client.getProductState()).data.subject.actualState, {
        timeout: 10_000,
        interval: 100,
      })
      .toBe("READY");
    const runtimeAfterExplicitStart = await readSubjectRuntimeDescriptor(fixture);
    expect(runtimeAfterExplicitStart.runtimeGeneration).not.toBe(
      runtimeBeforeKill.runtimeGeneration,
    );

    const primaryBeforeCrash = subjectGateway.primaryInvocationCount();
    const expressionBeforeCrash = subjectGateway.expressionInvocationCount();
    const crashMessage = await send("subject-l4-message-crash", "Crash boundary");
    expect(crashMessage.response.status).toBe(200);
    await subjectGateway.waitForSlowExpression();
    await expect
      .poll(
        async () => {
          const snapshot = await readSubjectFactSnapshot(fixture!, conversationId);
          const latest = snapshot.reactions[snapshot.reactions.length - 1];
          return (
            snapshot.outboundCount === 3 &&
            latest?.state === "COMMUNICATION_COMMITTED" &&
            latest.communicationCommitId !== null
          );
        },
        { timeout: 20_000, interval: 250 },
      )
      .toBe(true);
    const crashSnapshot = await readSubjectFactSnapshot(fixture, conversationId);
    const crashReaction = crashSnapshot.reactions[crashSnapshot.reactions.length - 1];
    expect(crashReaction).toBeDefined();
    const releaseWorkItemLock = await holdWorkItemLock(
      fixture,
      crashReaction!.workItemId,
    );
    subjectGateway.releaseSlowExpression();
    try {
      await expect
        .poll(
          async () => {
            const snapshot = await readSubjectFactSnapshot(fixture!, conversationId);
            const latest = snapshot.reactions[snapshot.reactions.length - 1];
            return (
              snapshot.outboundCount === 4 &&
              latest?.state === "REPLIED" &&
              latest.workState === "RUNNING"
            );
          },
          { timeout: 45_000, interval: 250 },
        )
        .toBe(true);
      await running!.crash();
      running = undefined;
    } finally {
      await releaseWorkItemLock();
    }
    await runHost(fixture, { includeInitialPort: false }).then((host) => {
      running = host;
    });
    await expect
      .poll(
        async () => {
          const snapshot = await readSubjectFactSnapshot(fixture!, conversationId);
          const latest = snapshot.reactions[snapshot.reactions.length - 1];
          return (
            snapshot.outboundCount === 4 &&
            latest?.state === "REPLIED" &&
            latest.workState === "SUCCEEDED"
          );
        },
        { timeout: 45_000, interval: 250 },
      )
      .toBe(true);
    expect(subjectGateway.primaryInvocationCount()).toBe(primaryBeforeCrash + 1);
    expect(subjectGateway.expressionInvocationCount()).toBe(expressionBeforeCrash + 1);
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
    expect(restarted.data.subject).toMatchObject({
      subjectId: subjectBeforeStart.subjectId,
      desiredState: "RUNNING",
      actualState: "READY",
    });
    client = restartedAuthenticated.client;

    await applyAction({
      actionId: "model-binding.set",
      input: { role: "subject.primary", modelProfileId: slowPrimaryModelProfileId },
    });
    const primaryBeforePreProposalCrash = subjectGateway.primaryInvocationCount();
    const preProposalCrash = await send(
      "subject-l4-message-crash-before-proposal",
      "Crash before proposal acceptance",
    );
    expect(preProposalCrash.response.status).toBe(200);
    await subjectGateway.waitForSlowPrimary();
    await running!.crash();
    running = undefined;
    subjectGateway.releaseSlowPrimary();
    await runHost(fixture, { includeInitialPort: false }).then((host) => {
      running = host;
    });
    await subjectGateway.waitForSlowPrimary();
    subjectGateway.releaseSlowPrimary();
    await subjectGateway.waitForSlowExpression();
    subjectGateway.releaseSlowExpression();
    await expect
      .poll(
        async () => {
          const snapshot = await readSubjectFactSnapshot(fixture!, conversationId);
          const latest = snapshot.reactions[snapshot.reactions.length - 1];
          return snapshot.outboundCount === 5 && latest?.state === "REPLIED";
        },
        { timeout: 45_000, interval: 250 },
      )
      .toBe(true);
    expect(subjectGateway.primaryInvocationCount()).toBeGreaterThanOrEqual(
      primaryBeforePreProposalCrash + 1,
    );

    expect(subjectGateway.expressionBudgets()[0]).toBe(256);
  });
});
