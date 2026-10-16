// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { MessageReference } from "@heptalogos/messaging";
import { expandForwardReference } from "../../src/forward.js";
import { OneBotTransport } from "../../src/transport.js";
import { QqScopePolicy } from "../../src/policy.js";
it("resumes nested forward expansion from protected source state without rewriting nodes or repeating native fetches", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture address");
  const fetched: string[] = [];
  server.on("connection", (socket) =>
    socket.on("message", (raw) => {
      const request = JSON.parse(
        Buffer.concat(
          Array.isArray(raw) ? raw : [Buffer.isBuffer(raw) ? raw : Buffer.from(raw)],
        ).toString("utf8"),
      );
      fetched.push(request.params.message_id);
      const content =
        request.params.message_id === "root-forward"
          ? [
              { type: "text", data: { text: "parent" } },
              { type: "forward", data: { id: "child-forward" } },
            ]
          : [{ type: "text", data: { text: "child" } }];
      socket.send(
        JSON.stringify({
          status: "ok",
          retcode: 0,
          echo: request.echo,
          data: {
            messages: [
              {
                sender: { user_id: "900719925474099312345", nickname: "claimed" },
                content,
              },
            ],
          },
        }),
      );
    }),
  );
  const controller = new AbortController();
  let connected = false;
  const transport = new OneBotTransport({
    endpoint: `ws://127.0.0.1:${address.port}`,
    scope: new QqScopePolicy(new Set(), new Set()),
    signal: controller.signal,
    requestTimeoutMs: 1000,
    reconnectMinMs: 10,
    reconnectMaxMs: 20,
    onConnection: (value) => {
      connected = value;
    },
    onEvent: async () => {},
    onError: () => {},
  });
  transport.start();
  const archive = new Map<string, unknown>();
  const save = async (value: unknown) => {
    const ref = `archive:${archive.size}`;
    archive.set(ref, value);
    return ref;
  };
  const read = async (reference: string) => archive.get(reference);
  let reference: MessageReference = {
    referenceId: "00000000-0000-7000-8000-000000000001",
    messageId: "00000000-0000-7000-8000-000000000002",
    ordinal: 0,
    revision: 0,
    state: "pending",
    target: { kind: "forward", nativeId: "root-forward" },
  };
  try {
    const end = Date.now() + 3000;
    while (!connected) {
      if (Date.now() > end) throw Error("fixture timeout");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const first = await expandForwardReference(transport, reference, read, save, {
      maxDepth: 3,
      maxNodes: 10,
      maxBytes: 100000,
      maxRequests: 1,
    });
    expect(first.state).toBe("partial");
    expect(first.nodes).toHaveLength(1);
    expect(first.nodes?.[0]?.sourceRef).toContain("archive:");
    reference = { ...reference, ...first, revision: 1 };
    const second = await expandForwardReference(transport, reference, read, save, {
      maxDepth: 3,
      maxNodes: 10,
      maxBytes: 100000,
      maxRequests: 1,
    });
    expect(second.state).toBe("available");
    expect(second.nodes?.map((node) => [node.path, node.parentPath])).toEqual([
      ["0/1/0", "0"],
    ]);
    expect(second.nodes?.[0]?.claimedAuthor?.accountId).toBe("900719925474099312345");
    expect(fetched).toEqual(["root-forward", "child-forward"]);
  } finally {
    controller.abort();
    await transport.stop();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
