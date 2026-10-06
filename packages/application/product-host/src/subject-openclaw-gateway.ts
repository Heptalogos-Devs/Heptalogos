// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns the private Subject OpenClaw process, public Gateway protocol, and one
 * bounded proposal-only agent run.
 * @module subject-openclaw-gateway
 */

import { randomBytes, randomUUID } from "node:crypto";
import { access, mkdir, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execa, type ResultPromise } from "execa";
import {
  GatewayClient,
  startGatewayClientWhenEventLoopReady,
} from "@openclaw/gateway-client";
import { GATEWAY_CLIENT_CAPS } from "@openclaw/gateway-protocol/client-info";
import { PROTOCOL_VERSION } from "@openclaw/gateway-protocol";
import type { ProductGenerationId } from "@heptalogos/foundation-contracts";
import type {
  ConversationCognitionInput,
  ConversationReactionProposal,
  SubjectCognitionProposal,
  SubjectCognitionProvenance,
  SubjectCognitionTerminalStatus,
} from "@heptalogos/subject";
import {
  cognitionProblem,
  projectSubjectOpenClawRuntime,
  SUBJECT_OPENCLAW_MODEL_PROVIDER,
  SUBJECT_OPENCLAW_PROFILE,
  SUBJECT_OPENCLAW_VERSION,
  type SubjectOpenClawProjectionOptions,
  type SubjectOpenClawRuntimeMaterial,
  type SubjectOpenClawRuntimePaths,
  type SubjectOpenClawRuntimeProjection,
} from "./subject-openclaw-projection.js";
import { writeFileAtomic } from "./atomic-file.js";
import { asRecord } from "./value-utils.js";

const SUBJECT_OPENCLAW_RUNTIME_FILENAME = "subject-openclaw-runtime.json";
const SUBJECT_OPENCLAW_TOOL_NAMES = Object.freeze([
  "heptalogos_propose_communication",
  "heptalogos_complete_without_communication",
] as const);
const SUBJECT_OPENCLAW_PORT_WAIT_MS = 30_000;
const SUBJECT_OPENCLAW_CONNECT_WAIT_MS = 5_000;
const SUBJECT_OPENCLAW_STOP_WAIT_MS = 5_000;
const packageRequire = createRequire(import.meta.url);

type SubjectOpenClawProcess = ResultPromise;

interface PendingRun {
  readonly sessionKey: string;
  readonly resolve: (value: ObservedProposal) => void;
  readonly reject: (reason: unknown) => void;
  settled: boolean;
}

interface ObservedProposal {
  readonly proposal: ConversationReactionProposal;
  readonly terminalToolName: SubjectCognitionProvenance["terminalToolName"];
}

/** Exposes bounded diagnostics for one owned Subject Gateway process. */
interface SubjectOpenClawGatewayDiagnostics {
  readonly lastToolEvent?: {
    readonly runId: string;
    readonly phase: string;
    readonly name?: string;
  };
  readonly lastRunFailure?: string;
  readonly lastRunStage?: string;
}

/** One live public-Gateway-backed Subject cognition process. */
export interface SubjectOpenClawGateway {
  readonly runtimeGeneration: string;
  readonly fingerprint: string;
  readonly pid: number;
  readonly port: number;
  readonly projection: SubjectOpenClawRuntimeProjection;
  /** Runs one bounded Subject cognition reaction through the public Gateway. */
  runConversationReaction(
    input: ConversationCognitionInput,
  ): Promise<SubjectCognitionProposal>;
  /** Returns the latest bounded process and proposal diagnostics. */
  diagnostics(): SubjectOpenClawGatewayDiagnostics;
  /** Stops the owned Gateway process and protocol client. */
  stop(): Promise<void>;
}

interface StartSubjectOpenClawGatewayOptions {
  readonly productGeneration: ProductGenerationId;
  readonly projectionOptions: SubjectOpenClawProjectionOptions;
  readonly paths: SubjectOpenClawRuntimePaths;
  readonly projection: SubjectOpenClawRuntimeProjection;
  readonly fingerprint: string;
  readonly onUnexpectedExit: (runtimeGeneration: string) => void;
  readonly onChanged: () => void;
}

