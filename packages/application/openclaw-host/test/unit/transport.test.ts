// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { WebSocketServer, type WebSocket } from "ws";
import { OneBotTransport } from "../../src/transport.js";
import { QqScopePolicy } from "../../src/policy.js";
const scope = new QqScopePolicy(
  new Set(["group:1072706649", "group:1101497265", "direct:2162371684"]),
  new Set(["group:1101497265", "direct:2162371684"]),
);
async function server() {
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const address = wss.address();
  if (typeof address === "string" || !address) throw Error("invalid fixture address");
  return {
    wss,
    endpoint: `ws://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of wss.clients) socket.terminate();
        wss.close(() => resolve());
      }),
  };
}
async function until(test: () => boolean) {
  const end = Date.now() + 5000;
  while (!test()) {
    if (Date.now() > end) throw Error("isolated fixture timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
it("preserves numeric protocol ids and never retries an ambiguous effect across reconnect", async () => {
  const fixture = await server();
  let online = false;
  let sends = 0;
  let connections = 0;
  fixture.wss.on("connection", (socket) => {
    connections++;
    socket.on("message", (raw) => {
      const rpc = JSON.parse(
        Buffer.concat(
          Array.isArray(raw) ? raw : [Buffer.isBuffer(raw) ? raw : Buffer.from(raw)],
        ).toString("utf8"),
      );
      if (rpc.action === "get_login_info")
        socket.send(
          `{"status":"ok","retcode":0,"echo":${JSON.stringify(rpc.echo)},"data":{"user_id":900719925474099312345}}`,
        );
      if (rpc.action === "send_group_msg") {
        sends++;
        socket.terminate();
      }
    });
  });
  const controller = new AbortController();
  const errors: string[] = [];
  const transport = new OneBotTransport({
    endpoint: fixture.endpoint,
    scope,
    requestTimeoutMs: 100,
    reconnectMinMs: 5,
    reconnectMaxMs: 20,
    onConnection: (value) => {
      online = value;
    },
    onEvent: async () => {},
    onError: (code) => errors.push(code),
    signal: controller.signal,
  });
  transport.start();
  try {
    await until(() => online);
    expect((await transport.read("get_login_info")).user_id).toBe(
      "900719925474099312345",
    );
    await expect(
      transport.send({ kind: "group", id: "1072706649" }, [
        { type: "text", data: { text: "fixture" } },
      ]),
    ).rejects.toMatchObject({ name: "QqPolicyError" });
    expect(sends).toBe(0);
    await expect(
      transport.send({ kind: "group", id: "1101497265" }, [
        { type: "text", data: { text: "literal [CQ:at,qq=all]" } },
      ]),
    ).rejects.toMatchObject({ uncertain: true, code: "disconnected" });
    await until(() => connections >= 2 && online);
    await new Promise((r) => setTimeout(r, 40));
    expect(sends).toBe(1);
  } finally {
    controller.abort();
    await transport.stop();
    await fixture.close();
  }
});
it("ignores responses from an old correlation generation and waits for accepted ingress writes at stop", async () => {
  const fixture = await server();
  let online = false;
  let oldEcho: string | undefined;
  let lastSocket: WebSocket | undefined;
  fixture.wss.on("connection", (socket) => {
    lastSocket = socket;
    socket.on("message", (raw) => {
      const rpc = JSON.parse(
        Buffer.concat(
          Array.isArray(raw) ? raw : [Buffer.isBuffer(raw) ? raw : Buffer.from(raw)],
        ).toString("utf8"),
      );
      if (!oldEcho) {
        oldEcho = rpc.echo;
        socket.terminate();
      } else {
        socket.send(
          JSON.stringify({
            status: "ok",
            retcode: 0,
            echo: oldEcho,
            data: { marker: "stale" },
          }),
        );
        setTimeout(
          () =>
            socket.send(
              JSON.stringify({
                status: "ok",
                retcode: 0,
                echo: rpc.echo,
                data: { marker: "current" },
              }),
            ),
          25,
        );
      }
    });
  });
  let finishWrite: () => void = () => {};
  let writeStarted = false;
  const writeGate = new Promise<void>((resolve) => {
    finishWrite = resolve;
  });
  const controller = new AbortController();
  const transport = new OneBotTransport({
    endpoint: fixture.endpoint,
    scope,
    requestTimeoutMs: 200,
    reconnectMinMs: 5,
    reconnectMaxMs: 20,
    onConnection: (value) => {
      online = value;
    },
    onEvent: async () => {
      writeStarted = true;
      await writeGate;
    },
    onError: () => {},
    signal: controller.signal,
  });
  transport.start();
  try {
    await until(() => online);
    await expect(transport.read("get_status")).rejects.toMatchObject({
      uncertain: false,
    });
    await until(() => online && lastSocket?.readyState === 1);
    expect((await transport.read("get_status")).marker).toBe("current");
    lastSocket!.send('{"fixture":"isolated-event"}');
    await until(() => writeStarted);
    let stopped = false;
    const stopping = transport.stop().then(() => {
      stopped = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(stopped).toBe(false);
    finishWrite();
    await stopping;
    expect(stopped).toBe(true);
  } finally {
    finishWrite();
    controller.abort();
    await transport.stop();
    await fixture.close();
  }
});
