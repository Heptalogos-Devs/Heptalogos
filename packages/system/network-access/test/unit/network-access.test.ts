// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import {
  createContinuityEpochId,
  createInstanceId,
  createUuidV7Id,
} from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import type { ConfigurationService } from "@heptalogos/configuration";
import type {
  ExecutionContextRuntime,
  LineageContextRef,
} from "@heptalogos/execution-lineage";
import {
  createNetworkAccessService,
  networkAccessDiagnosticsSchema,
  type GatewayNetworkTarget,
  type NetworkAccessService,
} from "../../src/index.js";

const lineageContextRef: LineageContextRef = {
  schemaVersion: 1,
  sourceActivityId: createUuidV7Id("ActivityId"),
  sourceInstanceId: createInstanceId(),
  sourceContinuityEpochId: createContinuityEpochId(),
};

const configurationValue = {
  schemaVersion: 1 as const,
  timeoutMs: 60_000,
  requestBodyBudgetBytes: 60_000,
  responseBodyBudgetBytes: 1_048_576,
};
const configurationRevisionId = createUuidV7Id("ConfigurationRevisionId");

function serviceFixture(
  transport: typeof fetch = async () => new Response("{}"),
  value = configurationValue,
  revisionId = configurationRevisionId,
): NetworkAccessService {
  const configuration = {
    getEffectiveRevision: async () => ({ revisionId, value }),
  } as unknown as ConfigurationService;
  const execution = {
    current: () => ({}) as never,
    createLineageContextRef: () => lineageContextRef,
  } as unknown as ExecutionContextRuntime;
  return createNetworkAccessService({
    configuration,
    execution,
    installationId: "01j00000000000000000000000",
    transport,
  });
}

const responsesTarget: GatewayNetworkTarget = {
  schemaVersion: 1,
  gatewayProfileId: "01j00000000000000000000000",
  baseUrl: "https://gateway.example.com/v1",
  protocol: "openai-responses",
};
const chatTarget: GatewayNetworkTarget = {
  ...responsesTarget,
  protocol: "openai-chat",
};

describe("NetworkAccess current GatewayProfile policy", () => {
  it("admits the selected Responses destination and exposes bounded diagnostics", async () => {
    const service = serviceFixture();
    const response = await service.request(
      "system.ai-runtime",
      responsesTarget,
      configurationRevisionId,
      "https://gateway.example.com/v1/responses",
      { method: "POST", body: "{}" },
    );
    expect(response.statusCode).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe("{}");
    expect(
      compileSchema(networkAccessDiagnosticsSchema).validate(
        await service.getDiagnostics(),
      ).ok,
    ).toBe(true);
  });

  it("admits Chat and literal loopback HTTP while denying remote plain HTTP", async () => {
    const service = serviceFixture();
    await expect(
      service.request(
        "system.ai-runtime",
        chatTarget,
        configurationRevisionId,
        "https://gateway.example.com/v1/chat/completions",
        { method: "POST" },
      ),
    ).resolves.toMatchObject({ statusCode: 200 });
    expect(() =>
      service.authorizeGatewayTarget({
        ...chatTarget,
        baseUrl: "http://127.0.0.1:3000/v1",
      }),
    ).not.toThrow();
    expect(() =>
      service.authorizeGatewayTarget({
        ...chatTarget,
        baseUrl: "http://gateway.example.com/v1",
      }),
    ).toThrowError(/loopback/u);
    expect(() =>
      service.authorizeGatewayTarget({
        ...chatTarget,
        baseUrl: "https://user:password@gateway.example.com/v1",
      }),
    ).toThrowError(/credential-free/u);
  });

  it("denies wrong requester, origin, path, method, and cookies", async () => {
    const service = serviceFixture();
    await expect(
      service.request(
        "other-service",
        responsesTarget,
        configurationRevisionId,
        "https://gateway.example.com/v1/responses",
        { method: "POST" },
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "network.unauthorized_requester" },
    });
    await expect(
      service.request(
        "system.ai-runtime",
        responsesTarget,
        configurationRevisionId,
        "https://example.com/v1/responses",
        { method: "POST" },
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "network.unauthorized_destination" },
    });
    await expect(
      service.request(
        "system.ai-runtime",
        responsesTarget,
        configurationRevisionId,
        "https://gateway.example.com/v1/other",
        { method: "POST" },
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "network.unauthorized_destination" },
    });
    await expect(
      service.request(
        "system.ai-runtime",
        responsesTarget,
        configurationRevisionId,
        "https://gateway.example.com/v1/responses",
        { method: "GET" },
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "network.unauthorized_method" },
    });
    await expect(
      service.request(
        "system.ai-runtime",
        responsesTarget,
        configurationRevisionId,
        "https://gateway.example.com/v1/responses",
        { method: "POST", headers: { Cookie: "private" } },
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "network.sensitive_header_denied" },
    });
  });

  it("denies redirects, enforces response budgets, and does not retry transport failure", async () => {
    const redirect = serviceFixture(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://other.example.com" },
        }),
    );
    await expect(
      redirect.request(
        "system.ai-runtime",
        responsesTarget,
        configurationRevisionId,
        "https://gateway.example.com/v1/responses",
        { method: "POST" },
      ),
    ).rejects.toMatchObject({ problem: { problemCode: "network.redirect_denied" } });

    const budget = serviceFixture(
      async () => new Response("too-large", { status: 200 }),
      { ...configurationValue, responseBodyBudgetBytes: 1 },
    );
    await expect(
      budget.request(
        "system.ai-runtime",
        responsesTarget,
        configurationRevisionId,
        "https://gateway.example.com/v1/responses",
        { method: "POST" },
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "network.response_budget_exceeded" },
    });

    let calls = 0;
    const unavailable = serviceFixture(async () => {
      calls += 1;
      throw new Error("transport failed");
    });
    await expect(
      unavailable.request(
        "system.ai-runtime",
        responsesTarget,
        configurationRevisionId,
        "https://gateway.example.com/v1/responses",
        { method: "POST" },
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "network.transport_unavailable" },
    });
    expect(calls).toBe(1);
  });

  it("does not send a bearer request to an unauthorized origin through the SDK fetch", async () => {
    let calls = 0;
    const service = serviceFixture(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    const providerFetch = service.createProviderFetch(
      "system.ai-runtime",
      chatTarget,
      configurationRevisionId,
    );
    await expect(
      providerFetch("https://other.example.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: "Bearer protected" },
        body: "{}",
      }),
    ).rejects.toMatchObject({
      problem: { problemCode: "network.unauthorized_destination" },
    });
    expect(calls).toBe(0);
  });

  it("rejects a stale configuration revision before transport", async () => {
    let calls = 0;
    const service = serviceFixture(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    await expect(
      service.request(
        "system.ai-runtime",
        responsesTarget,
        createUuidV7Id("ConfigurationRevisionId"),
        "https://gateway.example.com/v1/responses",
        { method: "POST" },
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "network.configuration_unavailable" },
    });
    expect(calls).toBe(0);
  });
});
