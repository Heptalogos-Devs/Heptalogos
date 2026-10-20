import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

const subjectBinding = z.object({ agentId: z.string(), tools: z.array(z.string()), workspaces: z.record(z.string(), z.string()).default({}) });
export const configSchema = z.object({
  subjects: z.record(z.string(), subjectBinding),
  billing: z.object({ baseURL: z.url(), tokenEnv: z.string().default('HEPT_SERVICE_TOKEN'), installationId: z.string(), modelResources: z.record(z.string(), z.string()) }).optional(),
});
const task = z.object({
  taskId: z.uuid(), subjectId: z.uuid(), goal: z.string().min(1),
  allowedTools: z.array(z.string()), inputRefs: z.array(z.unknown()).default([]),
  workspaceRef: z.string().optional(), budget: z.object({ maxCalls: z.number().int().positive().optional(), maxTokens: z.number().int().positive().optional(), maxUsd: z.number().nonnegative().optional(), perCallUsd: z.number().nonnegative().optional() }).optional(), returnTarget: z.unknown().optional(),
});
const run = z.object({ runId: z.string().min(1), sessionKey: z.string().min(1) });
interface PluginApi {
  pluginConfig?: unknown;
  runtime: {
    modelContext?: { version: number };
    config: { current(): unknown };
    sandbox: {
      resolveWorkspaceAuthority(input: { config: unknown; agentId: string; sessionKey: string; requiredToolNames: string[] }): { sandboxed: boolean; workspaceAccess: 'none' | 'ro' | 'rw'; confinementError?: string };
      prepareWorkspaceAuthority(input: { config: unknown; agentId: string; sessionKey: string; workspaceDir: string; requiredToolNames: string[] }): Promise<{ sandboxed: boolean; workspaceAccess: 'none' | 'ro' | 'rw'; confinementError?: string }>;
    };
    subagent: {
      run(input: { sessionKey: string; message: string; toolsAllow: string[]; idempotencyKey: string; deliver: false; cwd?: string; assertCurrent?: () => void }): Promise<{ runId: string; sessionKey?: string }>;
      waitForRun(input: { runId: string; timeoutMs: number }): Promise<{ status: string; error?: string; stopReason?: string; startedAt?: number; endedAt?: number; providerStarted?: boolean; terminalReply?: { disposition: string; text?: string } }>;
      getSessionMessages(input: { sessionKey: string; limit: number }): Promise<{ messages: unknown[] }>;
      deleteSession(input: { sessionKey: string; deleteTranscript: boolean }): Promise<void>;
    };
    gateway: { request<T>(method: string, input: Record<string, unknown>): Promise<T> };
  };
  on(name: 'model_context_prepare' | 'model_context_dispatch' | 'model_context_accept', handler: (event: NativeModelEvent, context: NativeContext) => Promise<unknown>): void;
  registerHttpRoute(input: {
    path: string; auth: 'gateway'; match: 'exact';
    handler(request: IncomingMessage, response: ServerResponse): Promise<boolean>;
  }): void;
}
type NativeContext = { agentId?: string; sessionKey?: string; parentSessionKey?: string };
type NativeModelEvent = {
  traceparent?: string; role?: string;
  callId: string; runId: string; provider: string; model: string; inputTokensEstimate: number; outputTokens: number;
  prepared?: { view: unknown };
  outcome?: 'not_sent';
  output?: { stopReason?: string; usage?: { input: number; output: number; cacheRead: number; cacheWrite: number }; responseId?: string; diagnostics?: { type: string }[] };
};

