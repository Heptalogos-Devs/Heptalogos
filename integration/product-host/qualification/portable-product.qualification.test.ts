// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { createOsCredentialStore } from "../../../packages/system/os-credential/dist/index.js";
import { createSubjectGatewayFixture } from "../support/subject-gateway-fixture.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const nodeExecutableName = process.platform === "win32" ? "node.exe" : "bin/node";
const launcherName = process.platform === "win32" ? "heptalogos.cmd" : "heptalogos";
const comspec =
  process.env.ComSpec ??
  process.env.COMSPEC ??
  (process.platform === "win32" ? "C:\\Windows\\System32\\cmd.exe" : "/bin/sh");

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface PortableHost {
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: {
    readonly installationId: string;
    readonly bootId: string;
    readonly origin: string;
  };
  stop(): Promise<void>;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function commandQuote(value: string): string {
  return /[\s&|<>^]/u.test(value) ? '"' + value + '"' : value;
}

function commandLine(executable: string, args: readonly string[]): string {
  return [commandQuote(executable), ...args.map(commandQuote)].join(" ");
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "COMSPEC",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "OS",
    "PROCESSOR_ARCHITECTURE",
    "PROCESSOR_IDENTIFIER",
    "NUMBER_OF_PROCESSORS",
    "LANG",
    "LANGUAGE",
    "TERM",
    "COLORTERM",
    "TZ",
  ];
  const environment: NodeJS.ProcessEnv = {};
  for (const name of allowed) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }
  if (environment.HOME === undefined && environment.USERPROFILE !== undefined) {
    environment.HOME = environment.USERPROFILE;
  }
  if (process.platform === "win32") {
    environment.Path = join(environment.SystemRoot ?? "C:\\Windows", "System32");
  } else {
    environment.PATH = "/usr/bin:/bin";
  }
  return environment;
}

