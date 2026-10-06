// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  asContentDigest,
  createUuidV7Id,
  digestCanonicalJson,
  type CanonicalJsonValue,
  type ProductGenerationId,
} from "@heptalogos/foundation-contracts";
import {
  createExecutionContextRuntime,
  createExecutionLineageService,
  createPersistenceExecutionContextProvider,
  type ExecutionContext,
} from "@heptalogos/execution-lineage";
import { createPersistenceService } from "@heptalogos/persistence";
import { createEvidenceService } from "@heptalogos/evidence";
import { createSystemTimeService } from "@heptalogos/time-service";
import { createConfigurationService } from "@heptalogos/configuration";
import { createSecretService } from "@heptalogos/secret";
import {
  createNetworkAccessService,
  gatewayTransportConfigurationDefinition,
} from "@heptalogos/network-access";
import { createAIRuntimeService } from "@heptalogos/ai-runtime";
import type { OsCredentialKey, OsCredentialStore } from "@heptalogos/os-credential";
import {
  boot,
  cleanupCanonicalPostgresFixtures,
  describeRealPostgres,
  makeFixture,
  stopManagedHostWithoutRuntime,
} from "../../foundation/support/canonical-postgres.js";

const suite = describeRealPostgres === undefined ? describe.skip : describe;
const outputSchema: CanonicalJsonValue = {
  type: "object",
  required: ["schemaVersion", "ok", "marker"],
  properties: {
    schemaVersion: { const: 1 },
    ok: { const: true },
    marker: { type: "string", minLength: 1, maxLength: 64 },
  },
  additionalProperties: false,
};

const PERSISTENCE_OPTIONS = {
  maxConnections: 2,
  idleTimeoutMs: 5_000,
  connectionTimeoutMs: 10_000,
  statementTimeoutMs: 10_000,
  lockTimeoutMs: 10_000,
  idleInTransactionSessionTimeoutMs: 30_000,
  onBackgroundError() {},
} as const;

class MemoryCredentialStore implements OsCredentialStore {
  private readonly values = new Map<string, Uint8Array>();

  private key(key: OsCredentialKey): string {
    return key.service + "\u0000" + key.account;
  }

  async exists(key: OsCredentialKey): Promise<boolean> {
    return this.values.has(this.key(key));
  }

  async set(key: OsCredentialKey, secret: Uint8Array): Promise<void> {
    this.values.set(this.key(key), Uint8Array.from(secret));
  }

  async delete(key: OsCredentialKey): Promise<boolean> {
    const value = this.values.get(this.key(key));
    if (value !== undefined) value.fill(0);
    return this.values.delete(this.key(key));
  }

  async withCredential<T>(
    key: OsCredentialKey,
    use: (secret: Uint8Array) => Promise<T>,
  ): Promise<T> {
    const value = this.values.get(this.key(key));
    if (value === undefined) throw new Error("credential not found");
    const copy = Uint8Array.from(value);
    try {
      return await use(copy);
    } finally {
      copy.fill(0);
    }
  }
}

interface CapturedRequest {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
}

async function jsonBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function createGatewayFixture(): Promise<{
  readonly server: Server;
  readonly baseUrl: string;
  readonly requests: CapturedRequest[];
}> {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      try {
        const body = await jsonBody(request);
        const path = request.url ?? "";
        requests.push({
          path,
          authorization:
            typeof request.headers.authorization === "string"
              ? request.headers.authorization
              : undefined,
          body,
        });
        const model = typeof body.model === "string" ? body.model : "unknown";
        const candidate = {
          schemaVersion: 1,
          ok: true,
          marker: path.endsWith("/responses") ? "responses-" + model : "chat-" + model,
        };
        const payload = path.endsWith("/chat/completions")
          ? {
              id: "chat-local",
              object: "chat.completion",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: JSON.stringify(candidate),
                  },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 7,
                completion_tokens: 5,
                total_tokens: 12,
              },
            }
          : path.endsWith("/responses")
            ? {
                id: "response-local",
                object: "response",
                created_at: Math.floor(Date.now() / 1000),
                status: "completed",
                model,
                output: [
                  {
                    id: "message-local",
                    type: "message",
                    status: "completed",
                    role: "assistant",
                    content: [
                      {
                        type: "output_text",
                        text: JSON.stringify(candidate),
                        annotations: [],
                        logprobs: [],
                      },
                    ],
                  },
                ],
                usage: {
                  input_tokens: 7,
                  output_tokens: 5,
                  total_tokens: 12,
                  input_tokens_details: { cached_tokens: 0 },
                  output_tokens_details: { reasoning_tokens: 0 },
                },
              }
            : undefined;
        if (payload === undefined) {
          response.writeHead(404).end();
          return;
        }
        const encoded = JSON.stringify(payload);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(encoded);
      } catch (error) {
        response.writeHead(500, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: String(error) }));
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("local gateway fixture did not expose a TCP address");
  }
  return {
    server,
    baseUrl: "http://127.0.0.1:" + address.port + "/v1",
    requests,
  };
}