async function jsonBody(request: IncomingMessage) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error('Task request exceeds one megabyte');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function registerHeptWorker(api: PluginApi) {
  const config = configSchema.parse(api.pluginConfig);
  if (api.runtime.modelContext?.version !== 1) throw new Error('Hept requires the source-built OpenClaw model context handoff');
  function assertSession(sessionKey: string, runId: string) {
    if (!sessionKey.endsWith(`:${runId}`)) throw new Error('Run identity does not belong to the requested native task session');
    if (!Object.entries(config.subjects).some(([subjectId, binding]) => sessionKey.startsWith(`agent:${binding.agentId}:hept:${subjectId}:`))) {
      throw new Error('Native session is outside the configured Hept subject scope');
    }
  }
  if (config.billing) {
    const billing = config.billing;
    const token = process.env[billing.tokenEnv];
    if (!token) throw new Error(`Missing Hept service credential ${billing.tokenEnv}`);
    async function scope(context: NativeContext) {
      let key = context.sessionKey;
      let parent = context.parentSessionKey;
      const visited = new Set<string>();
      while (key && visited.size < 32 && !visited.has(key)) {
        visited.add(key);
        for (const [subjectId, binding] of Object.entries(config.subjects)) {
          const prefix = `agent:${binding.agentId}:hept:${subjectId}:`;
          if (key.startsWith(prefix)) return { subjectId, taskId: key.slice(prefix.length) };
        }
        if (/^agent:[^:]+:hept:/.test(key)) throw new Error('Native task subject binding changed');
        if (!parent) {
          const result = await api.runtime.gateway.request<{ session: { parentSessionKey?: string; spawnedBy?: string } | null }>('sessions.describe', { key });
          parent = result.session?.parentSessionKey ?? result.session?.spawnedBy;
        }
        key = parent; parent = undefined;
      }
      const entry = Object.entries(config.subjects).find(([, binding]) => binding.agentId === context.agentId);
      return entry ? { subjectId: entry[0], taskId: undefined } : undefined;
    }
    async function account(subjectId: string, operation: string, body: unknown, event: NativeModelEvent, allowAbsent = false) {
      const traceId = createHash('sha256').update(event.runId).digest('hex').slice(0, 32);
      const response = await fetch(`${billing.baseURL.replace(/\/$/, '')}/v1/subjects/${encodeURIComponent(subjectId)}/${operation}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-purpose': 'worker', 'idempotency-key': `${event.callId}:${operation}`, traceparent: event.traceparent ?? `00-${traceId}-${randomBytes(8).toString('hex')}-01` },
        body: JSON.stringify(body),
      });
      if (allowAbsent && response.status === 404) return undefined;
      if (!response.ok) throw new Error(`Hept model accounting failed (${response.status}): ${await response.text()}`);
      return response.json();
    }
    api.on('model_context_prepare', async (_event, context) => (await scope(context)) ? { view: null } : undefined);
    api.on('model_context_dispatch', async (event, context) => {
      const current = await scope(context);
      if (!current) return;
      const modelResourceId = billing.modelResources[`${event.provider}/${event.model}`];
      if (!modelResourceId) throw new Error(`Map the actual Hept model resource ${event.provider}/${event.model}`);
      const view = event.prepared?.view;
      const inputRefs = view && typeof view === 'object' && 'selectedRefs' in view && Array.isArray(view.selectedRefs) ? view.selectedRefs : [];
      await account(current.subjectId, 'invocations', {
        invocationId: event.callId, role: event.role ?? 'worker', modelResourceId, taskId: current.taskId,
        inputTokensEstimate: event.inputTokensEstimate, maxOutputTokens: event.outputTokens, inputRefs,
        nativeRunRef: { product: 'hept', installationId: billing.installationId, subjectId: current.subjectId, kind: 'openclaw.run', id: event.runId },
      }, event);
      await account(current.subjectId, `invocations/${encodeURIComponent(event.callId)}/dispatch`, {}, event);
    });
    api.on('model_context_accept', async (event, context) => {
      const current = await scope(context);
      if (!current) return;
      if (event.outcome === 'not_sent') {
        await account(current.subjectId, `invocations/${encodeURIComponent(event.callId)}/completion`, { status: 'not_sent' }, event, true);
        return;
      }
      if (!event.output) throw new Error('Native completed model output is missing');
      const usage = event.output.usage;
      const completed = event.output.stopReason !== 'error' && event.output.stopReason !== 'aborted';
      const refused = event.output.diagnostics?.some(diagnostic => diagnostic.type === 'provider_refusal');
      await account(current.subjectId, `invocations/${encodeURIComponent(event.callId)}/completion`, {
        status: completed ? 'completed' : refused ? 'not_sent' : 'unknown',
        inputTokens: usage ? usage.input + usage.cacheRead + usage.cacheWrite : undefined,
        outputTokens: usage?.output, cacheReadTokens: usage?.cacheRead, cacheWriteTokens: usage?.cacheWrite,
        providerRequestId: event.output.responseId, rawUsage: usage,
      }, event);
    });
  }
  const operations: Record<string, (body: unknown) => Promise<unknown>> = {
    async start(body) {
      const input = task.parse(body);
      const binding = config.subjects[input.subjectId];
      if (!binding) throw new Error('Subject has no configured worker');
      if (input.allowedTools.some(tool => !binding.tools.includes(tool))) throw new Error('Requested tool exceeds the subject delegation');
      const cwd = input.workspaceRef ? binding.workspaces[input.workspaceRef] : undefined;
      if (input.workspaceRef && !cwd) throw new Error('Task workspace has no authorized native mapping');
      const sessionKey = `agent:${binding.agentId}:hept:${input.subjectId}:${input.taskId}`;
      const nativeConfig = api.runtime.config.current();
      const authorityInput = { config: nativeConfig, agentId: binding.agentId, sessionKey, requiredToolNames: input.allowedTools };
      const authority = cwd
        ? await api.runtime.sandbox.prepareWorkspaceAuthority({ ...authorityInput, workspaceDir: cwd })
        : api.runtime.sandbox.resolveWorkspaceAuthority(authorityInput);
      if (!authority.sandboxed || authority.confinementError) throw new Error(authority.confinementError ?? 'Professional tasks require the configured native sandbox');
      const assertCurrent = () => {
        if (api.runtime.config.current() !== nativeConfig) throw new Error('Native task authority changed before admission');
      };
      const native = await api.runtime.subagent.run({
        sessionKey, idempotencyKey: input.taskId, toolsAllow: input.allowedTools, assertCurrent,
        message: `${input.goal}\n\nInput references:\n${JSON.stringify(input.inputRefs)}\n\nReturn the conclusion, produced files, source references, actual attempts, and unresolved questions.`,
        deliver: false, ...(cwd ? { cwd } : {}),
      });
      return { ...native, sessionKey: native.sessionKey ?? sessionKey };
    },
    async inspect(body) {
      const input = run.parse(body);
      assertSession(input.sessionKey, input.runId);
      const progress = await api.runtime.subagent.waitForRun({ runId: input.runId, timeoutMs: 1 });
      const described = await api.runtime.gateway.request<{ session: { key?: string; status?: string; activeRunIds?: string[]; hasActiveRun?: boolean } | null }>('sessions.describe', { key: input.sessionKey });
      const active = described.session?.activeRunIds?.includes(input.runId) === true;
      const status = progress.status === 'ok' ? 'result_ready'
        : progress.status === 'error' ? (['aborted', 'cancelled', 'canceled'].includes(progress.stopReason ?? '') ? 'cancelled' : 'failed')
        : active && described.session?.status === 'running' ? 'running' : 'waiting';
      const reason = status === 'waiting'
        ? active ? 'native_run_queued' : progress.startedAt ? 'native_run_outcome_pending' : 'native_run_not_confirmed'
        : undefined;
      let result: { text?: string; outputRef?: unknown; outputRefs?: unknown[] } | undefined;
      if (status === 'result_ready') {
        const history = await api.runtime.subagent.getSessionMessages({ sessionKey: input.sessionKey, limit: 40 });
        const final = history.messages.findLast(message => {
          if (!message || typeof message !== 'object' || !('role' in message) || message.role !== 'assistant' || !('modelContext' in message)) return false;
          const metadata = message.modelContext;
          return metadata && typeof metadata === 'object' && 'callId' in metadata && typeof metadata.callId === 'string' && metadata.callId.startsWith(`${input.runId}:`) && 'terminal' in metadata && metadata.terminal === true;
        });
        const metadata = final && typeof final === 'object' && 'modelContext' in final ? final.modelContext : undefined;
        result = metadata && typeof metadata === 'object' && 'outputRef' in metadata && metadata.outputRef
          ? { outputRef: metadata.outputRef, outputRefs: 'selectedOutputRefs' in metadata && Array.isArray(metadata.selectedOutputRefs) ? metadata.selectedOutputRefs : [] }
          : { text: progress.terminalReply?.text ?? '' };
      }
      return { ...input, status, progress: { ...progress, nativeSession: described.session, ...(reason ? { reason } : {}) }, ...(result ? { result } : {}) };
    },
    async locate(body) {
      const input = z.object({ taskId: z.uuid(), subjectId: z.uuid() }).parse(body);
      const binding = config.subjects[input.subjectId];
      if (!binding) throw new Error('Subject has no configured worker');
      return operations.inspect!({ runId: input.taskId, sessionKey: `agent:${binding.agentId}:hept:${input.subjectId}:${input.taskId}` });
    },
    async cancel(body) {
      const input = run.parse(body);
      assertSession(input.sessionKey, input.runId);
      return api.runtime.gateway.request('chat.abort', input);
    },
    async transcript(body) {
      const input = run.extend({ cursor: z.string().optional(), offset: z.number().int().nonnegative().optional() }).parse(body);
      assertSession(input.sessionKey, input.runId);
      return api.runtime.gateway.request('chat.history', {
        sessionKey: input.sessionKey, limit: 1000,
        ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
        ...(input.offset !== undefined ? { offset: input.offset } : {}),
      });
    },
    async purge(body) {
      const input = run.parse(body);
      assertSession(input.sessionKey, input.runId);
      await api.runtime.subagent.deleteSession({ sessionKey: input.sessionKey, deleteTranscript: true });
      return { deleted: ['native_session', 'native_transcript'], pending: ['workspace_artifacts', 'independent_backups'] };
    },
  };
  for (const [operation, execute] of Object.entries(operations)) {
    api.registerHttpRoute({
      path: `/plugins/hept/tasks/${operation}`, auth: 'gateway', match: 'exact',
      async handler(request, response) {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        if (request.method !== 'POST') {
          response.statusCode = 405; response.end(JSON.stringify({ error: 'POST required' })); return true;
        }
        try {
          const result = await execute(await jsonBody(request));
          response.end(JSON.stringify(result));
        } catch (error) {
          response.statusCode = error instanceof z.ZodError ? 400 : 409;
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
        }
        return true;
      },
    });
  }
}

export default { id: 'hept-worker', name: 'Hept Worker', register: registerHeptWorker };