// Intentional duplication: portable qualification captures arbitrary launcher
// commands, while the support helper owns the Product CLI's fixed invocation.
/* jscpd:ignore-start */
function runCommand(
  executable: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
    readonly input?: string;
  },
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", reject);
    child.once("exit", (code) =>
      resolvePromise({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}
/* jscpd:ignore-end */

async function runChecked(
  executable: string,
  args: readonly string[],
  cwd: string,
  env = process.env,
): Promise<string> {
  const result = await runCommand(executable, args, { cwd, env });
  if (result.code !== 0) {
    fail(
      executable +
        " " +
        args.join(" ") +
        " failed (" +
        result.code +
        "): " +
        (result.stderr || result.stdout),
    );
  }
  return result.stdout;
}

async function portableCliRaw(
  root: string,
  args: readonly string[],
  input?: string,
): Promise<CommandResult> {
  const launcher = join(root, "bin", launcherName);
  const command = commandLine(launcher, args);
  const shellArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-c", command];
  return runCommand(comspec, shellArgs, {
    cwd: root,
    env: safeEnvironment(),
    input,
  });
}

async function portableCli(
  root: string,
  args: readonly string[],
  input?: string,
): Promise<Record<string, any>> {
  const result = await portableCliRaw(root, args, input);
  if (result.code !== 0) {
    fail(
      "Portable CLI failed (" +
        args.join(" ") +
        "): " +
        (result.stderr || result.stdout),
    );
  }
  try {
    return JSON.parse(result.stdout) as Record<string, any>;
  } catch (error) {
    fail(
      "Portable CLI did not return JSON (" +
        args.join(" ") +
        "): " +
        String(error) +
        "; " +
        result.stdout,
    );
  }
}

async function readLocator(root: string): Promise<Record<string, any>> {
  return JSON.parse(
    await readFile(join(root, "heptalogos.bootstrap.json"), "utf8"),
  ) as Record<string, any>;
}

async function endpointOrigin(locator: Record<string, any>): Promise<string> {
  const endpoint = JSON.parse(
    await readFile(join(locator.roots.RUN, "management-endpoint.json"), "utf8"),
  ) as Record<string, unknown>;
  assertCondition(
    typeof endpoint.origin === "string",
    "Management endpoint descriptor is invalid",
  );
  return endpoint.origin;
}

async function requestJson(
  origin: string,
  path: string,
  options: RequestInit = {},
): Promise<{ readonly response: Response; readonly body: Record<string, any> }> {
  const response = await fetch(origin + path, {
    ...options,
    headers: {
      "x-heptalogos-contract-version": "management.v1",
      ...(options.headers ?? {}),
    },
  });
  return { response, body: (await response.json()) as Record<string, any> };
}

async function applyAction(
  root: string,
  action: Record<string, any>,
): Promise<Record<string, any>> {
  const plan = await portableCli(
    root,
    ["action", "plan", "--input-stdin", "--json"],
    JSON.stringify(action),
  );
  const executed = await portableCli(
    root,
    ["action", "execute", "--input-stdin", "--json"],
    JSON.stringify({ plan, action }),
  );
  assertCondition(
    executed.postconditionsVerified === true,
    action.actionId + " postconditions were not verified",
  );
  return executed;
}

// Intentional duplication: this clean qualification starts the assembled
// launcher from a source-less Product root; support/fixture.ts starts the
// repository-built host and has a different lifecycle evidence boundary.
/* jscpd:ignore-start */
async function startPortableHost(
  root: string,
  nodeRoot: string,
): Promise<PortableHost> {
  const launcher = join(root, "bin", "portable-launcher.mjs");
  const child = spawn(join(nodeRoot, nodeExecutableName), [launcher, "start"], {
    cwd: root,
    env: safeEnvironment(),
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdin.end();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const stdoutReader = createInterface({ input: child.stdout });
  const stderrReader = createInterface({ input: child.stderr });
  const ready = await new Promise<PortableHost["ready"]>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Portable Product Host did not publish READY: " + stderr));
      child.kill();
    }, 150_000);
    const inspect = (line: string) => {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        if (
          value.type === "READY" &&
          typeof value.installationId === "string" &&
          typeof value.bootId === "string" &&
          typeof value.origin === "string"
        ) {
          clearTimeout(timer);
          resolvePromise({
            installationId: value.installationId,
            bootId: value.bootId,
            origin: value.origin,
          });
        } else if (value.type === "ERROR") {
          clearTimeout(timer);
          reject(new Error("Portable Product Host startup failed: " + line));
        }
      } catch {
        // Wait for the machine-readable READY line.
      }
    };
    stdoutReader.on("line", inspect);
    stderrReader.on("line", inspect);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(
        new Error(
          "Portable Product Host exited before READY (" + code + "): " + stderr,
        ),
      );
    });
  });
  stdoutReader.close();
  stderrReader.close();
  return {
    child,
    ready,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolvePromise, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Portable Product Host did not stop")),
          60_000,
        );
        child.once("exit", () => {
          clearTimeout(timer);
          resolvePromise();
        });
      });
    },
  };
}
/* jscpd:ignore-end */

async function waitFor(
  predicate: () => Promise<boolean>,
  message: string | (() => string),
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  fail(typeof message === "function" ? message() : message);
}

async function runtimeDatabase(locator: Record<string, any>): Promise<Client> {
  const pidFile = await readFile(
    join(locator.roots.DATA, "private-postgres", "postmaster.pid"),
    "utf8",
  );
  const postgresPort = Number(pidFile.split(/\r?\n/u)[3]);
  assertCondition(
    Number.isInteger(postgresPort) && postgresPort > 0,
    "Private PostgreSQL port is invalid",
  );
  const credentialStore = createOsCredentialStore();
  const runtimePassword = await credentialStore.withCredential(
    {
      service: "Heptalogos/" + locator.installationId,
      account: "bootstrap/private-postgres-runtime-role",
    },
    async (bytes) => new TextDecoder().decode(bytes),
  );
  const database = new Client({
    host: "127.0.0.1",
    port: postgresPort,
    database: "heptalogos",
    user: "heptalogos_runtime",
    password: runtimePassword,
  });
  await database.connect();
  return database;
}