function boundedText(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim().length === 0
  ) {
    throw cognitionProblem(
      "subject.cognition_run_failed",
      "Subject cognition run returned an invalid identity",
      `${field} is not a bounded non-empty string`,
      "integrity",
      "manual",
    );
  }
  return value;
}

function eventPayload(value: unknown): Record<string, unknown> | undefined {
  const event = asRecord(value);
  if (event?.event !== "agent") return undefined;
  return asRecord(event.payload);
}

function parseToolProposal(
  toolName: string,
  value: unknown,
): ConversationReactionProposal {
  const args = asRecord(value);
  if (toolName === "heptalogos_complete_without_communication") {
    if (args === undefined || Object.keys(args).length !== 0) {
      throw cognitionProblem(
        "subject.cognition_run_failed",
        "Subject cognition tool arguments are invalid",
        "heptalogos_complete_without_communication accepts no arguments",
        "validation",
        "manual",
      );
    }
    return Object.freeze({ schemaVersion: 1, kind: "NO_COMMUNICATION" });
  }
  if (toolName !== "heptalogos_propose_communication" || args === undefined) {
    throw cognitionProblem(
      "subject.cognition_run_failed",
      "Subject cognition tool is not allowed",
      "The Subject runtime observed a tool outside its bounded proposal surface",
      "conflict",
      "manual",
    );
  }
  const semantic = asRecord(args.semanticContent);
  if (
    Object.keys(args).length !== 1 ||
    semantic === undefined ||
    Object.keys(semantic).length !== 2 ||
    semantic.schemaVersion !== 1 ||
    typeof semantic.content !== "string" ||
    semantic.content.trim().length === 0 ||
    new TextEncoder().encode(semantic.content).byteLength > 65_536
  ) {
    throw cognitionProblem(
      "subject.cognition_run_failed",
      "Subject cognition proposal arguments are invalid",
      "heptalogos_propose_communication did not return bounded semanticContent",
      "validation",
      "manual",
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: "COMMUNICATE",
    semanticContent: Object.freeze({
      schemaVersion: 1,
      content: semantic.content,
    }),
  });
}

function parseTerminalStatus(value: unknown): SubjectCognitionTerminalStatus {
  if (value === "ok" || value === "error" || value === "timeout") return value;
  throw cognitionProblem(
    "subject.cognition_run_failed",
    "Subject cognition terminal outcome is invalid",
    "OpenClaw agent.wait did not return a current terminal status",
    "integrity",
    "manual",
  );
}

function redactDiagnostic(value: unknown, secretValues: readonly string[]): string {
  let text = value instanceof Error ? value.message : String(value);
  for (const secret of secretValues) {
    if (secret.length > 0) text = text.split(secret).join("<redacted>");
  }
  return text.slice(-4_096);
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolvePromise());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    throw cognitionProblem(
      "subject.cognition_runtime_unavailable",
      "Subject OpenClaw port allocation failed",
      "The Product Host could not allocate a loopback port for the owned Gateway",
    );
  }
  const port = address.port;
  await new Promise<void>((resolvePromise, reject) => {
    server.close((error) => (error ? reject(error) : resolvePromise()));
  });
  return port;
}

async function waitForLoopbackPort(
  child: SubjectOpenClawProcess,
  port: number,
  timeoutMs: number,
  getDiagnostics: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const nodeChild = child.nodeChildProcess;
    if (nodeChild.exitCode !== null || nodeChild.signalCode !== null) {
      throw cognitionProblem(
        "subject.cognition_runtime_unavailable",
        "Subject OpenClaw Gateway exited before readiness",
        `The Product Host child did not expose its loopback listener${getDiagnostics().length === 0 ? "" : `; child=${getDiagnostics()}`}`,
        "unavailable",
        "after-change",
      );
    }
    const connected = await new Promise<boolean>((resolvePromise) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolvePromise(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolvePromise(false);
      });
    });
    if (connected) return;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw cognitionProblem(
    "subject.cognition_runtime_unavailable",
    "Subject OpenClaw Gateway did not become ready",
    `The Product Host child did not expose its bounded loopback listener in time${getDiagnostics().length === 0 ? "" : `; child=${getDiagnostics()}`}`,
    "unavailable",
    "after-change",
  );
}