function productGeneration(): ProductGenerationId {
  return asContentDigest(
    "ProductGenerationId",
    digestCanonicalJson("model-gateway-fixture/product/v1", {
      route: "chat-and-responses",
    }),
  );
}

async function runActivity<T>(
  runtime: ReturnType<typeof createExecutionContextRuntime>,
  persistence: ReturnType<typeof createPersistenceService>,
  lineage: ReturnType<typeof createExecutionLineageService>,
  evidence: ReturnType<typeof createEvidenceService>,
  time: ReturnType<typeof createSystemTimeService>,
  kind: string,
  operation: (context: ExecutionContext) => Promise<T>,
): Promise<T> {
  return runtime.runActivity(
    {
      kind,
      importance: "significant",
      retentionClass: "retained",
      sensitivity: "operational",
    },
    async (context) => {
      await persistence.mutate((transaction) =>
        lineage.retainCurrent(transaction, context),
      );
      const result = await operation(context);
      await persistence.mutate((transaction) =>
        evidence.recordRequired(transaction, {
          evidenceKind: "model-gateway.fixture",
          evidenceContractVersion: "model-gateway.fixture.v1",
          subjectRef: context.activityId,
          retentionClass: "retained",
          sensitivity: "operational",
        }),
      );
      await persistence.mutate((transaction) =>
        lineage.completeCurrent(transaction, context, {
          endedAt: time.now(),
          outcome: "SUCCEEDED",
        }),
      );
      return result;
    },
  );
}

let fixture: Awaited<ReturnType<typeof makeFixture>> | undefined;
let host: Awaited<ReturnType<typeof boot>> | undefined;
let persistence: ReturnType<typeof createPersistenceService> | undefined;
let gateway: Awaited<ReturnType<typeof createGatewayFixture>> | undefined;

afterEach(async () => {
  await persistence?.close().catch(() => undefined);
  persistence = undefined;
  if (host !== undefined) {
    await stopManagedHostWithoutRuntime(host.host).catch(() => undefined);
    host = undefined;
  }
  if (gateway !== undefined) {
    await new Promise<void>((resolve) => gateway!.server.close(() => resolve()));
    gateway = undefined;
  }
  await cleanupCanonicalPostgresFixtures().catch(() => undefined);
  fixture = undefined;
});