async function readSubjectFacts(
  locator: Record<string, any>,
  conversationId: string,
): Promise<{
  readonly reactions: readonly Record<string, any>[];
  readonly outbound: readonly Record<string, any>[];
  readonly outboundCount: number;
}> {
  const database = await runtimeDatabase(locator);
  try {
    const reactions = await database.query(
      "SELECT r.reaction_id, r.state, c.communication_commit_id, " +
        "c.primary_cognition_provenance, w.work_item_id, " +
        "w.state AS work_state, w.state_reason_code AS work_reason " +
        'FROM "heptalogos"."reaction" r ' +
        'LEFT JOIN "heptalogos"."communication_commit" c ON c.reaction_id = r.reaction_id ' +
        'JOIN "heptalogos"."work_item" w ON w.work_item_id = r.owner_work_item_id ' +
        "WHERE r.conversation_id = $1 ORDER BY r.created_at, r.reaction_id",
      [conversationId],
    );
    const outbound = await database.query(
      "SELECT message_id, caused_by_communication_commit_id, text " +
        'FROM "heptalogos"."message_fact" ' +
        "WHERE conversation_id = $1 AND direction = 'OUTBOUND' ORDER BY sequence",
      [conversationId],
    );
    return {
      reactions: reactions.rows as Record<string, any>[],
      outbound: outbound.rows as Record<string, any>[],
      outboundCount: outbound.rowCount ?? 0,
    };
  } finally {
    await database.end();
  }
}

async function waitForReaction(
  locator: Record<string, any>,
  conversationId: string,
  predicate: (
    snapshot: Awaited<ReturnType<typeof readSubjectFacts>>,
    latest: Record<string, any> | undefined,
  ) => boolean,
  message: string,
): Promise<Awaited<ReturnType<typeof readSubjectFacts>>> {
  let snapshot: Awaited<ReturnType<typeof readSubjectFacts>> | undefined;
  await waitFor(async () => {
    snapshot = await readSubjectFacts(locator, conversationId);
    return predicate(snapshot, snapshot.reactions[snapshot.reactions.length - 1]);
  }, message);
  return snapshot!;
}

