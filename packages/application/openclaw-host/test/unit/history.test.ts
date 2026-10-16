// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { readHistoryPage, historyMadeProgress } from "../../src/history.js";
import { inspectNativeEnvelope } from "../../src/parser.js";
import { OneBotTransport } from "../../src/transport.js";
import { QqScopePolicy } from "../../src/policy.js";
it("keeps incoming and outgoing DM history in the exact peer lane and detects a repeated provider window", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture address");
  server.on("connection", (socket) =>
    socket.on("message", (frame) => {
      const request = JSON.parse(
        Buffer.concat(
          Array.isArray(frame)
            ? frame
            : [Buffer.isBuffer(frame) ? frame : Buffer.from(frame)],
        ).toString("utf8"),
      );
      expect(request.action).toBe("get_friend_msg_history");
      expect(request.params.user_id).toBe("peer");
      expect(request.params.reverse_order).toBe(false);
      socket.send(
        `{"status":"ok","retcode":0,"echo":${JSON.stringify(request.echo)},"data":{"messages":[{"message_id":900719925474099312345,"message_seq":900719925474099312340,"user_id":"peer","sender":{"user_id":"peer"},"message":[]},{"message_id":900719925474099312346,"message_seq":900719925474099312341,"user_id":"account","sender":{"user_id":"account"},"message":[]}]}}`,
      );
    }),
  );
  const scope = new QqScopePolicy(new Set(["direct:peer"]), new Set());
  const controller = new AbortController();
  let online = false;
  const transport = new OneBotTransport({
    endpoint: `ws://127.0.0.1:${address.port}`,
    scope,
    requestTimeoutMs: 1000,
    reconnectMinMs: 5,
    reconnectMaxMs: 10,
    signal: controller.signal,
    onConnection: (value) => {
      online = value;
    },
    onEvent: async () => {},
    onError: () => {},
  });
  transport.start();
  try {
    const end = Date.now() + 3000;
    while (!online) {
      if (Date.now() > end) throw Error("fixture timeout");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const conversation = {
      platform: "qq",
      accountId: "account",
      kind: "direct" as const,
      conversationId: "peer",
    };
    const first = await readHistoryPage(transport, scope, conversation, null, 10);
    const facts = first.envelopes.flatMap(
      (envelope) => inspectNativeEnvelope(envelope, "account", scope)?.facts ?? [],
    );
    expect(facts.map((fact) => fact.conversation.conversationId)).toEqual([
      "peer",
      "peer",
    ]);
    expect(
      facts.map((fact) => (fact.kind === "message" ? fact.direction : undefined)),
    ).toEqual(["INBOUND", "OUTBOUND"]);
    expect(first.cursor).toBe("900719925474099312340");
    expect(first.coverage).toBe("limited");
    const second = await readHistoryPage(
      transport,
      scope,
      conversation,
      first.cursor,
      10,
    );
    expect(
      historyMadeProgress(
        { cursor: first.cursor, fingerprint: first.fingerprint },
        second,
      ),
    ).toBe(false);
    await expect(
      readHistoryPage(
        transport,
        scope,
        { ...conversation, conversationId: "ungranted" },
        null,
        10,
      ),
    ).rejects.toThrow("outside Host scope");
  } finally {
    controller.abort();
    await transport.stop();
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
