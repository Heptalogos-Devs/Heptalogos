export type NativeRun = { runId: string; sessionKey: string; runtime?: { harness: string; provider: string; model: string } };
export type NativeTask = {
  traceparent?: string;
  taskId: string; subjectId: string; goal: string; allowedTools: string[];
  inputRefs?: unknown[]; workspaceRef?: string; budget?: { maxCalls?: number; maxTokens?: number; maxUsd?: number; perCallUsd?: number }; returnTarget?: unknown;
};
export type NativeProgress = {
  runId: string; sessionKey: string; status: 'running' | 'waiting' | 'result_ready' | 'failed' | 'cancelled';
  progress: unknown; result?: { text?: string; outputRef?: unknown; outputRefs?: unknown[] };
};

export function createOpenClawClient(options: { endpoint: string; token: string }) {
  async function request<T>(operation: string, body: unknown, traceparent?: string): Promise<T> {
    const response = await fetch(`${options.endpoint.replace(/\/$/, '')}/plugins/hept/tasks/${operation}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(120_000),
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json', ...(traceparent ? { traceparent } : {}) },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`OpenClaw ${operation} failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<T>;
  }
  return {
    start: (task: NativeTask) => request<NativeRun>('start', task, task.traceparent),
    inspect: (run: Pick<NativeRun, 'runId' | 'sessionKey'>) => request<NativeProgress>('inspect', run),
    locate: (task: Pick<NativeTask, 'taskId' | 'subjectId'>) => request<NativeProgress>('locate', task),
    cancel: (run: Pick<NativeRun, 'runId' | 'sessionKey'>) => request<{ aborted: boolean }>('cancel', run),
    transcript: (run: Pick<NativeRun, 'runId' | 'sessionKey'> & { cursor?: string; offset?: number }) => request<unknown>('transcript', run),
    purge: (run: Pick<NativeRun, 'runId' | 'sessionKey'>) => request<{ deleted: string[]; pending: string[] }>('purge', run),
  };
}
