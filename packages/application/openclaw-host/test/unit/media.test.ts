// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, stat, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { OneBotTransport } from "../../src/transport.js";
import { QqScopePolicy } from "../../src/policy.js";
import { acquireProtocolMedia } from "../../src/media.js";
it("acquires a protocol-confirmed controlled export with byte quota, private temp permissions and MIME sniffing", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-media-isolated-"));
  const exports = join(root, "exports");
  const temp = join(root, "temporary");
  await mkdir(exports);
  const original = join(exports, "misleading.jpg");
  const bytes = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082",
    "hex",
  );
  await writeFile(original, bytes);
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const address = wss.address();
  if (!address || typeof address === "string")
    throw Error("fixture address unavailable");
  let online = false;
  wss.on("connection", (socket) =>
    socket.on("message", (raw) => {
      const request = JSON.parse(
        Buffer.concat(
          Array.isArray(raw) ? raw : [Buffer.isBuffer(raw) ? raw : Buffer.from(raw)],
        ).toString("utf8"),
      );
      socket.send(
        JSON.stringify({
          status: "ok",
          retcode: 0,
          echo: request.echo,
          data: { file: original },
        }),
      );
    }),
  );
  const controller = new AbortController();
  const transport = new OneBotTransport({
    endpoint: `ws://127.0.0.1:${address.port}`,
    scope: new QqScopePolicy(new Set(), new Set()),
    requestTimeoutMs: 1000,
    reconnectMinMs: 5,
    reconnectMaxMs: 10,
    onConnection: (value) => {
      online = value;
    },
    onEvent: async () => {},
    onError: () => {},
    signal: controller.signal,
  });
  transport.start();
  let charged = 0;
  try {
    while (!online) await new Promise((r) => setTimeout(r, 5));
    const options = {
      tempRoot: temp,
      exportRoots: [exports],
      maxBytes: 1024,
      timeoutMs: 1000,
      reserveBytes: async (size: number) => {
        charged += size;
      },
      signal: controller.signal,
    };
    const acquired = await acquireProtocolMedia(
      transport,
      { type: "image", data: { file: "official-native-file-id" } },
      options,
    );
    expect(acquired.mediaType).toBe("image/png");
    expect(acquired.bytes).toBe(bytes.length);
    expect(charged).toBe(bytes.length);
    expect((await stat(acquired.path)).mode & 0o777).toBe(0o600);
    expect(acquired.path).not.toMatch(/\.jpg$/);
    await acquired.dispose();
    await expect(
      acquireProtocolMedia(
        transport,
        { type: "image", data: { file: "official-native-file-id" } },
        { ...options, maxBytes: 2 },
      ),
    ).rejects.toMatchObject({ code: "size_limit", retryable: false });
    expect(await readdir(temp)).toEqual([]);
    await expect(
      acquireProtocolMedia(
        transport,
        { type: "image", data: { url: "http://127.0.0.1/private-secret" } },
        options,
      ),
    ).rejects.toMatchObject({ code: "source_unavailable" });
    await expect(
      acquireProtocolMedia(
        transport,
        { type: "file", data: { file: "official-native-file-id" } },
        { ...options, exportRoots: [join(root, "other")] },
      ),
    ).rejects.toMatchObject({ code: "source_unavailable" });
  } finally {
    controller.abort();
    await transport.stop();
    for (const socket of wss.clients) socket.terminate();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
