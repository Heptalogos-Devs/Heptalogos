// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer } from "ws";
import { createGatewayHostClient } from "@heptalogos/management-client/gateway";
import { sendDurableMessageBatch } from "openclaw/plugin-sdk/channel-message";
import { createQqAccountRuntime } from "../../src/account-runtime.js";
import { createQqMessageAdapter } from "../../src/delivery.js";
import { createQqChannel } from "../../src/channel.js";
import { QqScopePolicy } from "../../src/policy.js";
import { OneBotTransport } from "../../src/transport.js";
import { OneBotPresence } from "../../src/presence.js";
import { nativeRegistry, nativeStateCloser } from "../support/native.js";
import { resolveQqNativeRoute } from "../../src/routing.js";
it("uses public durable native send with real SQLite, generated Host HTTP and one actual OneBot request per approved source", async () => {
  const state = await mkdtemp(join(tmpdir(), "qq-native-send-isolated-"));
  const previous = process.env.OPENCLAW_STATE_DIR;
  process.env.OPENCLAW_STATE_DIR = state;
  const closeNativeState = await nativeStateCloser(state);
  const accountId = "3644596926";
  let networkSends = 0;
  let rejectNext = false;
  let loseNext = false;
  const records: Array<Record<string, unknown>> = [];
  const receipts = new Map<number, { platformMessageId: string; acceptedAt: string }>();
  let nextAttempt = 0;
  let failFeedback = false;
  let denyScope = false;
  const hostServer = createServer((request, response) => {
    void (async () => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const body = raw ? JSON.parse(raw) : {};
      if (request.url === "/.well-known/heptalogos-management") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            installationId: "0199e800-0000-7000-8000-000000000001",
            bootId: "0199e800-0000-7000-8000-000000000003",
            apiBasePath: "/v1",
            contractVersion: "management.v1",
          }),
        );
        return;
      }
      expect(request.headers.authorization).toBe("Bearer fixture-service-only");
      let result: unknown;
      if (request.url?.endsWith("/scope") && denyScope) {
        response.statusCode = 403;
        response.end(JSON.stringify({ message: "fixture revoked" }));
        return;
      }
      if (request.url?.endsWith("/scope"))
        result = {
          subjectId: "fixture-original-subject",
          accountId,
          nativeAgentId: "subject-fixture",
          revision: "fixture-grant-1",
          conversations: [
            {
              kind: "group",
              conversationId: "1072706649",
              receive: true,
              observe: true,
              effects: [],
            },
            {
              kind: "group",
              conversationId: "1101497265",
              receive: true,
              observe: true,
              effects: ["send"],
            },
          ],
        };
      else if (request.url?.endsWith("/agency/adopt")) {
        expect(body.runId).toBe("fixture-native-run");
        expect(body.nativeIntentId).toBeTruthy();
        result = { reference: "behavior:fixture" };
      } else if (request.url?.endsWith("/agency/authorize"))
        result = { authorized: true };
      else if (request.url?.endsWith("/agency/begin")) {
        const old = receipts.get(body.payload.sourceIndex);
        result = old
          ? { action: "return", outcome: { state: "accepted", ...old } }
          : { action: "send", attemptId: "attempt:" + nextAttempt++ };
      } else if (request.url?.endsWith("/agency/record")) {
        records.push(body);
        if (body.outcome.state === "accepted")
          receipts.set(body.sourceIndex, {
            platformMessageId: body.outcome.platformMessageId,
            acceptedAt: body.outcome.acceptedAt,
          });
        if (failFeedback) {
          response.destroy();
          return;
        }
        result = { recorded: true };
      } else {
        response.statusCode = 404;
        result = { error: "fixture operation unavailable" };
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result));
    })();
  });
  await new Promise<void>((resolve) => hostServer.listen(0, "127.0.0.1", resolve));
  const hostAddress = hostServer.address();
  if (!hostAddress || typeof hostAddress === "string")
    throw Error("fixture host address");
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const wsAddress = wss.address();
  if (!wsAddress || typeof wsAddress === "string") throw Error("fixture ws address");
  wss.on("connection", (socket) =>
    socket.on("message", (raw) => {
      const rpc = JSON.parse(
        Buffer.concat(
          Array.isArray(raw) ? raw : [Buffer.isBuffer(raw) ? raw : Buffer.from(raw)],
        ).toString("utf8"),
      );
      let data: unknown = {};
      if (rpc.action === "get_login_info") data = { user_id: accountId };
      else if (rpc.action === "get_status") data = { online: true, good: true };
      else if (rpc.action === "get_version_info")
        data = { app_version: "isolated-fixture" };
      else if (rpc.action === "get_group_member_info")
        data = { user_id: accountId, role: "member", shut_up_timestamp: 0 };
      else if (rpc.action === "send_group_msg") {
        networkSends++;
        expect(rpc.params.message.at(-1)).toEqual({
          type: "text",
          data: { text: "identical literal [CQ:at,qq=all]" },
        });
        if (loseNext) {
          socket.terminate();
          return;
        }
        if (rejectNext) {
          socket.send(
            JSON.stringify({ status: "failed", retcode: 1200, echo: rpc.echo }),
          );
          return;
        }
        data = { message_id: "9007199254740993" + networkSends };
      }
      socket.send(JSON.stringify({ status: "ok", retcode: 0, echo: rpc.echo, data }));
    }),
  );
  const controller = new AbortController();
  const localPolicy = new QqScopePolicy(
    new Set(["group:1072706649", "group:1101497265"]),
    new Set(["group:1101497265"]),
  );
  let online = false;
  let presence: OneBotPresence | undefined;
  const transport = new OneBotTransport({
    endpoint: `ws://127.0.0.1:${wsAddress.port}`,
    scope: localPolicy,
    requestTimeoutMs: 1000,
    reconnectMinMs: 10,
    reconnectMaxMs: 20,
    onConnection: (value) => {
      online = value;
      presence?.setConnected(value);
    },
    onEvent: async () => {},
    onError: () => {},
    signal: controller.signal,
  });
  presence = new OneBotPresence(transport, accountId, localPolicy);
  transport.start();
  const hostAnchorRoot = join(state, "host");
  await mkdir(join(hostAnchorRoot, "run"), { recursive: true });
  await writeFile(
    join(hostAnchorRoot, "heptalogos.bootstrap.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId: "0199e800-0000-7000-8000-000000000001",
      roots: { RUN: join(hostAnchorRoot, "run") },
    }),
  );
  await writeFile(
    join(hostAnchorRoot, "run/management-endpoint.json"),
    JSON.stringify({
      schemaVersion: 1,
      installationId: "0199e800-0000-7000-8000-000000000001",
      bootId: "0199e800-0000-7000-8000-000000000003",
      origin: `http://127.0.0.1:${hostAddress.port}`,
    }),
  );
  const host = createGatewayHostClient({
    hostAnchorRoot,
    serviceToken: "fixture-service-only",
  });
  const message = createQqMessageAdapter({
    host,
    transport,
    presence,
    accountId,
    maxTextBytes: 4096,
    mediaMaxBytes: 1024,
    onError: () => {},
  });
  // Native request/discovery registration is a distinct channel object, but must use the already running physical account.
  const activeAccount = createQqAccountRuntime<typeof message>(
    hostAnchorRoot,
    accountId,
  );
  const ownership = activeAccount.acquire();
  activeAccount.activate(ownership, message);
  const discoveryAccount = createQqAccountRuntime<typeof message>(
    hostAnchorRoot,
    accountId,
  );
  const discoveredMessage: typeof message = {
    durableFinal: message.durableFinal,
    deliveryCustody: {
      adopt: (context) => discoveryAccount.adapter().deliveryCustody!.adopt(context),
      authorize: (context) =>
        discoveryAccount.adapter().deliveryCustody!.authorize(context),
    },
    send: {
      text: (context) => discoveryAccount.adapter().send!.text!(context),
      media: (context) => discoveryAccount.adapter().send!.media!(context),
    },
  };
  const channel = createQqChannel({
    accountId,
    maxTextBytes: 4096,
    message: discoveredMessage,
    startAccount: async () => {},
  });
  const registry = await nativeRegistry(channel);
  const cfg: Parameters<typeof sendDurableMessageBatch>[0]["cfg"] = {
    session: { dmScope: "per-account-channel-peer", groupScope: "per-group" },
    agents: { list: [{ id: "subject-fixture" }] },
    bindings: [
      { agentId: "subject-fixture", match: { channel: "heptalogos-qq", accountId } },
    ],
  };
  const route = resolveQqNativeRoute(
    cfg,
    accountId,
    { kind: "group", id: "1101497265" },
    "subject-fixture",
  );
  try {
    const end = Date.now() + 5000;
    while (!online) {
      if (Date.now() > end) throw Error("fixture connection");
      await new Promise((r) => setTimeout(r, 5));
    }
    const input: Parameters<typeof sendDurableMessageBatch>[0] = {
      cfg,
      channel: "heptalogos-qq",
      accountId,
      to: "group:1101497265",
      session: { key: route.sessionKey },
      runId: "fixture-native-run",
      deliveryIntentId: "fixture-native-intent",
      payloads: [
        { text: "identical literal [CQ:at,qq=all]" },
        { text: "identical literal [CQ:at,qq=all]" },
      ],
      durability: "required",
    };
    const result = await registry.run(() => sendDurableMessageBatch(input));
    expect(result.status).toBe("sent");
    expect(networkSends).toBe(2);
    expect(records.map((record) => record.sourceIndex)).toEqual([0, 1]);
    expect(records.map((record) => record.partIndex)).toEqual([0, 0]);
    expect(
      records.every(
        (record) => (record.outcome as { state: string }).state === "accepted",
      ),
    ).toBe(true);
    await registry.run(() => sendDurableMessageBatch(input));
    expect(networkSends).toBe(2);
    const observer = await registry.run(() =>
      sendDurableMessageBatch({
        ...input,
        to: "group:1072706649",
        deliveryIntentId: "fixture-observer",
      }),
    );
    expect(observer.status).toBe("failed");
    expect(networkSends).toBe(2);
    // These direct SDK-adapter attempts isolate known refusal and ambiguity; no real QQ endpoint exists.
    receipts.clear();
    rejectNext = true;
    const ctx = {
      cfg,
      to: "group:1101497265",
      accountId,
      text: "identical literal [CQ:at,qq=all]",
      deliveryCustody: { reference: "behavior:fixture" },
      deliveryQueueId: "fixture-queue-refusal",
      sourceIndex: 2,
      deliveryPartIndex: 0,
      deliveryPartCount: 1,
    };
    await expect(message.send!.text!(ctx)).rejects.toMatchObject({
      code: "OPENCLAW_PLATFORM_MESSAGE_NOT_DISPATCHED",
      retryable: false,
    });
    expect((records.at(-1)!.outcome as { state: string }).state).toBe("failed");
    rejectNext = false;
    loseNext = true;
    await expect(message.send!.text!({ ...ctx, sourceIndex: 3 })).rejects.toMatchObject(
      { uncertain: true },
    );
    expect((records.at(-1)!.outcome as { state: string }).state).toBe("uncertain");
    expect(networkSends).toBe(4);
    loseNext = false;
    const reconnectDeadline = Date.now() + 3000;
    while (!online) {
      if (Date.now() > reconnectDeadline) throw Error("fixture reconnect timeout");
      await new Promise((r) => setTimeout(r, 5));
    }
    failFeedback = true;
    await expect(message.send!.text!({ ...ctx, sourceIndex: 4 })).rejects.toMatchObject(
      { uncertain: true },
    );
    expect(networkSends).toBe(5);
    const original = receipts.get(4)!;
    expect(Number.isFinite(Date.parse(original.acceptedAt))).toBe(true);
    failFeedback = false;
    denyScope = true;
    const recovered = await message.send!.text!({ ...ctx, sourceIndex: 4 });
    expect(recovered.receipt?.sentAt).toBe(Date.parse(original.acceptedAt));
    expect(networkSends).toBe(5);
    await expect(
      message.send!.text!({ ...ctx, deliveryCustody: undefined, sourceIndex: 5 }),
    ).rejects.toMatchObject({ code: "OPENCLAW_PLATFORM_MESSAGE_NOT_DISPATCHED" });
    expect(networkSends).toBe(5);
  } finally {
    activeAccount.deactivate(ownership);
    controller.abort();
    await transport.stop();
    activeAccount.release(ownership);
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    hostServer.closeAllConnections();
    await new Promise<void>((resolve) => hostServer.close(() => resolve()));
    expect(closeNativeState()).toBe(true);
    if (previous === undefined) delete process.env.OPENCLAW_STATE_DIR;
    else process.env.OPENCLAW_STATE_DIR = previous;
    await rm(state, { recursive: true, force: true });
  }
}, 30000);