function processIsLive(child: SubjectOpenClawProcess): boolean {
  return (
    child.nodeChildProcess.exitCode === null &&
    child.nodeChildProcess.signalCode === null
  );
}

async function stopProcess(child: SubjectOpenClawProcess): Promise<void> {
  const errors: unknown[] = [];
  if (processIsLive(child)) child.kill("SIGTERM");
  try {
    await withTimeout(child, SUBJECT_OPENCLAW_STOP_WAIT_MS, () =>
      cognitionProblem(
        "subject.cognition_runtime_unavailable",
        "Subject OpenClaw Gateway did not stop",
        "The Product Host could not settle the owned Subject Gateway child",
        "unavailable",
        "manual",
      ),
    );
  } catch (error) {
    errors.push(error);
    if (processIsLive(child)) child.kill("SIGKILL");
    try {
      await withTimeout(child, SUBJECT_OPENCLAW_STOP_WAIT_MS, () =>
        cognitionProblem(
          "subject.cognition_runtime_unavailable",
          "Subject OpenClaw Gateway did not stop",
          "The Product Host could not settle the owned Subject Gateway child after bounded force termination",
          "unavailable",
          "manual",
        ),
      );
    } catch (waitError) {
      errors.push(waitError);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Subject OpenClaw child cleanup failed");
  }
}

/** Starts one public-Gateway-backed Subject runtime from a current projection. */
export async function startSubjectOpenClawGateway(
  options: StartSubjectOpenClawGatewayOptions,
): Promise<SubjectOpenClawGateway> {
  const openclawPackageMain = packageRequire.resolve("openclaw");
  const openclawPackageRoot = resolve(dirname(openclawPackageMain), "..");
  const openclawWorkingDirectory = openclawPackageRoot;
  const openclawEntry = join(openclawPackageRoot, "openclaw.mjs");
  const pluginPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "subject-openclaw-plugin.js",
  );
  await Promise.all(
    [
      options.paths.data,
      options.paths.configuration,
      options.paths.cache,
      options.paths.run,
      options.paths.state,
      options.paths.workspace,
    ].map((directory) => mkdir(directory, { recursive: true })),
  );
  await access(openclawEntry).catch(() => {
    throw cognitionProblem(
      "subject.cognition_runtime_unavailable",
      "Pinned OpenClaw executable is unavailable",
      "The Product Host dependency does not contain the exact OpenClaw executable",
      "integrity",
      "manual",
    );
  });
  await access(pluginPath).catch(() => {
    throw cognitionProblem(
      "subject.cognition_runtime_unavailable",
      "Subject OpenClaw tool plugin is unavailable",
      "The Product Host build did not carry the bounded Subject plugin entry",
      "integrity",
      "manual",
    );
  });

  const port = await freeLoopbackPort();
  const gatewayToken = randomBytes(32).toString("base64url");
  const material: SubjectOpenClawRuntimeMaterial = await projectSubjectOpenClawRuntime(
    options.projectionOptions,
    options.paths,
    options.projection,
    pluginPath,
    port,
    gatewayToken,
  );
  await writeFileAtomic(options.paths.generatedConfig, material.config, {
    encoding: "utf8",
    mode: 0o600,
  });

  const runtimeGeneration = `${options.productGeneration}:${randomUUID()}`;
  const child = execa(
    process.execPath,
    [
      openclawEntry,
      "--profile",
      SUBJECT_OPENCLAW_PROFILE,
      "gateway",
      "run",
      "--bind",
      "loopback",
      "--port",
      String(port),
    ],
    {
      cwd: openclawWorkingDirectory,
      env: material.env,
      extendEnv: false,
      shell: false,
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
      cleanup: true,
      killDescendants: true,
      forceKillAfterDelay: SUBJECT_OPENCLAW_STOP_WAIT_MS,
      reject: false,
    },
  );
  let childDiagnostics = "";
  for (const stream of [child.nodeChildProcess.stdout, child.nodeChildProcess.stderr]) {
    stream?.on("data", (chunk: Buffer) => {
      childDiagnostics = (childDiagnostics + String(chunk)).slice(-4_096);
    });
  }

  let client: GatewayClient | undefined;
  let intentionallyStopping = false;
  let gateway: SubjectOpenClawGateway | undefined;
  let stopPromise: Promise<void> | undefined;
  let lastToolEvent:
    | {
        readonly runId: string;
        readonly phase: string;
        readonly name?: string;
      }
    | undefined;
  let lastRunFailure: string | undefined;
  let lastRunStage: string | undefined;
  const pendingRuns = new Map<string, PendingRun>();
  const observedToolEvents = new Map<string, ObservedProposal | Error>();

  const rejectPendingRuns = (error: Error): void => {
    for (const pending of pendingRuns.values()) {
      if (pending.settled) continue;
      pending.settled = true;
      pending.reject(error);
    }
    pendingRuns.clear();
    observedToolEvents.clear();
  };

  const onEvent = (value: unknown): void => {
    const payload = eventPayload(value);
    if (payload === undefined) return;
    const runId = payload.runId;
    if (typeof runId !== "string") return;
    const data = asRecord(payload.data);
    if (payload.stream !== "tool" || data === undefined || data.phase !== "start")
      return;
    const toolName = data.name;
    lastToolEvent = Object.freeze({
      runId,
      phase: String(data.phase),
      ...(typeof toolName === "string" ? { name: toolName } : {}),
    });
    options.onChanged();
    if (
      typeof toolName !== "string" ||
      !SUBJECT_OPENCLAW_TOOL_NAMES.includes(toolName as never)
    ) {
      const error = cognitionProblem(
        "subject.cognition_run_failed",
        "Subject cognition invoked a disallowed tool",
        "The isolated Subject OpenClaw run emitted a tool outside its fixed allowlist",
        "conflict",
        "manual",
      );
      const pending = pendingRuns.get(runId);
      if (pending === undefined) observedToolEvents.set(runId, error);
      else if (!pending.settled) {
        pending.settled = true;
        pending.reject(error);
      }
      return;
    }
    try {
      const proposal = parseToolProposal(toolName, data.args);
      const observed = {
        proposal,
        terminalToolName: toolName as ObservedProposal["terminalToolName"],
      };
      const pending = pendingRuns.get(runId);
      if (pending === undefined) {
        if (observedToolEvents.size >= 32) {
          const oldest = observedToolEvents.keys().next().value;
          if (typeof oldest === "string") observedToolEvents.delete(oldest);
        }
        observedToolEvents.set(runId, observed);
      } else if (!pending.settled) {
        pending.settled = true;
        pending.resolve(observed);
      }
    } catch (error) {
      const pending = pendingRuns.get(runId);
      if (pending === undefined) observedToolEvents.set(runId, error as Error);
      else if (!pending.settled) {
        pending.settled = true;
        pending.reject(error);
      }
    }
  };

  const connectClient = async (
    getDiagnostics: () => string,
  ): Promise<GatewayClient> => {
    let resolveHello: (value: unknown) => void = () => undefined;
    let rejectHello: (reason: unknown) => void = () => undefined;
    const hello = new Promise<unknown>((resolvePromise, reject) => {
      resolveHello = resolvePromise;
      rejectHello = reject;
    });
    const current = new GatewayClient({
      url: `ws://127.0.0.1:${port}`,
      token: gatewayToken,
      clientName: "gateway-client",
      clientDisplayName: "Heptalogos Subject cognition",
      clientVersion: SUBJECT_OPENCLAW_VERSION,
      clientBuildId: options.productGeneration,
      platform: process.platform,
      mode: "backend",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      caps: [GATEWAY_CLIENT_CAPS.TOOL_EVENTS],
      commands: [],
      instanceId: `${SUBJECT_OPENCLAW_PROFILE}-${process.pid}`,
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      onHelloOk: resolveHello,
      onConnectError: rejectHello,
      onEvent,
    });
    const eventLoop = await startGatewayClientWhenEventLoopReady(current, {
      timeoutMs: SUBJECT_OPENCLAW_CONNECT_WAIT_MS,
    });
    if (!eventLoop.ready) {
      await current
        .stopAndWait({ timeoutMs: SUBJECT_OPENCLAW_STOP_WAIT_MS })
        .catch(() => undefined);
      throw cognitionProblem(
        "subject.cognition_runtime_unavailable",
        "Subject OpenClaw client event loop is not ready",
        "The Product Host could not establish bounded Gateway client readiness",
        "unavailable",
        "after-change",
      );
    }
    const helloPayload = asRecord(
      await withTimeout(hello, SUBJECT_OPENCLAW_CONNECT_WAIT_MS, () =>
        cognitionProblem(
          "subject.cognition_runtime_unavailable",
          "Subject OpenClaw protocol handshake timed out",
          "The Product Host did not receive the public Gateway hello payload",
          "unavailable",
          "after-change",
        ),
      ),
    );
    if (helloPayload?.protocol !== PROTOCOL_VERSION) {
      await current
        .stopAndWait({ timeoutMs: SUBJECT_OPENCLAW_STOP_WAIT_MS })
        .catch(() => undefined);
      throw cognitionProblem(
        "subject.cognition_runtime_unavailable",
        "Subject OpenClaw protocol version is incompatible",
        `The Gateway negotiated protocol ${String(helloPayload?.protocol)} instead of ${PROTOCOL_VERSION}`,
        "conflict",
        "manual",
      );
    }
    const catalog = asRecord(
      await current.request("tools.catalog", {
        agentId: "main",
        includePlugins: true,
      }),
    );
    const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
    const catalogTools = groups.flatMap((group) => {
      const entry = asRecord(group);
      return Array.isArray(entry?.tools) ? entry.tools : [];
    });
    for (const toolName of SUBJECT_OPENCLAW_TOOL_NAMES) {
      if (
        !catalogTools.some(
          (tool) =>
            asRecord(tool)?.id === toolName && asRecord(tool)?.source === "plugin",
        )
      ) {
        await current
          .stopAndWait({ timeoutMs: SUBJECT_OPENCLAW_STOP_WAIT_MS })
          .catch(() => undefined);
        throw cognitionProblem(
          "subject.cognition_runtime_unavailable",
          "Subject OpenClaw proposal tool is not available",
          `The public tools.catalog result did not expose ${toolName}; catalog=${JSON.stringify(catalog).slice(0, 4_096)}${getDiagnostics().length === 0 ? "" : `; child=${getDiagnostics()}`}`,
          "integrity",
          "manual",
        );
      }
    }
    return current;
  };

  try {
    await waitForLoopbackPort(child, port, SUBJECT_OPENCLAW_PORT_WAIT_MS, () =>
      redactDiagnostic(childDiagnostics, material.secretValues),
    );
    client = await connectClient(() =>
      redactDiagnostic(childDiagnostics, material.secretValues),
    );
    const currentClient = client;

    child.nodeChildProcess.once("exit", () => {
      if (intentionallyStopping) return;
      const error = cognitionProblem(
        "subject.cognition_runtime_unavailable",
        "Subject OpenClaw Gateway stopped",
        "The owned Subject cognition process stopped while a run was active",
        "unavailable",
        "after-change",
      );
      rejectPendingRuns(error);
      if (gateway !== undefined) options.onUnexpectedExit(runtimeGeneration);
      options.onChanged();
    });

    const runConversationReaction = async (
      input: ConversationCognitionInput,
    ): Promise<SubjectCognitionProposal> => {
      const contextText = JSON.stringify(input.contextProjection);
      let runId: string | undefined;
      const sessionKey = `agent:main:heptalogos-subject-reaction-${input.reactionId}-${randomUUID().slice(0, 8)}`;
      const setRunStage = (stage: string): void => {
        lastRunStage = stage;
        options.onChanged();
      };
      const message = [
        "You are the low-privilege Heptalogos Subject cognition runtime.",
        "For this current Reaction, call exactly one terminal proposal tool.",
        "Use heptalogos_propose_communication for semantic content or heptalogos_complete_without_communication for no communication.",
        "Do not call any other tool and do not send any external message.",
        "Current bounded canonical Reaction projection:",
        contextText,
      ].join("\n");
      try {
        if (
          new TextEncoder().encode(contextText).byteLength >
          options.projection.cognitionConfig.maxContextBytes
        ) {
          throw cognitionProblem(
            "subject.cognition_context_too_large",
            "Subject cognition context is too large",
            "The canonical Reaction projection exceeds the active Subject cognition budget",
            "validation",
            "manual",
          );
        }
        const accepted = asRecord(
          await currentClient.request("agent", {
            agentId: "main",
            sessionKey,
            message,
            idempotencyKey: `heptalogos-subject-${input.reactionId}-${randomUUID()}`,
            deliver: false,
          }),
        );
        runId = boundedText(accepted?.runId, "runId", 256);
        setRunStage("accepted");
        const proposalPromise = new Promise<ObservedProposal>(
          (resolvePromise, reject) => {
            const pending: PendingRun = {
              sessionKey,
              resolve: resolvePromise,
              reject,
              settled: false,
            };
            pendingRuns.set(runId!, pending);
            const buffered = observedToolEvents.get(runId!);
            if (buffered !== undefined) {
              observedToolEvents.delete(runId!);
              pending.settled = true;
              if (buffered instanceof Error) pending.reject(buffered);
              else pending.resolve(buffered);
            }
          },
        );
        const observed = await withTimeout(
          proposalPromise,
          options.projection.cognitionConfig.runTimeoutMs,
          () =>
            cognitionProblem(
              "subject.cognition_timeout",
              "Subject cognition run timed out",
              "OpenClaw did not emit one bounded terminal proposal within the configured budget",
              "unavailable",
              "after-change",
            ),
        );
        setRunStage("proposal-observed");
        await currentClient
          .request("chat.abort", { sessionKey, runId })
          .catch(() => undefined);
        setRunStage("abort-requested");
        const terminal = asRecord(
          await currentClient.request("agent.wait", {
            runId,
            timeoutMs: Math.min(
              SUBJECT_OPENCLAW_STOP_WAIT_MS,
              options.projection.cognitionConfig.runTimeoutMs,
            ),
          }),
        );
        setRunStage("terminal-observed");
        const terminalStatus = parseTerminalStatus(terminal?.status);
        if (terminalStatus === "timeout") {
          throw cognitionProblem(
            "subject.cognition_timeout",
            "Subject cognition run did not terminate",
            "The public OpenClaw cancellation path did not produce a bounded terminal outcome",
            "unavailable",
            "after-change",
          );
        }
        return Object.freeze({
          proposal: observed.proposal,
          provenance: Object.freeze({
            schemaVersion: 1,
            provider: "openclaw",
            runtimeGeneration,
            openclawVersion: SUBJECT_OPENCLAW_VERSION,
            profile: SUBJECT_OPENCLAW_PROFILE,
            agentId: "main",
            sessionKey,
            runId,
            modelProvider: SUBJECT_OPENCLAW_MODEL_PROVIDER,
            modelIdentifier: options.projection.model!.modelIdentifier,
            modelBindingId: options.projection.binding!.modelBindingId,
            bindingRevision: options.projection.binding!.revision,
            modelProfileId: options.projection.model!.modelProfileId,
            modelProfileGeneration: options.projection.model!.generation,
            gatewayProfileId: options.projection.gateway!.gatewayProfileId,
            configurationRevisionId: options.projection.cognitionRevision!.revisionId,
            gatewayConfigurationRevisionId:
              options.projection.transportRevision!.revisionId,
            protocol: options.projection.model!.protocol,
            terminalToolName: observed.terminalToolName,
            terminalStatus,
          }),
        });
      } catch (error) {
        lastRunFailure = redactDiagnostic(error, material.secretValues);
        options.onChanged();
        if (runId !== undefined) {
          const pending = pendingRuns.get(runId);
          if (pending !== undefined) pendingRuns.delete(runId);
          await currentClient
            .request("chat.abort", { sessionKey, runId })
            .catch(() => undefined);
          await currentClient
            .request("agent.wait", {
              runId,
              timeoutMs: SUBJECT_OPENCLAW_STOP_WAIT_MS,
            })
            .catch(() => undefined);
        }
        throw error;
      } finally {
        if (runId !== undefined) pendingRuns.delete(runId);
      }
    };

    const diagnostics = (): SubjectOpenClawGatewayDiagnostics =>
      Object.freeze({
        ...(lastToolEvent === undefined ? {} : { lastToolEvent }),
        ...(lastRunFailure === undefined ? {} : { lastRunFailure }),
        ...(lastRunStage === undefined ? {} : { lastRunStage }),
      });

    const stop = (): Promise<void> => {
      if (stopPromise !== undefined) return stopPromise;
      intentionallyStopping = true;
      rejectPendingRuns(
        cognitionProblem(
          "subject.cognition_runtime_unavailable",
          "Subject cognition runtime is stopping",
          "The Product Host is closing the owned Subject OpenClaw run domain",
          "conflict",
          "manual",
        ),
      );
      stopPromise = (async () => {
        const errors: unknown[] = [];
        try {
          await currentClient.stopAndWait({ timeoutMs: SUBJECT_OPENCLAW_STOP_WAIT_MS });
        } catch (error) {
          errors.push(error);
        }
        try {
          await stopProcess(child);
        } catch (error) {
          errors.push(error);
        }
        if (errors.length > 0) {
          throw new AggregateError(errors, "Subject OpenClaw runtime cleanup failed");
        }
      })();
      return stopPromise;
    };

    gateway = Object.freeze({
      runtimeGeneration,
      fingerprint: options.fingerprint,
      pid: child.pid ?? -1,
      port,
      projection: options.projection,
      runConversationReaction,
      diagnostics,
      stop,
    });
    return gateway;
  } catch (error) {
    intentionallyStopping = true;
    const cleanupErrors: unknown[] = [];
    if (client !== undefined) {
      try {
        await client.stopAndWait({ timeoutMs: SUBJECT_OPENCLAW_STOP_WAIT_MS });
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await stopProcess(child);
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "Subject OpenClaw startup and cleanup both failed",
      );
    }
    throw error;
  }
}

/** Removes the process-local descriptor left by an earlier runtime generation. */
export async function removeSubjectOpenClawDescriptor(
  paths: SubjectOpenClawRuntimePaths,
): Promise<void> {
  await unlink(join(paths.run, SUBJECT_OPENCLAW_RUNTIME_FILENAME)).catch(
    () => undefined,
  );
}

/** Writes a redacted process descriptor for current Product diagnostics. */
export async function publishSubjectOpenClawDescriptor(
  paths: SubjectOpenClawRuntimePaths,
  gateway: SubjectOpenClawGateway,
  closed: boolean,
): Promise<void> {
  if (closed) return;
  await writeFileAtomic(
    join(paths.run, SUBJECT_OPENCLAW_RUNTIME_FILENAME),
    JSON.stringify({
      schemaVersion: 1,
      profile: SUBJECT_OPENCLAW_PROFILE,
      pid: gateway.pid,
      port: gateway.port,
      runtimeGeneration: gateway.runtimeGeneration,
      ...gateway.diagnostics(),
    }),
    { encoding: "utf8", mode: 0o600 },
  );
}
