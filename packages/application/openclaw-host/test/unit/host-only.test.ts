// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/channel-plugin-common";
import { registerQqChannel } from "../../src/runtime.js";
import { parseNativePluginConfig } from "../../src/config.js";
const exec = promisify(execFile);
it("prepares the real Host bridge and registers Life without any QQ connection", async () => {
  const root = await mkdtemp(join(tmpdir(), "host-only-native-"));
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        installationId: "0199e800-0000-7000-8000-000000000001",
        bootId: "0199e800-0000-7000-8000-000000000002",
        apiBasePath: "/v1",
        contractVersion: "management.v1",
      }),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const config = { hostAnchorRoot: root, serviceTokenFile: join(root, "service") };
    await writeFile(config.serviceTokenFile, "fixture-service", { mode: 0o600 });
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Missing fixture listener");
    const origin = "http://127.0.0.1:" + address.port;
    await writeFile(
      join(root, "heptalogos.bootstrap.json"),
      JSON.stringify({
        schemaVersion: 1,
        installationId: "0199e800-0000-7000-8000-000000000001",
        roots: { RUN: root },
      }),
    );
    await writeFile(
      join(root, "management-endpoint.json"),
      JSON.stringify({
        schemaVersion: 1,
        installationId: "0199e800-0000-7000-8000-000000000001",
        bootId: "0199e800-0000-7000-8000-000000000002",
        origin,
      }),
    );
    const profile = {
      agents: { list: [{ id: "student-planner" }] },
      plugins: {
        entries: {
          "heptalogos-qq": { enabled: true, config },
          "nous-cognition": {
            enabled: true,
            config: {
              hostBridge: {
                origin: "http://127.0.0.1:1",
                credentialFile: config.serviceTokenFile,
              },
            },
          },
        },
      },
    };
    const path = join(root, "profile.json");
    await writeFile(path, JSON.stringify(profile), { mode: 0o600 });
    const result = await exec(process.execPath, [
      fileURLToPath(new URL("../../dist/prepare-gateway.js", import.meta.url)),
      path,
    ]);
    expect(JSON.parse(result.stdout)).toEqual({
      installationId: "0199e800-0000-7000-8000-000000000001",
      bootId: "0199e800-0000-7000-8000-000000000002",
      origin,
    });
    profile.plugins.entries["nous-cognition"].config.hostBridge.origin = origin;
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(profile);
    const registerTool = vi.fn(),
      registerChannel = vi.fn();
    registerQqChannel({
      pluginConfig: config,
      registerTool,
      registerChannel,
    } as unknown as OpenClawPluginApi);
    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0]![1]).toEqual({ name: "heptalogos_life" });
    expect(registerChannel).not.toHaveBeenCalled();
    expect(() =>
      parseNativePluginConfig({ ...config, connectionFile: join(root, "absent") }),
    ).toThrow("configuration is invalid");
    const qq = {
      ...config,
      connectionFile: join(root, "absent"),
      mediaTempRoot: join(root, "media"),
      napcatExportRoots: [],
      requestTimeoutMs: 1000,
      reconnectMinMs: 10,
      reconnectMaxMs: 30,
      maxTextBytes: 4096,
      mediaMaxBytes: 100000,
      mediaConcurrency: 1,
      mediaDailyBytes: 1000000,
      forwardMaxDepth: 4,
      forwardMaxNodes: 16,
      forwardMaxBytes: 100000,
      forwardMaxRequests: 2,
      historyPageSize: 10,
      historyMaxPages: 2,
    };
    expect(() =>
      registerQqChannel({
        pluginConfig: qq,
        registerTool,
        registerChannel,
      } as unknown as OpenClawPluginApi),
    ).toThrow(/ENOENT/);
    await writeFile(qq.connectionFile, "{}", { mode: 0o600 });
    expect(() =>
      registerQqChannel({
        pluginConfig: qq,
        registerTool,
        registerChannel,
      } as unknown as OpenClawPluginApi),
    ).toThrow("connection file is invalid");
    await rm(config.serviceTokenFile);
    await expect(
      exec(process.execPath, [
        fileURLToPath(new URL("../../dist/prepare-gateway.js", import.meta.url)),
        path,
      ]),
    ).rejects.toThrow();
  } finally {
    await new Promise<void>((done, fail) =>
      server.close((error) => (error ? fail(error) : done())),
    );
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
