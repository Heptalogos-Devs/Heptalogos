// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
// Runs the packed artifact against its independently installed SDK and real native SQLite.
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
const runtime = resolve(process.argv[2]);
const root = await mkdtemp(join(tmpdir(), "qq-installed-artifact-"));
process.env.OPENCLAW_STATE_DIR = join(root, "native-state");
const dist = join(runtime, "node_modules/openclaw/dist");
const { t: createQueue } = await import(
  pathToFileURL(join(dist, "ingress-queue-C7H3VLUf.js"))
);
const { n: createKeyedStore, m: closeStore } = await import(
  pathToFileURL(join(dist, "plugin-state-store-PhQA2Nhh.js"))
);
const { default: entry, resolveQqNativeRoute } = await import(
  pathToFileURL(join(runtime, "node_modules/@heptalogos/openclaw-host/dist/index.js"))
);
const installed = JSON.parse(
  await readFile(
    join(runtime, "node_modules/@heptalogos/openclaw-host/package.json"),
    "utf8",
  ),
);
assert.equal(installed.devDependencies, undefined);
assert.ok(
  Object.values(installed.dependencies).every((version) =>
    /^\d+\.\d+\.\d+$/u.test(version),
  ),
);
const accountId = "3644596926";
const archives = new Map();
const accepted = [];
const routes = [];
const failures = [];
let sends = 0,
  socket,
  channel,
  status = {};
