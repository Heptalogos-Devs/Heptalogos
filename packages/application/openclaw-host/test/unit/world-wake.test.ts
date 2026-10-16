// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { wakeWorld, validateWorldWake } from "../../src/world-wake.js";
const endpoint = vi.hoisted(() => ({ origin: "", installationId: "" }));
vi.mock("@heptalogos/management-client/discovery", () => ({
  createLocalManagementEndpointReader: () => ({
    read: async () => ({
      installationId: endpoint.installationId,
      endpoint: { origin: endpoint.origin },
    }),
  }),
}));
describe("deterministic native world callback", () => {
  it("uses only a private local service credential and never starts a model or channel", async () => {
    const dir = await mkdtemp(join(tmpdir(), "world-wake-"));
    const credentialFile = join(dir, "channel-service-token");
    const token = "a".repeat(64);
    await writeFile(credentialFile, token, { mode: 0o600 });
    const received: { path?: string; auth?: string; body?: unknown } = {};
    const server = createServer((req, res) => {
      void (async () => {
        let body = "";
        for await (const chunk of req) body += chunk;
        received.path = req.url;
        received.auth = req.headers.authorization;
        received.body = JSON.parse(body);
        res.setHeader("content-type", "application/json");
        res.end('{"status":"processed"}');
      })().catch(() => res.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw Error("missing port");
    const request = {
      subjectId: randomUUID(),
      worldId: randomUUID(),
      activityId: randomUUID(),
      requestId: randomUUID(),
    };
    const input = {
      hostAnchorRoot: dir,
      installationId: randomUUID(),
      credentialFile,
      request,
    };
    endpoint.origin = `http://127.0.0.1:${address.port}`;
    endpoint.installationId = input.installationId;
    try {
      expect(await wakeWorld(input)).toEqual({ status: "processed" });
      expect(received).toEqual({
        path: "/gateway/v1/reactor/opportunity",
        auth: `Bearer ${token}`,
        body: request,
      });
      expect(() =>
        validateWorldWake({ ...input, hostAnchorRoot: "relative-root" }),
      ).toThrow("invalid_world_wake");
      expect(() =>
        validateWorldWake({ ...input, credentialFile: "relative-token" }),
      ).toThrow("invalid_world_wake");
      if (process.platform !== "win32") {
        await chmod(credentialFile, 0o644);
        await expect(wakeWorld(input)).rejects.toThrow("world_wake_credential_invalid");
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(dir, { recursive: true, force: true });
    }
  });
});
