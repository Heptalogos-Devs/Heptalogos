import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  Configuration,
  NativeCognitionApi,
  NativeApi,
  ModelsApi,
  problemMiddleware,
} from "@heptalogos/client";
import { ContextPrepareSchema } from "@nous-wave/contracts/cognition";
import { RefSchema, sameRef, ProblemSchema } from "@nous-wave/contracts/common";
import { MaterialCaptureSchema, EncounterAcceptSchema } from "@nous-wave/contracts/materials";
import {
  NativeOriginSchema,
  NativeInvocationPrepareSchema,
  NativeInvocationCompletionSchema,
  ModelBudgetSchema,
} from "@nous-wave/contracts/models";
import { z } from "zod";
import {
  nativeExecutionScope,
  nativeToolRecoveryPlan,
  nativeTaskProgress,
  nativeToolRecoveryRequest,
  nativeSessionFacts,
  nativeSessionRequest,
  nativeResourceId,
  nativeBindingRead,
  nativeCallFacts,
  nativeModelBinding,
  parseNativeResourceId,
  invocationIdOf,
} from "./model-facts.js";

const subjectBinding = z.object({
  agentId: z.string(),
  tools: z.array(z.string()),
  workspaces: z.record(z.string(), z.string()).default({}),
});
export const configSchema = z.object({
  runtimeId: z.string().min(1),
  subjects: z.record(z.string(), subjectBinding),
  billing: z
    .object({
      baseURL: z.url(),
      tokenEnv: z.string().default("HEPT_SERVICE_TOKEN"),
      modelResources: z.record(z.string(), z.string()),
      roles: z.record(z.string(), z.string()),
    })
    .optional(),
});
const task = z.object({
  taskId: z.uuid(),
  subjectId: z.uuid(),
  goal: z.string().min(1),
  allowedTools: z.array(z.string()),
  inputRefs: z.array(z.unknown()).default([]),
  workspaceRef: RefSchema.optional(),
  expectedScope: nativeExecutionScope,
  budget: ModelBudgetSchema.optional(),
  returnTarget: z.unknown().optional(),
});
const run = z.object({
  runId: z.string().min(1),
  sessionKey: z.string().min(1),
  sessionId: z.string().min(1).optional(),
});
interface PluginApi {
  pluginConfig?: unknown;
  runtime: {
    modelContext?: { version: number };
    modelConfig: {
      readPublishedModelBinding(input: {
        agentId: string;
        provider?: string;
        modelId?: string;
      }): Promise<{
        agentId: string;
        provider: string;
        modelId: string;
        configRevision: string;
        input: readonly string[];
        reasoning: boolean;
        supportsTools: boolean;
        contextWindow?: number;
        maxTokens?: number;
      }>;
    };
    config: { current(): unknown };
    sandbox: {
      resolveWorkspaceAuthority(input: {
        config: unknown;
        agentId: string;
        sessionKey: string;
        requiredToolNames: string[];
      }): {
        sandboxed: boolean;
        workspaceAccess: "none" | "ro" | "rw";
        confinementError?: string;
      };
      prepareWorkspaceAuthority(input: {
        config: unknown;
        agentId: string;
        sessionKey: string;
        workspaceDir: string;
        requiredToolNames: string[];
      }): Promise<{
        sandboxed: boolean;
        workspaceAccess: "none" | "ro" | "rw";
        confinementError?: string;
      }>;
    };
    subagent: {
      recoveryPlan?(input:{agentId:string;sessionKey:string;sessionId:string;runId:string;callId:string}):Promise<{sessionKey:string;sessionId:string;runId:string;callId:string;terminalEntryId:string;pendingToolCallIds:string[]}>;
      recover?(input:{agentId:string;expected:{sessionKey:string;sessionId:string;runId:string;callId:string;terminalEntryId:string;pendingToolCallIds:string[]};toolsAllow:string[];assertCurrent?:()=>void}):Promise<{runId:string;sessionKey:string}>;
      run(input: {
        sessionKey: string;
        message: string;
        toolsAllow: string[];
        idempotencyKey: string;
        deliver: false;
        cwd?: string;
        assertCurrent?: () => void;
      }): Promise<{ runId: string; sessionKey?: string }>;
      waitForRun(input: { runId: string; timeoutMs: number }): Promise<{
        run?: {
          runId: string;
          sessionKey: string;
          sessionId?: string;
          agentId?: string;
        };
        status: string;
        error?: string;
        stopReason?: string;
        startedAt?: number;
        endedAt?: number;
        providerStarted?: boolean;
        terminalReply?: { disposition: string; text?: string };
      }>;
      getSessionMessages(input: {
        sessionKey: string;
        limit: number;
      }): Promise<{ messages: unknown[] }>;
      deleteSession(input: { sessionKey: string; deleteTranscript: boolean }): Promise<void>;
    };
    gateway: {
      request<T>(method: string, input: Record<string, unknown>): Promise<T>;
    };
  };
  on(
    name: "model_context_prepare" | "model_context_dispatch" | "model_context_accept",
    handler: (event: NativeModelEvent, context: NativeContext) => Promise<unknown>,
    options?: { priority?: number },
  ): void;
  on(
    name: "before_tool_call",
    handler: (
      event: { toolName: string; runId?: string },
      context: NativeContext & { sessionId?: string; runId?: string; abortSignal?: AbortSignal },
    ) => Promise<{ block: true; blockReason: string } | undefined>,
  ): void;
  registerGatewayMethod(
    method: string,
    handler: (options: {
      params: Record<string, unknown>;
      respond(ok: boolean, payload?: unknown, error?: { code: string; message: string; details?:unknown }): void;
    }) => Promise<void>,
  ): void;
  registerHttpRoute(input: {
    path: string;
    auth: "gateway";
    match: "exact";
    handler(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  }): void;
}
type NativeContext = {
  traceparent?: string;
  agentId?: string;
  sessionKey?: string;
  parentSessionKey?: string;
};
type NativeSession = {
  sessionId: string;
  key?: string;
  parentSessionKey?: string;
  spawnedBy?: string;
  status?: string;
  activeRunIds?: string[];
  hasActiveRun?: boolean;
};
type NativeModelEvent = {
  accepted?: { outputRef?: unknown; selectedOutputRefs?: unknown[] };
  traceparent?: string;
  role?: string;
  callId: string;
  runId: string;
  sessionId: string;
  provider: string;
  model: string;
  inputTokensEstimate: number;
  outputTokens: number;
  prepared?: { view: unknown };
  outcome?: "not_sent";
  output?: {
    stopReason?: string;
    usage?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
    responseId?: string;
    diagnostics?: { type: string }[];
  };
};

async function jsonBody(request: IncomingMessage) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error("Task request exceeds one megabyte");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function registerHeptWorker(api: PluginApi) {
  if(typeof api.runtime.modelConfig?.readPublishedModelBinding!=="function")throw new Error("Hept requires the source-built OpenClaw published model metadata API");
  const config = configSchema.parse(api.pluginConfig);
  if (api.runtime.modelContext?.version !== 1)
    throw new Error("Hept requires the source-built OpenClaw model context handoff");
  async function describe(key: string) {
    return (
      await api.runtime.gateway.request<{ session: NativeSession | null }>("sessions.describe", {
        key,
      })
    ).session;
  }
  async function taskScope(sessionKey: string) {
    let key: string | undefined = sessionKey;
    const visited = new Set<string>();
    while (key && visited.size < 32 && !visited.has(key)) {
      visited.add(key);
      const session = await describe(key);
      if (!session) {
        if (visited.size > 1 || /^agent:[^:]+:hept:/.test(key))
          throw new Error("Native Task ancestry is no longer available");
        return undefined;
      }
      for (const [subjectId, binding] of Object.entries(config.subjects)) {
        const prefix = `agent:${binding.agentId}:hept:${subjectId}:`;
        if (key.startsWith(prefix))
          return {
            subjectId,
            taskId: z.uuid().parse(key.slice(prefix.length)),
            sessionKey: key,
            sessionId: session.sessionId,
          };
      }
      if (/^agent:[^:]+:hept:/.test(key)) throw new Error("Native task subject binding changed");
      key = session.parentSessionKey ?? session.spawnedBy;
    }
    return undefined;
  }
  async function scopedCall(body: unknown) {
    const origin = NativeOriginSchema.parse(body);
    if (origin.runtimeId !== config.runtimeId)
      throw new Error("Native runtime/call identity is not bound to this host");
    invocationIdOf({ runId: origin.runId, callId: origin.callId });
    const result = await api.runtime.gateway.request<{ call: unknown | null }>(
      "sessions.modelCall",
      {
        key: origin.sessionKey,
        sessionId: origin.sessionId,
        runId: origin.runId,
        callId: origin.callId,
      },
    );
    if (!result.call) return null;
    const facts = nativeCallFacts.parse(result.call);
    if (
      facts.sessionKey !== origin.sessionKey ||
      facts.sessionId !== origin.sessionId ||
      facts.runId !== origin.runId ||
      facts.callId !== origin.callId
    )
      throw new Error("Native model call identity changed");
    if (
      origin.entryId &&
      origin.entryId !== facts.prepared.entryId &&
      origin.entryId !== facts.terminal?.entryId
    )
      throw new Error("Native entry is not part of this model call");
    const task = await taskScope(facts.sessionKey);
    if (!task) throw new Error("Native call has no configured Hept Task ancestry");
    return nativeCallFacts.parse({ ...facts, task });
  }
  async function assertSession(sessionKey: string, runId: string, sessionId?: string) {
    const scope = await taskScope(sessionKey);
    if (!scope) throw new Error("Native session is outside the configured Hept Task scope");
    const progress = await api.runtime.subagent.waitForRun({
      runId,
      timeoutMs: 1,
    });
    if (!progress.run) return { scope, progress, confirmed: false };
    if (
      progress.run.sessionKey !== sessionKey ||
      (sessionId && progress.run.sessionId !== sessionId)
    )
      throw new Error("Native run does not belong to the requested session");
    return { scope, progress, confirmed: true };
  }
  const projectBinding = (
    actual: Awaited<ReturnType<PluginApi["runtime"]["modelConfig"]["readPublishedModelBinding"]>>,
    resourceId: string,
  ) =>
    nativeModelBinding.parse({
      runtimeId: config.runtimeId,
      nativeResourceId: resourceId,
      configRevision: actual.configRevision,
      actualProvider: actual.provider,
      actualModelId: actual.modelId,
      kind: "language",
      capabilities: [
        ...actual.input.map((kind) => `input:${kind}`),
        ...(actual.supportsTools ? ["tools"] : []),
        ...(actual.reasoning ? ["reasoning"] : []),
      ],
      contextLimit: actual.contextWindow,
      outputLimit: actual.maxTokens,
    });
  const modelOperations = {
    async readSession(body: unknown) {
      const input = nativeSessionRequest.parse(body);
      if (input.runtimeId !== config.runtimeId)
        throw new Error("Native runtime identity is not bound to this host");
      const checked = await assertSession(input.sessionKey, input.runId, input.sessionId);
      if (!checked.confirmed) return null;
      const session = await describe(input.sessionKey),
        actual = checked.progress.run!;
      if (
        !session ||
        session.sessionId !== input.sessionId ||
        actual.sessionId !== input.sessionId ||
        !actual.agentId
      )
        throw new Error("Native actual run/session scope changed during read");
      return nativeSessionFacts.parse({
        agentId: actual.agentId,
        sessionKey: input.sessionKey,
        sessionId: input.sessionId,
        runId: input.runId,
        task: checked.scope,
      });
    },
    async readBinding(body: unknown) {
      const input = nativeBindingRead.parse(body);
      if (input.runtimeId !== config.runtimeId)
        throw new Error("Native runtime identity is not bound to this host");
      const selected = parseNativeResourceId(input.nativeResourceId);
      if (!Object.values(config.subjects).some((row) => row.agentId === selected.agentId))
        throw new Error("Native agent is outside this bridge configuration");
      const actual = await api.runtime.modelConfig.readPublishedModelBinding(selected);
      return projectBinding(actual, input.nativeResourceId);
    },
    readCall: scopedCall,
  };
  function hostSdk(meta: { submissionId: string; traceparent?: string; runId: string }) {
    const host = config.billing;
    if (!host) throw new Error("Hept Host connection is not configured");
    const token = process.env[host.tokenEnv];
    if (!token) throw new Error("Hept Host credential is unavailable");
    return new Configuration({
      basePath: host.baseURL,
      accessToken: token,
      middleware: [problemMiddleware],
      headers: {
        Authorization: `Bearer ${token}`,
        "idempotency-key": meta.submissionId,
        "x-purpose": "worker",
        "x-audience": "[]",
        ...(meta.traceparent ? { traceparent: meta.traceparent } : {}),
      },
      fetchApi: (input, init) =>
        fetch(input, {
          ...init,
          redirect: "error",
          signal: init?.signal ?? AbortSignal.timeout(120_000),
        }),
    });
  }
  const cognitionRequest = z.strictObject({
    native: nativeSessionRequest,
    input: z.unknown(),
    submissionId: z.string().min(1),
    traceparent: z.string().optional(),
  });
  for (const operation of ["capture", "prepare", "accept", "uploadBlob"] as const)
    api.registerGatewayMethod(`hept.cognition.${operation}`, async ({ params, respond }) => {
      try {
        const request = cognitionRequest.parse(params),
          facts = await modelOperations.readSession(request.native);
        if (!facts) throw new Error("Native Task session is not confirmed");
        const client = new NativeCognitionApi(hostSdk({ ...request, runId: request.native.runId })),
          subjectId = facts.task.subjectId;
        let result: unknown;
        if (operation === "capture")
          result = await client.nativeCognitionCapture({
            subjectId,
            nativeCognitionCaptureRequest: {
              native: request.native,
              input: MaterialCaptureSchema.parse(request.input),
            },
          });
        else if (operation === "prepare")
          result = await client.nativeCognitionPrepare({
            subjectId,
            nativeCognitionPrepareRequest: {
              native: request.native,
              input: ContextPrepareSchema.parse(request.input),
            },
          });
        else if (operation === "accept")
          result = await client.nativeCognitionAccept({
            subjectId,
            nativeCognitionAcceptRequest: {
              native: request.native,
              input: EncounterAcceptSchema.parse(request.input),
            },
          });
        else {
          const image = z
            .strictObject({ data: z.string(), mediaType: z.string().min(1) })
            .parse(request.input);
          result = await client.nativeCognitionUploadBlob(
            {
              subjectId,
              native: request.native,
              body: new Blob([Uint8Array.from(Buffer.from(image.data, "base64"))], {
                type: image.mediaType,
              }),
            },
            async ({ init }) => {
              const headers = new Headers(init.headers);
              headers.set("x-content-media-type", image.mediaType);
              return { ...init, headers };
            },
          );
        }
        respond(true, result);
      } catch(error) {
        const parsed=ProblemSchema.safeParse(error&&typeof error==="object"&&"problem" in error?error.problem:undefined);
        respond(false, undefined, parsed.success?{code:parsed.data.code,message:parsed.data.message,details:{problem:parsed.data}}:{
          code: "UNAVAILABLE",
          message: "Hept Task cognition is unavailable",
        });
      }
    });
  api.on("before_tool_call", async (event, context) => {
    try {
      if (!context.sessionKey) {
        if (
          context.agentId &&
          Object.values(config.subjects).some((row) => row.agentId === context.agentId)
        )
          throw new Error("Native tool session identity is missing");
        return undefined;
      }
      const scope = await taskScope(context.sessionKey);
      if (!scope) return undefined;
      if (context.abortSignal?.aborted) throw new Error("Native tool call was cancelled");
      const native = nativeSessionRequest.parse({
        runtimeId: config.runtimeId,
        sessionKey: context.sessionKey,
        sessionId: context.sessionId,
        runId: context.runId ?? event.runId,
      });
      const client = new NativeApi(
        hostSdk({
          submissionId: `${native.runId}:tool:${event.toolName}:${randomBytes(8).toString("hex")}`,
          runId: native.runId,
          traceparent: context.traceparent,
        }),
      );
      await client.nativeAuthorityCheck(
        {
          subjectId: scope.subjectId,
          nativeAuthorityCheckRequest: { native, toolName: event.toolName },
        },
        { signal: context.abortSignal },
      );
      if (context.abortSignal?.aborted) throw new Error("Native tool call was cancelled");
      return undefined;
    } catch {
      return { block: true, blockReason: "Hept Task tool authority is unavailable or revoked" };
    }
  });
  api.on("model_context_prepare", async (_event, context) => {
    if (!context.sessionKey || !(await taskScope(context.sessionKey))) return undefined;
    if (!config.billing) throw new Error("Hept Task model accounting is not configured");
    return { view: null };
  });
  if (config.billing) {
    const billing = config.billing;
    function accounting(event: NativeModelEvent, phase: string) {
      return new ModelsApi(
        hostSdk({
          submissionId: `${event.callId}:${phase}`,
          traceparent: event.traceparent,
          runId: event.runId,
        }),
      );
    }
    function origin(event: NativeModelEvent, context: NativeContext) {
      if (!context.sessionKey) throw new Error("Native call has no session key");
      return NativeOriginSchema.parse({
        type: "native",
        runtimeId: config.runtimeId,
        sessionId: event.sessionId,
        sessionKey: context.sessionKey,
        runId: event.runId,
        callId: event.callId,
      });
    }
    api.on("model_context_dispatch", async (event, context) => {
      if (!context.sessionKey || !(await taskScope(context.sessionKey))) return;
      const native = origin(event, context),
        facts = await scopedCall(native);
      if (!facts?.task) throw new Error("Native prepared Task call is not present");
      const modelResourceId =
        billing.modelResources[`${facts.prepared.provider}/${facts.prepared.modelId}`];
      const roleId = billing.roles[event.role ?? "assistant"];
      if (!modelResourceId || !roleId)
        throw new Error("Map the actual native model and role to a registered Hept resource");
      const inputRefs = facts.prepared.inputRefs;
      const invocationId = invocationIdOf(facts);
      await accounting(event, "prepare").modelsPrepareInvocation({
        subjectId: facts.task.subjectId,
        nativeInvocationPrepareInput: NativeInvocationPrepareSchema.parse({
          invocationId,
          roleId,
          modelResourceId,
          actualProvider: facts.prepared.provider,
          actualModelId: facts.prepared.modelId,
          native,
          inputTokensEstimate: {
            value: facts.prepared.inputTokensEstimate,
            method: "openclaw.native-final-context-estimate",
          },
          maxOutputTokens: facts.prepared.outputTokens,
          inputRefs,
        }),
      });
      await accounting(event, "dispatch").modelsDispatchInvocation({
        subjectId: facts.task.subjectId,
        id: invocationId,
        modelsDispatchInvocationRequest: {},
      });
    });
    async function completion(event: NativeModelEvent, context: NativeContext, adopt = false) {
      if (!context.sessionKey || !(await taskScope(context.sessionKey))) return;
      if (adopt && !event.accepted?.outputRef) return;
      const native = origin(event, context),
        facts = await scopedCall(native);
      if (!facts?.task) throw new Error("Native original Task call is not present");
      if (
        adopt &&
        (!facts.terminal?.outputRef ||
          !sameRef(RefSchema.parse(event.accepted?.outputRef), facts.terminal.outputRef))
      )
        throw new Error("Native output reference is not durably accepted");
      const invocationId = invocationIdOf(facts),
        usage = facts.terminal?.usage;
      const status =
        event.outcome === "not_sent" || facts.terminal?.providerRefused === true
          ? "not_sent"
          : facts.terminal
            ? ["error", "aborted"].includes(facts.terminal.stopReason ?? "")
              ? "unknown"
              : "completed"
            : facts.notDispatched
              ? "not_sent"
              : "unknown";
      const completion = NativeInvocationCompletionSchema.parse({
        invocationId,
        status,
        usage: usage
          ? {
              inputTokens: usage.input + usage.cacheRead + usage.cacheWrite,
              outputTokens: usage.output,
              cacheReadTokens: usage.cacheRead,
              cacheWriteTokens: usage.cacheWrite,
            }
          : undefined,
        rawUsage: usage,
        providerRequestId: facts.terminal?.providerRequestId,
        ...(adopt && status === "completed" ? { outputRef: event.accepted?.outputRef } : {}),
      });
      try {
        await accounting(
          event,
          adopt ? "completion:adoption" : "completion:fact",
        ).modelsCompleteInvocation({
          subjectId: facts.task.subjectId,
          id: invocationId,
          nativeInvocationCompletionInput: completion,
        });
      } catch (error) {
        if (
          (event.outcome === "not_sent" || facts.terminal?.providerRefused === true) &&
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "models.invocation_not_found"
        )
          return;
        throw error;
      }
    }
    api.on("model_context_accept", (event, context) => completion(event, context), {
      priority: 200,
    });
    api.on("model_context_accept", (event, context) => completion(event, context, true), {
      priority: 0,
    });
  }

  async function describeTask(
    input:
      | z.infer<typeof task>
      | Pick<z.infer<typeof task>, "taskId" | "subjectId" | "workspaceRef" | "allowedTools">,
  ) {
    const binding = config.subjects[input.subjectId];
    if (!binding) throw new Error("Subject has no configured worker");
    if (input.allowedTools.some((tool) => !binding.tools.includes(tool)))
      throw new Error("Requested tool exceeds the subject delegation");
    const cwd = input.workspaceRef ? binding.workspaces[input.workspaceRef.id] : undefined;
    if (input.workspaceRef && !cwd)
      throw new Error("Task workspace has no authorized native mapping");
    const sessionKey = `agent:${binding.agentId}:hept:${input.subjectId}:${input.taskId}`;
    const configSnapshot = api.runtime.config.current();
    const authorityInput = {
      config: configSnapshot,
      agentId: binding.agentId,
      sessionKey,
      requiredToolNames: input.allowedTools,
    };
    const authority = api.runtime.sandbox.resolveWorkspaceAuthority(authorityInput);
    if (!authority.sandboxed || authority.confinementError)
      throw new Error("Professional tasks require the configured native sandbox");
    const actual = await api.runtime.modelConfig.readPublishedModelBinding({
      agentId: binding.agentId,
    });
    if(input.allowedTools.length&&!actual.supportsTools)throw new Error("The selected native model does not support the requested tools");
    if (api.runtime.config.current() !== configSnapshot)
      throw new Error("Native Task configuration changed during preflight");
    return {
      configSnapshot,
      cwd,
      authorityInput,
      scope: nativeExecutionScope.parse({
        runtimeId: config.runtimeId,
        agentId: binding.agentId,
        sessionKey,
        workspaceRef: input.workspaceRef,
        allowedTools: [...input.allowedTools].sort(),
        model: projectBinding(
          actual,
          nativeResourceId({
            agentId: binding.agentId,
            provider: actual.provider,
            modelId: actual.modelId,
          }),
        ),
      }),
    };
  }
  const operations: Record<string, (body: unknown, metadata?: {traceparent?:string}) => Promise<unknown>> = {
    async describe(body) {
      return (
        await describeTask(
          task
            .pick({
              taskId: true,
              subjectId: true,
              workspaceRef: true,
              allowedTools: true,
            })
            .parse(body),
        )
      ).scope;
    },
    async start(body) {
      const input = task.parse(body);
      const described = await describeTask(input);
      if (JSON.stringify(input.expectedScope) !== JSON.stringify(described.scope))
        throw new Error("Native Task execution scope changed before start");
      if (!config.billing) throw new Error("Hept Task model accounting is not configured");
      const { configSnapshot: nativeConfig, cwd, authorityInput, scope } = described;
      const sessionKey = scope.sessionKey;
      const authority = cwd
        ? await api.runtime.sandbox.prepareWorkspaceAuthority({
            ...authorityInput,
            workspaceDir: cwd,
          })
        : api.runtime.sandbox.resolveWorkspaceAuthority(authorityInput);
      if (!authority.sandboxed || authority.confinementError)
        throw new Error(
          authority.confinementError ?? "Professional tasks require the configured native sandbox",
        );
      const assertCurrent = () => {
        if (api.runtime.config.current() !== nativeConfig)
          throw new Error("Native task authority changed before admission");
      };
      const native = await api.runtime.subagent.run({
        sessionKey,
        idempotencyKey: input.taskId,
        toolsAllow: input.allowedTools,
        assertCurrent,
        message: `${input.goal}\n\nInput references:\n${JSON.stringify(input.inputRefs)}\n\nReturn the conclusion, produced files, source references, actual attempts, and unresolved questions.`,
        deliver: false,
        ...(cwd ? { cwd } : {}),
      });
      const acceptedKey = native.sessionKey ?? sessionKey,
        accepted = await describe(acceptedKey);
      return {
        ...native,
        sessionKey: acceptedKey,
        ...(accepted?.sessionId ? { sessionId: accepted.sessionId } : {}),
      };
    },
    async inspect(body) {
      const input = run.parse(body);
      const { progress, confirmed } = await assertSession(
        input.sessionKey,
        input.runId,
        input.sessionId,
      );
      const described = await api.runtime.gateway.request<{
        session: NativeSession | null;
      }>("sessions.describe", { key: input.sessionKey });
      const active = described.session?.activeRunIds?.includes(input.runId) === true;
      const status = !confirmed
        ? "waiting"
        : progress.status === "ok"
          ? "result_ready"
          : progress.status === "error"
            ? ["aborted", "cancelled", "canceled"].includes(progress.stopReason ?? "")
              ? "cancelled"
              : "failed"
            : active && described.session?.status === "running"
              ? "running"
              : "waiting";
      const reason =
        status === "waiting"
          ? active
            ? "native_run_queued"
            : progress.startedAt
              ? "native_run_outcome_pending"
              : "native_run_not_confirmed"
          : undefined;
      let result: { text?: string; outputRef?: unknown; outputRefs?: unknown[] } | undefined;
      if (status === "result_ready") {
        const history = await api.runtime.subagent.getSessionMessages({
          sessionKey: input.sessionKey,
          limit: 40,
        });
        const final = history.messages.findLast((message) => {
          if (
            !message ||
            typeof message !== "object" ||
            !("role" in message) ||
            message.role !== "assistant" ||
            !("modelContext" in message)
          )
            return false;
          const metadata = message.modelContext;
          return (
            metadata &&
            typeof metadata === "object" &&
            "callId" in metadata &&
            typeof metadata.callId === "string" &&
            metadata.callId.startsWith(`${input.runId}:`) &&
            "terminal" in metadata &&
            metadata.terminal === true
          );
        });
        const metadata =
          final && typeof final === "object" && "modelContext" in final
            ? final.modelContext
            : undefined;
        result =
          metadata && typeof metadata === "object" && "outputRef" in metadata && metadata.outputRef
            ? {
                outputRef: metadata.outputRef,
                outputRefs:
                  "selectedOutputRefs" in metadata && Array.isArray(metadata.selectedOutputRefs)
                    ? metadata.selectedOutputRefs
                    : [],
              }
            : { text: progress.terminalReply?.text ?? "" };
      }
      const failure=status==="failed"?ProblemSchema.parse({code:"native.execution_failed",category:"unavailable",status:502,messageKey:"native.execution_failed",message:"原生任务执行失败",details:{runId:input.runId,sessionKey:input.sessionKey}}):undefined;
      return {
        ...input,
        ...(progress.run?.sessionId ? { sessionId: progress.run.sessionId } : {}),
        status,
        ...(failure?{problem:failure}:{}),
        progress: nativeTaskProgress.parse({
          nativeStatus: nativeTaskProgress.shape.nativeStatus.safeParse(progress.status).data ?? "unknown",
          active,runId:input.runId,sessionKey:input.sessionKey,sessionId:progress.run?.sessionId ?? input.sessionId,
          startedAt:progress.startedAt,endedAt:progress.endedAt,providerStarted:progress.providerStarted,
          ...(reason ? { reason } : {}),
        }),
        ...(result ? { result } : {}),
      };
    },
    async locate(body) {
      const input = z.object({ taskId: z.uuid(), subjectId: z.uuid() }).parse(body);
      const binding = config.subjects[input.subjectId];
      if (!binding) throw new Error("Subject has no configured worker");
      const sessionKey = `agent:${binding.agentId}:hept:${input.subjectId}:${input.taskId}`;
      if (!(await describe(sessionKey)))
        return {
          runId: input.taskId,
          sessionKey,
          status: "waiting",
          progress: nativeTaskProgress.parse({nativeStatus:"unknown",active:false,runId:input.taskId,sessionKey,reason:"native_run_not_confirmed"}),
        };
      // Native agent-request-preflight uses the submitted idempotencyKey as the runId.
      return operations.inspect!({ runId: input.taskId, sessionKey });
    },
    async planRecovery(body) {
      const input=nativeToolRecoveryRequest.parse(body);
      if(input.native.runtimeId!==config.runtimeId)throw new Error("Native recovery runtime changed");
      const task=await taskScope(input.native.sessionKey);
      if(!task)throw new Error("Native recovery has no current Task ancestry");
      const checked=await assertSession(input.native.sessionKey,input.native.runId,input.native.sessionId);
      if(!checked.confirmed)throw new Error("Native recovery run is not confirmed");
      const current=await describeTask({taskId:task.taskId,subjectId:task.subjectId,allowedTools:input.expectedScope.allowedTools,workspaceRef:input.expectedScope.workspaceRef});
      if(JSON.stringify(current.scope)!==JSON.stringify(input.expectedScope))throw new Error("Native recovery execution scope changed");
      if(!api.runtime.subagent.recoveryPlan)throw new Error("Native tool recovery is unavailable");
      const plan=await api.runtime.subagent.recoveryPlan({agentId:current.scope.agentId,sessionKey:input.native.sessionKey,sessionId:input.native.sessionId,runId:input.native.runId,callId:input.native.callId});
      return nativeToolRecoveryPlan.parse({...plan,runtimeId:config.runtimeId,executionScope:current.scope});
    },
    async recover(body, metadata) {
      const input=z.strictObject({expected:nativeToolRecoveryPlan}).parse(body);
      const plan=nativeToolRecoveryPlan.parse(await operations.planRecovery!({native:{runtimeId:input.expected.runtimeId,sessionKey:input.expected.sessionKey,sessionId:input.expected.sessionId,runId:input.expected.runId,callId:input.expected.callId},expectedScope:input.expected.executionScope}));
      if(JSON.stringify(plan)!==JSON.stringify(input.expected))throw new Error("Native recovery plan changed");
      if(!config.billing||!api.runtime.subagent.recover)throw new Error("Native tool recovery is unavailable");
      const task=await taskScope(plan.sessionKey);
      if(!task)throw new Error("Native recovery Task ancestry changed");
      await new NativeApi(hostSdk({submissionId:`${plan.callId}:recovery`,runId:plan.runId,traceparent:metadata?.traceparent})).nativeAuthorityCheck({subjectId:task.subjectId,nativeAuthorityCheckRequest:{native:{runtimeId:config.runtimeId,sessionKey:plan.sessionKey,sessionId:plan.sessionId,runId:plan.runId}}});
      const snapshot=api.runtime.config.current();
      const result=await api.runtime.subagent.recover({agentId:plan.executionScope.agentId,expected:{sessionKey:plan.sessionKey,sessionId:plan.sessionId,runId:plan.runId,callId:plan.callId,terminalEntryId:plan.terminalEntryId,pendingToolCallIds:plan.pendingToolCallIds},toolsAllow:plan.executionScope.allowedTools,assertCurrent:()=>{if(api.runtime.config.current()!==snapshot)throw new Error("Native recovery configuration changed");}});
      return {...result,sessionId:plan.sessionId};
    },
    async cancel(body) {
      const input = run.parse(body);
      const checked = await assertSession(input.sessionKey, input.runId, input.sessionId);
      if (!checked.confirmed) throw new Error("Native run ownership has not been confirmed");
      return api.runtime.gateway.request("chat.abort", input);
    },
    async transcript(body) {
      const input = run
        .extend({
          cursor: z.string().optional(),
          offset: z.number().int().nonnegative().optional(),
        })
        .parse(body);
      const checked = await assertSession(input.sessionKey, input.runId, input.sessionId);
      if (!checked.confirmed) throw new Error("Native run ownership has not been confirmed");
      return api.runtime.gateway.request("chat.history", {
        sessionKey: input.sessionKey,
        limit: 1000,
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
      });
    },
    async purge(body) {
      const input = run.parse(body);
      const checked = await assertSession(input.sessionKey, input.runId, input.sessionId);
      if (!checked.confirmed) throw new Error("Native run ownership has not been confirmed");
      await api.runtime.subagent.deleteSession({
        sessionKey: input.sessionKey,
        deleteTranscript: true,
      });
      return {
        deleted: ["native_session", "native_transcript"],
        pending: ["workspace_artifacts", "independent_backups"],
      };
    },
  };
  for (const [owner, entries] of Object.entries({
    tasks: operations,
    models: modelOperations,
  }))
    for (const [operation, execute] of Object.entries(entries)) {
      api.registerHttpRoute({
        path: `/plugins/hept/${owner}/${operation}`,
        auth: "gateway",
        match: "exact",
        async handler(request, response) {
          response.setHeader("Content-Type", "application/json");
          response.setHeader("Cache-Control", "no-store");
          if (request.method !== "POST") {
            response.statusCode = 405;
            response.end(JSON.stringify({ error: "POST required" }));
            return true;
          }
          try {
            const result = await execute(await jsonBody(request), {traceparent:typeof request.headers.traceparent === "string"? request.headers.traceparent:undefined});
            response.end(JSON.stringify(result));
          } catch (error) {
            if (owner === "tasks" && (operation === "recover" || operation === "planRecovery") && !(error instanceof z.ZodError)) {
              const supplied = error && typeof error === "object" && "code" in error ? error.code : undefined;
              const code = typeof supplied === "string" && ["native.recovery_scope_changed","native.recovery_plan_changed","native.recovery_effect_unknown","native.recovery_proof_unavailable"].includes(supplied) ? supplied : "native.recovery_unavailable";
              const problem = ProblemSchema.parse({code,category:code==="native.recovery_unavailable"?"unavailable":"conflict",status:code==="native.recovery_unavailable"?503:409,messageKey:code,message:code==="native.recovery_effect_unknown"?"原生工具效果待核实":code==="native.recovery_proof_unavailable"?"缺少原生未执行证明":code==="native.recovery_plan_changed"?"原生恢复计划已变更":code==="native.recovery_scope_changed"?"原生恢复范围已变更":"原生恢复入口暂不可用"});
              response.statusCode=problem.status;response.end(JSON.stringify(problem));return true;
            }
            response.statusCode = error instanceof z.ZodError ? 400 : 409;
            response.end(
              JSON.stringify({
                error:
                  error instanceof z.ZodError
                    ? "Invalid native bridge input"
                    : "Native bridge operation failed",
              }),
            );
          }
          return true;
        },
      });
    }
}

export default {
  id: "hept-worker",
  name: "Hept Worker",
  register: registerHeptWorker,
};
