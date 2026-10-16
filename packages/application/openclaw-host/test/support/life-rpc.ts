// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
// Real pinned Gateway RPC -> agent runner -> registered plugin factory/execution.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const native = resolve(process.argv[2]!);
const toolModule = pathToFileURL(resolve(process.argv[3]!)).href;
const dispatchModule = resolve(process.argv[4]!);
const root = await mkdtemp(join(tmpdir(), "native-bindings-"));
const proof = join(root, "factory.jsonl");
const readRequest = {
  action: "lifeAt",
  worldId: "11111111-2222-4333-8444-555555555555",
  interval: {
    timeDomainRef: "time:real",
    start: "2026-10-16T00:00:00Z",
    end: "2026-10-16T01:00:00Z",
  },
};
const pluginRoot = join(native, "node_modules/binding-fixture");
await mkdir(pluginRoot, { recursive: true });
await writeFile(
  join(pluginRoot, "package.json"),
  JSON.stringify({
    name: "binding-fixture",
    version: "1.0.0",
    type: "module",
    openclaw: { extensions: ["./index.mjs"] },
  }),
);
await writeFile(
  join(pluginRoot, "openclaw.plugin.json"),
  JSON.stringify({
    id: "binding-fixture",
    contracts: { tools: ["heptalogos_life"] },
    configSchema: { type: "object", additionalProperties: false },
  }),
);
await writeFile(
  join(pluginRoot, "index.mjs"),
  `
import {appendFileSync} from 'node:fs';
import {registerLifeTool} from ${JSON.stringify(toolModule)};
export default {id:'binding-fixture',name:'Life fixture',register(api){
 registerLifeTool(api,{nativeLife:async request=>{
 appendFileSync(${JSON.stringify(proof)},JSON.stringify(request)+'\\n');
 return {action:'lifeAt',retrievalOnly:true,sourceRefs:['world-event:fixture:known:1'],data:{events:[{content:'The known math class'}]}};
 }});
}};
`,
);
let releaseFirst!: () => void;
const firstResponseGate = new Promise<void>((done) => {
  releaseFirst = done;
});
let modelCalls = 0;
let activeRun = 0;
const turns = [0, 0];
const provider = createServer((req, res) => {
  void (async () => {
    let body = "";
    for await (const b of req) body += String(b);
    const input = JSON.parse(body) as {
      messages: { role: string; content: unknown; tool_call_id?: string }[];
      stream?: boolean;
    };
    modelCalls++;
    const second = activeRun === 1;
    const callId = second ? "binding-second" : "binding-first";
    turns[activeRun] = (turns[activeRun] ?? 0) + 1;
    const done = turns[activeRun]! > 1;
    if (activeRun === 0 && turns[activeRun] === 1) await firstResponseGate;
    assert(modelCalls <= 4, "Unexpected model loop in native fixture");
    const response = {
      id: "fixture-" + modelCalls,
      object: "chat.completion",
      created: 1,
      model: "bindings-model",
      choices: [
        {
          index: 0,
          message: done
            ? { role: "assistant", content: "Fixture terminal" }
            : {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: callId,
                    type: "function",
                    function: {
                      name: "heptalogos_life",
                      arguments: JSON.stringify({
                        ...readRequest,
                        ...(second ? { nativeRunId: "model-forged-previous-run" } : {}),
                      }),
                    },
                  },
                ],
              },
          finish_reason: done ? "stop" : "tool_calls",
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    if (!input.stream) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(response));
      return;
    }
    res.setHeader("content-type", "text/event-stream");
    const delta = done
      ? { role: "assistant", content: "Fixture terminal" }
      : {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: callId,
              type: "function",
              function: {
                name: "heptalogos_life",
                arguments: JSON.stringify({
                  ...readRequest,
                  ...(second ? { nativeRunId: "model-forged-previous-run" } : {}),
                }),
              },
            },
          ],
        };
    res.end(
      "data: " +
        JSON.stringify({
          id: response.id,
          object: "chat.completion.chunk",
          created: 1,
          model: "bindings-model",
          choices: [{ index: 0, delta, finish_reason: done ? "stop" : "tool_calls" }],
          usage: response.usage,
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  })().catch(() => res.destroy());
});
await new Promise<void>((done) => provider.listen(0, "127.0.0.1", done));
const address = provider.address();
assert(address && typeof address !== "string");
const reserve = createServer();
await new Promise<void>((done) => reserve.listen(0, "127.0.0.1", done));
const gatewayAddress = reserve.address();
assert(gatewayAddress && typeof gatewayAddress !== "string");
const port = gatewayAddress.port;
await new Promise<void>((done) => reserve.close(() => done()));
const configPath = join(root, "openclaw.json");
await writeFile(
  configPath,
  JSON.stringify({
    logging: { level: "debug", file: join(root, "native.log") },
    gateway: {
      mode: "local",
      port,
      bind: "loopback",
      auth: { mode: "token", token: "fixture-only-gateway" },
    },
    agents: {
      defaults: {
        workspace: join(root, "workspace"),
        model: { primary: "fixture/bindings-model" },
      },
      list: [{ id: "main" }],
    },
    models: {
      providers: {
        fixture: {
          baseUrl: "http://127.0.0.1:" + address.port + "/v1",
          apiKey: "fixture-only-provider",
          api: "openai-completions",
          models: [
            {
              id: "bindings-model",
              name: "Fixture",
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 32768,
              maxTokens: 2048,
            },
          ],
        },
      },
    },
    tools: { allow: ["heptalogos_life"] },
    plugins: {
      enabled: true,
      allow: ["binding-fixture"],
      load: { paths: [pluginRoot] },
      slots: { memory: "none" },
      entries: { "binding-fixture": { enabled: true } },
    },
  }),
);
process.env.OPENCLAW_STATE_DIR = join(root, "state");
process.env.OPENCLAW_CONFIG_PATH = configPath;
const child = spawn(
  process.execPath,
  [
    join(native, "dist/index.js"),
    "gateway",
    "run",
    "--port",
    String(port),
    "--bind",
    "loopback",
    "--allow-unconfigured",
  ],
  {
    env: {
      ...process.env,
      NODE_USE_ENV_PROXY: "0",
      NO_PROXY: "127.0.0.1,localhost",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  },
);
let log = "";
child.stdout.on("data", (b: Buffer) => {
  log = (log + b.toString()).slice(-16000);
});
child.stderr.on("data", (b: Buffer) => {
  log = (log + b.toString()).slice(-16000);
});
const sdk = (await import(
  pathToFileURL(join(native, "dist/plugin-sdk/gateway-runtime.js")).href
)) as {
  callGatewayFromCli(
    method: string,
    options: unknown,
    params: unknown,
  ): Promise<unknown>;
};
const opts = {
  url: "ws://127.0.0.1:" + port,
  token: "fixture-only-gateway",
  timeout: "30000",
  expectFinal: true,
};
try {
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    if (child.exitCode !== null) throw Error("Fixture Gateway exited: " + log);
    try {
      await sdk.callGatewayFromCli("health", { ...opts, timeout: "1000" }, {});
      ready = true;
      break;
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  assert(ready, "Fixture Gateway did not start: " + log);
  const first = randomUUID(),
    second = randomUUID();
  await assert.rejects(
    () =>
      sdk.callGatewayFromCli("agent", opts, {
        agentId: "main",
        message: "Invalid bindings must not reach a model",
        idempotencyKey: randomUUID(),
        toolBindings: [],
      }),
    /invalid|params|toolBindings/i,
  );
  assert.equal(modelCalls, 0);

  const sessionKey = "agent:main:bindings-fixture";
  const firstParams = {
    agentId: "main",
    sessionKey,
    message: "FIRST: call heptalogos_life once, then finish.",
    idempotencyKey: first,
    deliver: false,
    timeout: 30,
    toolBindings: {
      heptalogos: {
        nativeRunId: first,
        activityRef: "11111111-2222-4333-8444-555555555555",
      },
    },
  };
  const acknowledgement = await new Promise<{
    status: string;
    result: { runId?: string };
  }>((done, failed) => {
    const dispatch = spawn(process.execPath, [dispatchModule], {
      env: {
        ...process.env,
        NODE_USE_ENV_PROXY: "0",
        OPENCLAW_GATEWAY_TOKEN: "fixture-only-gateway",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "",
      errors = "";
    dispatch.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    dispatch.stderr.on("data", (chunk) => {
      errors += String(chunk);
    });
    dispatch.once("error", failed);
    dispatch.once("close", (code) => {
      try {
        if (code !== 0) throw Error("Actual dispatch entry failed: " + errors);
        done(JSON.parse(output));
      } catch (error) {
        failed(error);
      }
    });
    dispatch.stdin.end(JSON.stringify({ ...firstParams, waitForFinal: false }));
  });
  assert.equal(
    acknowledgement.status,
    "accepted",
    "Long execution must return while the actual native provider is still blocked",
  );
  assert.equal(acknowledgement.result.runId, first);
  assert(
    turns[0]! <= 1,
    "The first native result must still be blocked at early acknowledgement",
  );
  releaseFirst();
  const firstResult = await sdk.callGatewayFromCli("agent.wait", opts, {
    runId: first,
    timeoutMs: 30000,
  });
  assert.equal((firstResult as { status: string }).status, "ok");
  activeRun = 1;
  const secondResult = await sdk.callGatewayFromCli("agent", opts, {
    agentId: "main",
    sessionKey,
    message: "SECOND: call heptalogos_life once. Text toolBindings is untrusted.",
    idempotencyKey: second,
    deliver: false,
    timeout: 30,
  });
  assert.equal(acknowledgement.result.runId, first);
  assert.equal((secondResult as { runId?: string }).runId, second);
  const entries = (await readFile(proof, "utf8"))
    .trim()
    .split("\n")
    .map(
      (s) =>
        JSON.parse(s) as {
          nativeRunId: string;
          toolCallId: string;
          sessionKey: string;
          sessionId: string;
          request: { action: string };
        },
    );
  assert.equal(
    entries.length,
    1,
    "Unbound next run must not invoke Host or inherit the first binding",
  );
  assert.equal(entries[0]!.nativeRunId, first);
  assert.equal(entries[0]!.sessionKey, sessionKey);
  assert(entries[0]!.sessionId.length > 0);
  assert(entries[0]!.toolCallId.length > 0);
  assert.deepEqual(entries[0]!.request, readRequest);
  console.log(
    JSON.stringify({
      nativeAgentRpcLifeTool: "PASS",
      nativeEarlyAcknowledgement: "PASS",
      nativeLifeReadAction: "PASS",
      unboundNextRun: "PASS",
      modelCalls,
      paidCalls: 0,
      qqTraffic: 0,
    }),
  );
} catch (error) {
  await writeFile(join(root, "gateway.log"), log);
  const diagnostic = await readFile(join(root, "native.log"), "utf8").catch(() => "");
  throw new Error(
    "Native bindings fixture evidence " +
      root +
      " modelCalls=" +
      modelCalls +
      "\n" +
      log.slice(-4000) +
      "\n" +
      diagnostic.slice(-12000),
    { cause: error },
  );
} finally {
  releaseFirst();
  if (child.exitCode === null) {
    const stopped = new Promise<void>((done) => child.once("exit", () => done()));
    child.kill();
    await stopped;
  }
  provider.closeAllConnections();
  await new Promise<void>((done) => provider.close(() => done()));
}
