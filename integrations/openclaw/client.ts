import {
  nativeExecutionScope,
  nativeToolRecoveryPlan,
  nativeToolRecoveryRequest,
  nativeSessionFacts,
  nativeSessionRequest,
  nativeModelBinding,
  nativeCallFacts,
  type NativeOrigin,
  type NativeCallFacts,
} from "./model-facts.js";
import type {
  NativeModelBinding,
  ModelBudget,
} from "@nous-wave/contracts/models";
export {
  nativeExecutionScope,
  nativeCallFacts,
  nativeBindingRead,
  nativeSessionRequest,
  nativeSessionFacts,
  nativeModelBinding,
  nativeResourceId,
  invocationIdOf,
} from "./model-facts.js";
import {ProblemError,ProblemSchema,type Ref,type Problem} from "@nous-wave/contracts/common";
import type { NativeExecutionScope } from "./model-facts.js";
export type {
  NativeSessionFacts,
  NativeCallFacts,
  NativeOrigin,
  NativeExecutionScope,
} from "./model-facts.js";
export type NativeRun = {
  runId: string;
  sessionKey: string;
  sessionId?: string;
  runtime?: { harness: string; provider: string; model: string };
};
export type NativeTask = {
  traceparent?: string;
  taskId: string;
  subjectId: string;
  goal: string;
  allowedTools: string[];
  inputRefs?: unknown[];
  workspaceRef?: Ref;
  budget?: ModelBudget;
  expectedScope: NativeExecutionScope;
  returnTarget?: unknown;
};
export type NativeProgress = {
  runId: string;
  sessionKey: string;
  sessionId?: string;
  status: "running" | "waiting" | "result_ready" | "failed" | "cancelled";
  progress: import("./model-facts.js").NativeTaskProgress;
  problem?:Problem;
  result?: { text?: string; outputRef?: unknown; outputRefs?: unknown[] };
};

export function createOpenClawClient(options: {
  endpoint: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}) {
  async function request<T>(
    operation: string,
    body: unknown,
    traceparent?: string,
    owner: "tasks" | "models" = "tasks",
  ): Promise<T> {
    const response = await (options.fetch ?? globalThis.fetch)(
      `${options.endpoint.replace(/\/$/, "")}/plugins/hept/${owner}/${operation}`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(120_000),
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
          ...(traceparent ? { traceparent } : {}),
        },
        body: JSON.stringify(body),
      },
    );
    if (!response.ok) {
      const parsed=ProblemSchema.safeParse(await response.json().catch(()=>undefined));
      if(parsed.success)throw new ProblemError(parsed.data);
      throw new ProblemError({code:"native.bridge_failed",category:"unavailable",status:response.status>=400&&response.status<=599?response.status:502,messageKey:"native.bridge_failed",message:"原生连接操作失败"});
    }
    return response.json() as Promise<T>;
  }
  return {
    readSession: async (
      input: import("zod").z.infer<typeof nativeSessionRequest>,
      traceparent?: string,
    ) =>
      nativeSessionFacts
        .nullable()
        .parse(
          await request(
            "readSession",
            nativeSessionRequest.parse(input),
            traceparent,
            "models",
          ),
        ),
    readBinding: async (
      input: { runtimeId: string; nativeResourceId: string },
      traceparent?: string,
    ): Promise<Omit<NativeModelBinding, "id">> =>
      nativeModelBinding.parse(
        await request("readBinding", {runtimeId:input.runtimeId,nativeResourceId:input.nativeResourceId}, traceparent, "models"),
      ),
    readCall: async (
      input: NativeOrigin,
      traceparent?: string,
    ): Promise<NativeCallFacts | null> =>
      nativeCallFacts
        .nullable()
        .parse(await request("readCall", input, traceparent, "models")),
    describe: async (
      input: Pick<
        NativeTask,
        "taskId" | "subjectId" | "workspaceRef" | "allowedTools"
      >,
    ): Promise<NativeExecutionScope> =>
      nativeExecutionScope.parse(await request("describe", input)),
    planRecovery: async(input: import("zod").z.infer<typeof nativeToolRecoveryRequest>,traceparent?:string) => nativeToolRecoveryPlan.parse(await request("planRecovery",nativeToolRecoveryRequest.parse(input),traceparent)),
    recover: (input:{expected:import("zod").z.infer<typeof nativeToolRecoveryPlan>},traceparent?:string) => request<NativeRun>("recover",{expected:nativeToolRecoveryPlan.parse(input.expected)},traceparent),
    start: (task: NativeTask) =>
      request<NativeRun>("start", task, task.traceparent),
    inspect: (run: Pick<NativeRun, "runId" | "sessionKey" | "sessionId">) =>
      request<NativeProgress>("inspect", run),
    locate: (task: Pick<NativeTask, "taskId" | "subjectId">) =>
      request<NativeProgress>("locate", task),
    cancel: (run: Pick<NativeRun, "runId" | "sessionKey" | "sessionId">) =>
      request<{ aborted: boolean }>("cancel", run),
    transcript: (
      run: Pick<NativeRun, "runId" | "sessionKey" | "sessionId"> & {
        cursor?: string;
        offset?: number;
      },
    ) => request<unknown>("transcript", run),
    purge: (run: Pick<NativeRun, "runId" | "sessionKey" | "sessionId">) =>
      request<{ deleted: string[]; pending: string[] }>("purge", run),
  };
}