suite("installed model gateway protocol adapters", () => {
  it("invokes real Chat and Responses adapters through one scoped gateway", async () => {
    fixture = await makeFixture();
    host = await boot(fixture);
    gateway = await createGatewayFixture();
    const time = createSystemTimeService();
    const runtime = createExecutionContextRuntime(
      {
        installationId: host.host.installationId,
        instanceId: host.host.instanceId,
        bootId: host.host.bootId,
        continuityEpochId: host.host.continuityEpochId,
        hostOwnershipToken: host.host.token,
        runtime: { productGenerationId: productGeneration() },
      },
      time,
    );
    persistence = createPersistenceService(
      host.host.persistence,
      PERSISTENCE_OPTIONS,
      createPersistenceExecutionContextProvider(runtime),
    );
    const lineage = createExecutionLineageService();
    const evidence = createEvidenceService(time);
    const configuration = createConfigurationService({
      definitions: [gatewayTransportConfigurationDefinition],
      persistence,
      time,
      execution: runtime,
      evidence,
    });
    const credentialStore = new MemoryCredentialStore();
    const secret = createSecretService({
      persistence,
      time,
      execution: runtime,
      evidence,
      credentialStore,
    });
    const networkAccess = createNetworkAccessService({
      configuration,
      execution: runtime,
      installationId: host.host.installationId,
    });
    const aiRuntime = createAIRuntimeService({
      persistence,
      time,
      execution: runtime,
      evidence,
      configuration,
      secret,
      networkAccess,
    });

    const transportRevision = await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.configuration",
      async () =>
        configuration.createRevision({
          definitionId: "ai.gateway.transport.v1",
          scopeRef: {
            schemaVersion: 1,
            resourceKind: "installation",
            resourceId: host!.host.installationId,
          },
          value: {
            schemaVersion: 1,
            timeoutMs: 30_000,
            requestBodyBudgetBytes: 60_000,
            responseBodyBudgetBytes: 1_048_576,
          },
        }),
    );
    await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.activation",
      async () => configuration.activate({ revisionId: transportRevision.revisionId }),
    );

    const gatewayProfileId = createUuidV7Id("GatewayProfileId");
    await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.gateway",
      async () =>
        aiRuntime.setGatewayProfile({
          gatewayProfileId,
          baseUrl: gateway!.baseUrl + "/",
          enabled: false,
        }),
    );
    await expect(
      runActivity(
        runtime,
        persistence,
        lineage,
        evidence,
        time,
        "model-gateway.fixture.gateway-expected-absent",
        async () =>
          aiRuntime.setGatewayProfile(
            {
              gatewayProfileId,
              baseUrl: gateway!.baseUrl,
              enabled: false,
            },
            null,
          ),
      ),
    ).rejects.toMatchObject({
      problem: { problemCode: "ai.stale_revision" },
    });
    const token = new TextEncoder().encode("local-gateway-token");
    let secretRef: import("@heptalogos/secret").SecretRef | undefined;
    try {
      secretRef = await runActivity(
        runtime,
        persistence,
        lineage,
        evidence,
        time,
        "model-gateway.fixture.secret",
        async () =>
          secret.createOrSet({
            purpose: "ai.gateway.bearer-token",
            scopeRef: {
              schemaVersion: 1,
              resourceKind: "gateway-profile",
              resourceId: gatewayProfileId,
            },
            material: token,
          }),
      );
    } finally {
      token.fill(0);
    }
    const replacementToken = new TextEncoder().encode("replaced-gateway-token");
    try {
      await runActivity(
        runtime,
        persistence,
        lineage,
        evidence,
        time,
        "model-gateway.fixture.secret-replace",
        async () =>
          secret.replace(secretRef!, {
            purpose: "ai.gateway.bearer-token",
            scopeRef: {
              schemaVersion: 1,
              resourceKind: "gateway-profile",
              resourceId: gatewayProfileId,
            },
            material: replacementToken,
          }),
      );
    } finally {
      replacementToken.fill(0);
    }
    const wrongScopeResolution = await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.secret-wrong-scope",
      async () => {
        try {
          await secret.resolve(secretRef!, {
            consumer: "system.ai-runtime",
            purpose: "ai.gateway.bearer-token",
            resourceRef: {
              schemaVersion: 1,
              resourceKind: "gateway-profile",
              resourceId: createUuidV7Id("GatewayProfileId"),
            },
          });
          return false;
        } catch (error) {
          return (
            (error as { readonly problem?: { readonly problemCode?: string } }).problem
              ?.problemCode === "secret.scope_mismatch"
          );
        }
      },
    );
    expect(wrongScopeResolution).toBe(true);
    await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.gateway-enable",
      async () =>
        aiRuntime.setGatewayProfile({
          gatewayProfileId,
          baseUrl: gateway!.baseUrl,
          apiTokenSecretRef: secretRef!,
          enabled: true,
        }),
    );

    const capabilities = [
      "text-generation",
      "structured-output",
      "usage-metadata",
      "abort-timeout",
    ] as const;
    const chatModel = await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.chat-model",
      async () =>
        aiRuntime.setModelProfile({
          gatewayProfileId,
          modelIdentifier: "fixture-chat",
          protocol: "openai-chat",
          consumedCapabilities: capabilities,
        }),
    );
    const replacedChatModel = await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.chat-model-replacement",
      async () =>
        aiRuntime.setModelProfile({
          modelProfileId: chatModel.modelProfileId,
          gatewayProfileId,
          modelIdentifier: "fixture-chat",
          protocol: "openai-chat",
          consumedCapabilities: capabilities,
        }),
    );
    expect(replacedChatModel.generation).toBe(chatModel.generation + 1);
    const responsesModel = await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.responses-model",
      async () =>
        aiRuntime.setModelProfile({
          gatewayProfileId,
          modelIdentifier: "fixture-responses",
          protocol: "openai-responses",
          consumedCapabilities: capabilities,
        }),
    );
    const chatBinding = await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.chat-binding",
      async () =>
        aiRuntime.setModelBinding({
          role: "subject.primary",
          modelProfileId: replacedChatModel.modelProfileId,
        }),
    );
    const replacedChatBinding = await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.chat-binding-replacement",
      async () =>
        aiRuntime.setModelBinding({
          role: "subject.primary",
          modelProfileId: replacedChatModel.modelProfileId,
        }),
    );
    expect(replacedChatBinding.revision).toBe(chatBinding.revision + 1);
    expect(replacedChatBinding.modelBindingId).toBe(chatBinding.modelBindingId);
    const responsesBinding = await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.responses-binding",
      async () =>
        aiRuntime.setModelBinding({
          role: "subject.expression",
          modelProfileId: responsesModel.modelProfileId,
        }),
    );
    await expect(
      runActivity(
        runtime,
        persistence,
        lineage,
        evidence,
        time,
        "model-gateway.fixture.readiness",
        async () => aiRuntime.getReadiness(),
      ),
    ).resolves.toMatchObject({ state: "READY", blockers: [] });

    const invoke = (binding: typeof chatBinding, model: string) =>
      runActivity(
        runtime,
        persistence!,
        lineage,
        evidence,
        time,
        "model-gateway.fixture.invoke." + model,
        async (context) =>
          aiRuntime.invoke({
            schemaVersion: 1,
            invocationId: createUuidV7Id("InvocationId"),
            ownerActivityRef: context.activityId,
            modelBindingId: binding.modelBindingId,
            expectedBindingRevision: binding.revision,
            contextProjection: { schemaVersion: 1, source: "fixture" },
            messages: [
              { role: "system", text: "Return the requested object only." },
              { role: "user", text: "Return the bounded fixture object." },
            ],
            objective: "Exercise one installed gateway protocol adapter",
            outputSchema,
            budget: { maxOutputTokens: 128 },
            lineageContextRef: runtime.createLineageContextRef(),
          }),
      );
    const chatResult = await invoke(replacedChatBinding, "fixture-chat");
    const responsesResult = await invoke(responsesBinding, "fixture-responses");

    expect(chatResult.protocol).toBe("openai-chat");
    expect(chatResult.modelIdentifier).toBe("fixture-chat");
    expect(chatResult.configurationRevisionId).toBe(transportRevision.revisionId);
    expect(chatResult.candidate).toMatchObject({
      schemaVersion: 1,
      ok: true,
      marker: "chat-fixture-chat",
    });
    expect(responsesResult.protocol).toBe("openai-responses");
    expect(responsesResult.modelIdentifier).toBe("fixture-responses");
    expect(responsesResult.configurationRevisionId).toBe(transportRevision.revisionId);
    expect(responsesResult.candidate).toMatchObject({
      schemaVersion: 1,
      ok: true,
      marker: "responses-fixture-responses",
    });
    expect(gateway!.requests).toHaveLength(2);
    expect(gateway!.requests[0]).toMatchObject({
      path: "/v1/chat/completions",
      authorization: "Bearer replaced-gateway-token",
      body: { model: "fixture-chat" },
    });
    expect(gateway!.requests[0].body).toMatchObject({
      response_format: { type: "json_object" },
    });
    expect(JSON.stringify(gateway!.requests[0].body.messages)).toContain(
      "schemaVersion",
    );
    expect(JSON.stringify(gateway!.requests[0].body.messages)).toContain("ok");
    expect(JSON.stringify(gateway!.requests[0].body.messages)).toContain("marker");
    expect(JSON.stringify(gateway!.requests[0].body.response_format)).not.toContain(
      "json_schema",
    );
    expect(gateway!.requests[1]).toMatchObject({
      path: "/v1/responses",
      authorization: "Bearer replaced-gateway-token",
      body: { model: "fixture-responses" },
    });
    await runActivity(
      runtime,
      persistence,
      lineage,
      evidence,
      time,
      "model-gateway.fixture.secret-revoke",
      async () => secret.revoke(secretRef!),
    );
    await expect(
      runActivity(
        runtime,
        persistence,
        lineage,
        evidence,
        time,
        "model-gateway.fixture.revoked-readiness",
        async () => aiRuntime.getReadiness(),
      ),
    ).resolves.toMatchObject({ state: "BLOCKED" });
  });
});