async function processExists(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function stopPortablePostgres(root: string, pid: number): Promise<void> {
  if (!(await processExists(pid))) return;
  const dataDirectory = join(root, "data", "private-postgres");
  const pgctl = join(
    root,
    "runtime",
    "postgresql",
    "bin",
    process.platform === "win32" ? "pg_ctl.exe" : "pg_ctl",
  );
  const result = await runCommand(
    pgctl,
    ["stop", "--pgdata", dataDirectory, "--mode=fast", "--wait", "--timeout", "60"],
    { cwd: root, env: safeEnvironment() },
  );
  if (result.code !== 0) {
    fail(
      "Bundled PostgreSQL stop failed (" +
        result.code +
        "): " +
        (result.stderr || result.stdout),
    );
  }
}

async function findRuntimeRoots(): Promise<{
  readonly nodeRoot: string;
  readonly postgresRoot: string;
}> {
  const nodeRootOverride = process.env.HEPTALOGOS_PORTABLE_NODE_ROOT;
  const postgresRootOverride = process.env.HEPTALOGOS_PORTABLE_POSTGRES_ROOT;
  const stageRoot =
    nodeRootOverride === undefined
      ? await (async () => {
          const entries = await readdir(join(repositoryRoot, "tmp"), {
            withFileTypes: true,
          });
          const candidates = entries
            .filter(
              (entry) => entry.isDirectory() && /^p4-portable-stage-/u.test(entry.name),
            )
            .map((entry) => join(repositoryRoot, "tmp", entry.name, "runtime", "node"))
            .sort()
            .reverse();
          return candidates[0];
        })()
      : undefined;
  const nodeRoot = nodeRootOverride ?? stageRoot;
  const postgresRoot =
    postgresRootOverride ?? resolve(repositoryRoot, "tmp/pg/extracted/pgsql");
  assertCondition(
    nodeRoot !== undefined,
    "Portable Node runtime root is not available",
  );
  await access(join(nodeRoot, nodeExecutableName));
  await access(
    join(
      postgresRoot,
      "bin",
      process.platform === "win32" ? "postgres.exe" : "postgres",
    ),
  );
  return { nodeRoot, postgresRoot };
}

async function assembleCandidate(
  nodeRoot: string,
  postgresRoot: string,
  workspaceStatus: string,
): Promise<{ readonly assemblyRoot: string; readonly candidateRoot: string }> {
  const parent = await mkdtemp(join(tmpdir(), "heptalogos-portable-qualification-"));
  const assemblyRoot = join(parent, "assembled");
  const candidateRoot = join(parent, "candidate");
  await runChecked(
    process.execPath,
    [
      resolve(repositoryRoot, "scripts/package/assemble-portable-product.mjs"),
      "--target",
      assemblyRoot,
      "--host-artifact",
      resolve(repositoryRoot, "packages/application/product-host/dist"),
      "--cli-artifact",
      resolve(repositoryRoot, "packages/application/cli/dist"),
      "--node-root",
      nodeRoot,
      "--postgres-root",
      postgresRoot,
    ],
    repositoryRoot,
  );
  const assembledManifest = JSON.parse(
    await readFile(join(assemblyRoot, "manifest.json"), "utf8"),
  ) as { readonly productGeneration: string };
  const assembledProductRoot = join(
    assemblyRoot,
    "program",
    "product",
    assembledManifest.productGeneration,
  );
  await mkdir(join(assemblyRoot, "config"), { recursive: true });
  await writeFile(join(assemblyRoot, "config", "incremental-marker.txt"), "preserve\n");
  const stablePaths = [
    join(assemblyRoot, "runtime", "node", nodeExecutableName),
    join(
      assemblyRoot,
      "runtime",
      "postgresql",
      "bin",
      process.platform === "win32" ? "postgres.exe" : "postgres",
    ),
    join(assembledProductRoot, "bin.js"),
  ];
  const beforeIncremental = await Promise.all(stablePaths.map((path) => lstat(path)));
  const incrementalOutput = await runChecked(
    process.execPath,
    [
      resolve(repositoryRoot, "scripts/package/assemble-portable-product.mjs"),
      "--target",
      assemblyRoot,
      "--incremental",
      "--host-artifact",
      resolve(repositoryRoot, "packages/application/product-host/dist"),
      "--cli-artifact",
      resolve(repositoryRoot, "packages/application/cli/dist"),
      "--node-root",
      nodeRoot,
      "--postgres-root",
      postgresRoot,
    ],
    repositoryRoot,
  );
  expect(incrementalOutput).toContain("PASS portable Product unchanged");
  const afterIncremental = await Promise.all(stablePaths.map((path) => lstat(path)));
  expect(afterIncremental.map((entry) => entry.mtimeMs)).toEqual(
    beforeIncremental.map((entry) => entry.mtimeMs),
  );
  await expect(
    readFile(join(assemblyRoot, "config", "incremental-marker.txt"), "utf8"),
  ).resolves.toBe("preserve\n");
  await rename(assemblyRoot, candidateRoot);
  const afterStatus = await runChecked(
    "git",
    ["status", "--porcelain"],
    repositoryRoot,
  );
  expect(afterStatus).toBe(workspaceStatus);
  return { assemblyRoot, candidateRoot };
}

async function configureSubject(
  root: string,
  origin: string,
  installationId: string,
  subjectId: string,
  gatewayUrl: string,
  headers: Record<string, string>,
): Promise<void> {
  const capabilities = [
    "text-generation",
    "structured-output",
    "usage-metadata",
    "abort-timeout",
  ];
  const installationScope = {
    schemaVersion: 1,
    resourceKind: "installation",
    resourceId: installationId,
  };
  const subjectScope = {
    schemaVersion: 1,
    resourceKind: "subject",
    resourceId: subjectId,
  };
  const transport = await applyAction(root, {
    actionId: "configuration.revision.create",
    input: {
      definitionId: "ai.gateway.transport.v1",
      scopeRef: installationScope,
      value: {
        schemaVersion: 1,
        timeoutMs: 30_000,
        requestBodyBudgetBytes: 60_000,
        responseBodyBudgetBytes: 1_048_576,
      },
    },
  });
  await applyAction(root, {
    actionId: "configuration.activate",
    input: { revisionId: transport.result.revisionId },
  });
  const cognition = await applyAction(root, {
    actionId: "configuration.revision.create",
    input: {
      definitionId: "subject.cognition.runtime.v1",
      scopeRef: subjectScope,
      value: {
        schemaVersion: 1,
        enabled: true,
        maxOutputTokens: 256,
        runTimeoutMs: 60_000,
        maxContextBytes: 65_536,
      },
    },
  });
  const cognitionState = await requestJson(origin, "/management/v1/product/state", {
    headers,
  });
  const activeCognition = cognitionState.body.data.configuration.activations.find(
    (activation: Record<string, any>) =>
      activation.definitionId === "subject.cognition.runtime.v1" &&
      activation.scopeRef.resourceId === subjectId,
  );
  await applyAction(root, {
    actionId: "configuration.activate",
    input: {
      revisionId: cognition.result.revisionId,
      ...(activeCognition === undefined
        ? {}
        : { expectedActiveRevisionId: activeCognition.activeRevisionId }),
    },
  });
  const gatewayProfileId = "0199c5e4-1111-7111-8111-111111111111";
  const primaryModelProfileId = "0199c5e4-2222-7222-8222-222222222222";
  const expressionModelProfileId = "0199c5e4-3333-7333-8333-333333333333";
  await applyAction(root, {
    actionId: "gateway-profile.set",
    input: { gatewayProfileId, baseUrl: gatewayUrl, enabled: true },
  });
  await applyAction(root, {
    actionId: "model-profile.set",
    input: {
      modelProfileId: primaryModelProfileId,
      gatewayProfileId,
      modelIdentifier: "subject-primary",
      protocol: "openai-chat",
      consumedCapabilities: capabilities,
    },
  });
  await applyAction(root, {
    actionId: "model-profile.set",
    input: {
      modelProfileId: expressionModelProfileId,
      gatewayProfileId,
      modelIdentifier: "subject-expression",
      protocol: "openai-responses",
      consumedCapabilities: capabilities,
    },
  });
  await applyAction(root, {
    actionId: "model-binding.set",
    input: { role: "subject.primary", modelProfileId: primaryModelProfileId },
  });
  await applyAction(root, {
    actionId: "model-binding.set",
    input: {
      role: "subject.expression",
      modelProfileId: expressionModelProfileId,
    },
  });
  const state = await requestJson(origin, "/management/v1/product/state", { headers });
  assertCondition(
    state.body.data.aiReadiness.state === "READY",
    "AI readiness was not READY",
  );
}

describe("Windows portable Product qualification", () => {
  it(
    "runs the copied source-less Product through interaction and restart",
    { timeout: 900_000 },
    async () => {
      expect(process.platform).toBe("win32");
      expect(process.arch).toBe("x64");
      const workspaceStatus = await runChecked(
        "git",
        ["status", "--porcelain"],
        repositoryRoot,
      );
      const { nodeRoot, postgresRoot } = await findRuntimeRoots();
      const gateway = await createSubjectGatewayFixture();
      let assemblyRoot: string | undefined;
      let candidateRoot: string | undefined;
      let host: PortableHost | undefined;
      try {
        ({ assemblyRoot, candidateRoot } = await assembleCandidate(
          nodeRoot,
          postgresRoot,
          workspaceStatus,
        ));
        const manifest = JSON.parse(
          await readFile(join(candidateRoot, "manifest.json"), "utf8"),
        ) as Record<string, any>;
        expect(manifest.target).toEqual({ os: "win32", arch: "x64" });
        host = await startPortableHost(candidateRoot, nodeRoot);
        const locator = await readLocator(candidateRoot);
        const origin = await endpointOrigin(locator);
        const password = "Portable-qualification-20260905!";
        const initialLogin = await portableCliRaw(
          candidateRoot,
          ["auth", "login", "--password-stdin", "--json"],
          password + "\n",
        );
        if (initialLogin.code !== 0) {
          await portableCli(
            candidateRoot,
            ["admin", "claim", "--password-stdin", "--json"],
            password + "\n",
          );
          await portableCli(
            candidateRoot,
            ["auth", "login", "--password-stdin", "--json"],
            password + "\n",
          );
        }
        const login = await requestJson(origin, "/management/v1/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        expect(login.response.status).toBe(200);
        const token = login.body.sessionToken;
        expect(typeof token).toBe("string");
        const headers = {
          authorization: "Bearer " + token,
          "content-type": "application/json",
        };
        const state = await requestJson(origin, "/management/v1/product/state", {
          headers,
        });
        expect(state.response.status).toBe(200);
        const subjectId = state.body.data.subject.subjectId as string;
        await configureSubject(
          candidateRoot,
          origin,
          locator.installationId,
          subjectId,
          gateway.baseUrl,
          headers,
        );
        const beforeStart = await requestJson(origin, "/management/v1/product/state", {
          headers,
        });
        await applyAction(candidateRoot, {
          actionId: "subject.start",
          input: {
            subjectId,
            expectedAuthorityRevision: beforeStart.body.data.subject.authorityRevision,
          },
        });
        await waitFor(async () => {
          const current = await requestJson(origin, "/management/v1/product/state", {
            headers,
          });
          return current.body.data.subject.actualState === "READY";
        }, "Portable Subject did not become READY");

        const send = async (clientMessageId: string, text: string) =>
          requestJson(origin, "/subject-chat/v1/messages", {
            method: "POST",
            headers,
            body: JSON.stringify({ clientMessageId, text }),
          });
        const quiet = await send("portable-message-quiet", "Please answer quietly");
        expect(quiet.response.status).toBe(200);
        const quietFacts = await waitForReaction(
          locator,
          quiet.body.message.conversationId,
          (snapshot, latest) =>
            latest?.state === "NO_COMMUNICATION" &&
            latest.work_state === "SUCCEEDED" &&
            latest.communication_commit_id === null &&
            snapshot.outboundCount === 0,
          "Portable no-communication Reaction did not converge",
        );
        expect(quietFacts.outboundCount).toBe(0);

        const communicate = await send(
          "portable-message-communicate",
          "Please contact the other side",
        );
        expect(communicate.response.status).toBe(200);
        const communicationFacts = await waitForReaction(
          locator,
          communicate.body.message.conversationId,
          (snapshot, latest) =>
            latest?.state === "REPLIED" &&
            latest.work_state === "SUCCEEDED" &&
            latest.communication_commit_id !== null &&
            snapshot.outboundCount === 1 &&
            snapshot.outbound[0]?.caused_by_communication_commit_id ===
              latest.communication_commit_id &&
            snapshot.outbound[0]?.text === "local expressed reply",
          "Portable communication Reaction did not converge",
        );
        expect(communicationFacts.outboundCount).toBe(1);

        const postgresPid = Number(
          (
            await readFile(
              join(locator.roots.DATA, "private-postgres", "postmaster.pid"),
              "utf8",
            )
          ).split(/\r?\n/u)[0],
        );
        const runtimeDescriptor = JSON.parse(
          await readFile(
            join(
              locator.roots.RUN,
              "subject-openclaw",
              "subject-openclaw-runtime.json",
            ),
            "utf8",
          ),
        ) as Record<string, any>;
        const openclawPid = runtimeDescriptor.pid as number;
        expect(postgresPid).toBeGreaterThan(0);
        expect(openclawPid).toBeGreaterThan(0);
        const firstBootId = host.ready.bootId;
        const firstInstallationId = locator.installationId;
        const firstSubjectId = subjectId;
        await host.stop();
        host = undefined;
        await stopPortablePostgres(candidateRoot, postgresPid);
        let postgresAlive = false;
        let openclawAlive = false;
        await waitFor(
          async () => {
            postgresAlive = await processExists(postgresPid);
            openclawAlive = await processExists(openclawPid);
            return !postgresAlive && !openclawAlive;
          },
          () =>
            "Portable Product-owned PostgreSQL/OpenClaw children did not exit " +
            "(postgres=" +
            postgresAlive +
            ", openclaw=" +
            openclawAlive +
            ")",
        );

        host = await startPortableHost(candidateRoot, nodeRoot);
        const restartedLocator = await readLocator(candidateRoot);
        expect(restartedLocator.installationId).toBe(firstInstallationId);
        expect(host.ready.bootId).not.toBe(firstBootId);
        const restartedOrigin = await endpointOrigin(restartedLocator);
        const restartedLogin = await requestJson(
          restartedOrigin,
          "/management/v1/session",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password }),
          },
        );
        expect(restartedLogin.response.status).toBe(200);
        const restartedHeaders = {
          authorization: "Bearer " + restartedLogin.body.sessionToken,
          "content-type": "application/json",
        };
        const restartedState = await requestJson(
          restartedOrigin,
          "/management/v1/product/state",
          { headers: restartedHeaders },
        );
        expect(restartedState.body.data.subject.subjectId).toBe(firstSubjectId);
        expect(restartedState.body.data.subject.actualState).toBe("READY");
        const restartedPage = await requestJson(
          restartedOrigin,
          "/subject-chat/v1/messages?limit=100",
          { headers: restartedHeaders },
        );
        const beforeRestartFacts = await readSubjectFacts(
          restartedLocator,
          restartedPage.body.conversationId,
        );
        const postRestart = await requestJson(
          restartedOrigin,
          "/subject-chat/v1/messages",
          {
            method: "POST",
            headers: restartedHeaders,
            body: JSON.stringify({
              clientMessageId: "portable-message-after-restart",
              text: "Please answer quietly after restart",
            }),
          },
        );
        expect(postRestart.response.status).toBe(200);
        const postRestartFacts = await waitForReaction(
          restartedLocator,
          postRestart.body.message.conversationId,
          (snapshot, latest) =>
            latest?.state === "NO_COMMUNICATION" &&
            latest.work_state === "SUCCEEDED" &&
            latest.communication_commit_id === null &&
            snapshot.outboundCount === beforeRestartFacts.outboundCount,
          "Portable post-restart Reaction did not converge",
        );
        expect(postRestartFacts.outboundCount).toBe(beforeRestartFacts.outboundCount);
        console.log(
          JSON.stringify({
            type: "PASS",
            qualification: "portable-product",
            platform: "windows-x64",
            installationId: firstInstallationId,
            subjectId: firstSubjectId,
            noCommunication: quietFacts.reactions[quietFacts.reactions.length - 1],
            communication:
              communicationFacts.reactions[communicationFacts.reactions.length - 1],
            postRestart:
              postRestartFacts.reactions[postRestartFacts.reactions.length - 1],
          }),
        );
      } finally {
        await host?.stop().catch(() => undefined);
        if (candidateRoot !== undefined) {
          const locator = await readLocator(candidateRoot).catch(() => undefined);
          if (locator !== undefined) {
            const pidFile = await readFile(
              join(locator.roots.DATA, "private-postgres", "postmaster.pid"),
              "utf8",
            ).catch(() => "");
            const pid = Number(pidFile.split(/\r?\n/u)[0]);
            await stopPortablePostgres(candidateRoot, pid).catch(() => undefined);
          }
        }
        await new Promise<void>((resolvePromise) =>
          gateway.server.close(() => resolvePromise()),
        );
        if (assemblyRoot !== undefined) {
          const parent = dirname(assemblyRoot);
          await rm(parent, { recursive: true, force: true }).catch(() => undefined);
        }
      }
    },
  );
});