const wss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((done) => wss.once("listening", done));
wss.on("connection", (value) => {
  socket = value;
  value.on("message", (raw) => {
    const rpc = JSON.parse(
      Buffer.concat(
        Array.isArray(raw) ? raw : [Buffer.isBuffer(raw) ? raw : Buffer.from(raw)],
      ).toString("utf8"),
    );
    if (rpc.action.startsWith("send_")) sends++;
    let data = {};
    if (rpc.action === "get_login_info") data = { user_id: accountId };
    if (rpc.action === "get_status") data = { online: true, good: true };
    if (rpc.action === "get_version_info") data = { app_version: "isolated-fixture" };
    if (rpc.action.endsWith("_msg_history")) data = { messages: [] };
    value.send(JSON.stringify({ status: "ok", retcode: 0, echo: rpc.echo, data }));
  });
});
const host = createServer((request, response) => {
  void (async () => {
    try {
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
      assert.equal(request.headers.authorization, "Bearer isolated-artifact-service");
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = raw ? JSON.parse(raw) : {};
      let result;
      const route = request.url;
      if (route.endsWith("/scope"))
        result = {
          subjectId: "existing-subject-fixture",
          accountId,
          nativeAgentId: "subject-fixture",
          revision: "fixture-1",
          tools: [],
          sourceRefs: [],
          maxRunMs: 10000,
          conversations: [
            {
              kind: "group",
              conversationId: "1072706649",
              receive: true,
              observe: true,
              effects: [],
            },
          ],
        };
      else if (route.endsWith("/route")) {
        routes.push(body);
        result = { registered: true };
      } else if (
        route.endsWith("/identity/subject-account") ||
        route.endsWith("/identity/account") ||
        route.endsWith("/identity/group")
      )
        result = {
          entityRef: "entity:heptalogos:00000000-0000-7000-8000-000000000001",
        };
      else if (route.endsWith("/archive")) {
        const reference = `archive:fixture:${archives.size}`;
        archives.set(reference, body.value);
        result = { reference };
      } else if (route.endsWith("/messaging/accept")) {
        accepted.push(...body.facts);
        result = {
          results: body.facts.map(() => ({
            kind: "message",
            status: "created",
            factId: "00000000-0000-7000-8000-000000000002",
            conversationId: "00000000-0000-7000-8000-000000000003",
            pendingRef: "fixture-pending",
          })),
        };
      } else if (route.endsWith("/messaging/attachments")) result = { attachments: [] };
      else if (route.endsWith("/messaging/references")) result = { references: [] };
      else if (route.endsWith("/history/read")) result = { history: null };
      else if (route.endsWith("/history/update")) result = { ...body, revision: 0 };
      else throw Error("Unhandled isolated Host route: " + route);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(result));
    } catch (error) {
      failures.push(error.message);
      response.statusCode = 500;
      response.end("{}");
    }
  })();
});
await new Promise((done) => host.listen(0, "127.0.0.1", done));
const config = {
  connectionFile: join(root, "connection.json"),
  hostAnchorRoot: join(root, "host"),
  serviceTokenFile: join(root, "service-token"),
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
await mkdir(join(root, "host/run"), { recursive: true });
await writeFile(
  join(root, "host/heptalogos.bootstrap.json"),
  JSON.stringify({
    schemaVersion: 1,
    installationId: "0199e800-0000-7000-8000-000000000001",
    roots: { RUN: join(root, "host/run") },
  }),
);
await writeFile(
  join(root, "host/run/management-endpoint.json"),
  JSON.stringify({
    schemaVersion: 1,
    installationId: "0199e800-0000-7000-8000-000000000001",
    bootId: "0199e800-0000-7000-8000-000000000003",
    origin: `http://127.0.0.1:${host.address().port}`,
  }),
);
await writeFile(
  config.connectionFile,
  JSON.stringify({
    url: `ws://127.0.0.1:${wss.address().port}`,
    token: "fixture-only",
    accountId,
  }),
  { mode: 0o600 },
);
await writeFile(config.serviceTokenFile, "isolated-artifact-service", { mode: 0o600 });
const queue = createQueue({
  channelId: "heptalogos-qq",
  accountId,
  stateDir: process.env.OPENCLAW_STATE_DIR,
});
const cfg = {
  session: { dmScope: "per-account-channel-peer", groupScope: "per-group" },
  agents: { list: [{ id: "subject-fixture" }] },
  bindings: [
    { agentId: "subject-fixture", match: { channel: "heptalogos-qq", accountId } },
  ],
};
if (process.argv.includes("--actual-loader")) {
  const { t: loadRoot } = await import(pathToFileURL(join(dist, "loader-UHuBXZwI.js")));
  cfg.plugins = {
    enabled: true,
    allow: ["heptalogos-qq"],
    load: { paths: [join(runtime, "node_modules/@heptalogos/openclaw-host")] },
    entries: { "heptalogos-qq": { enabled: true, config } },
  };
  const registry = loadRoot({
    config: cfg,
    onlyPluginIds: ["heptalogos-qq"],
    cache: false,
  });
  channel = registry.channels.find(
    (item) => item.plugin.id === "heptalogos-qq",
  )?.plugin;
  assert.ok(channel, JSON.stringify(registry.diagnostics));
} else {
  entry.register({
    pluginConfig: config,
    registrationMode: "full",
    logger: { warn: (code) => failures.push(code) },
    registerChannel: (value) => {
      channel = value.plugin;
    },
    runtime: {
      state: {
        openChannelIngressQueue: () => queue,
        openKeyedStore: (options) => createKeyedStore("heptalogos-qq", options),
      },
    },
  });
}
assert.ok(channel);
const actual = resolveQqNativeRoute(
  cfg,
  accountId,
  { kind: "group", id: "1072706649" },
  "subject-fixture",
);
const abort = new AbortController();
const running = channel.gateway.startAccount({
  cfg,
  accountId,
  account: channel.config.resolveAccount(cfg, accountId),
  abortSignal: abort.signal,
  getStatus: () => status,
  setStatus: (value) => {
    status = value;
  },
  runtime: {},
});
async function until(check) {
  const end = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > end)
      throw Error("Installed artifact fixture timeout: " + JSON.stringify(failures));
    await new Promise((done) => setTimeout(done, 5));
  }
}
try {
  await until(() => status.connected === true);
  assert.equal(routes[0].sessionKey, actual.sessionKey);
  socket.send(
    '{"self_id":3644596926,"post_type":"message","group_id":1072706649,"user_id":2162371684,"message_id":900719925474099312345,"message":[{"type":"text","data":{"text":"installed isolated fixture"}}]}',
  );
  socket.send(
    '{"self_id":3644596926,"post_type":"message","group_id":9999999999,"user_id":2162371684,"message_id":900719925474099312346,"message":[]}',
  );
  await until(() => accepted.length === 1);
  await queue.listClaims();
  assert.equal(accepted[0].nativeMessageId, "900719925474099312345");
  assert.match(accepted[0].author.entityRef, /^entity:heptalogos:/u);
  assert.equal(sends, 0);
  assert.equal(failures.length, 0, failures.join("; "));
} finally {
  abort.abort();
  await running;
  for (const client of wss.clients) client.terminate();
  await new Promise((done) => wss.close(done));
  host.closeAllConnections();
  await new Promise((done) => host.close(done));
  const quotaOptions = { namespace: "qq-media-budget-" + accountId, maxEntries: 2 };
  const quota = createKeyedStore("heptalogos-qq", quotaOptions);
  await Promise.all(
    Array.from({ length: 10 }, () =>
      quota.update("2026-10-16", (current) => (current ?? 0) + 5),
    ),
  );
  closeStore();
  const reopened = createKeyedStore("heptalogos-qq", quotaOptions);
  assert.equal(await reopened.lookup("2026-10-16"), 50);
  await assert.rejects(
    reopened.update("2026-10-16", () => {
      throw Error("fixture budget exceeded");
    }),
  );
  assert.equal(await reopened.lookup("2026-10-16"), 50);
  closeStore();
  await rm(root, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    installedArtifact: true,
    realNativeSQLite: true,
    exactRoute: true,
    losslessIngress: true,
    persistentAtomicBudget: true,
    sends,
  }),
);
