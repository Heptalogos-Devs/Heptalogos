import { RefSchema } from "@nous-wave/contracts/common";
import { NativeModelBindingSchema, NativeOriginSchema } from "@nous-wave/contracts/models";
// Copyright 2026 Arsvine Zhu; SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
export type NativeOrigin = z.infer<typeof NativeOriginSchema>;
const count = z.number().int().nonnegative().safe();
export const nativeBindingRead = z.strictObject({
  runtimeId: z.string().min(1),
  nativeResourceId: z.string().min(1),
});
export const nativeModelBinding = NativeModelBindingSchema.omit({ id: true });
export const nativeCallFacts = z.strictObject({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  currentSessionId: z.string().min(1),
  sessionKey: z.string().min(1),
  runId: z.string().min(1),
  callId: z.string().min(1),
  prepared: z.strictObject({
    entryId: z.string().min(1),
    provider: z.string().min(1),
    modelId: z.string().min(1),
    role: z.string().optional(),
    inputTokensEstimate: count,
    outputTokens: count.positive(),
    inputRefs: z.array(RefSchema),
  }),
  active: z.boolean(),
  dispatched: z.boolean(),
  notDispatched: z.boolean(),
  terminal: z
    .strictObject({
      entryId: z.string().min(1),
      stopReason: z.string().optional(),
      providerRefused: z.boolean(),
      outputRef: RefSchema.optional(),
      selectedOutputRefs: z.array(RefSchema).optional(),
      providerRequestId: z.string().optional(),
      usage: z
        .strictObject({
          input: count,
          output: count,
          cacheRead: count,
          cacheWrite: count,
        })
        .optional(),
    })
    .optional(),
  settlement: z
    .strictObject({
      entryId: z.string().min(1),
      outcome: z.enum(["completed", "not_sent", "unknown"]),
    })
    .optional(),
  task: z
    .strictObject({
      subjectId: z.uuid(),
      taskId: z.uuid(),
      sessionKey: z.string().min(1),
      sessionId: z.string().min(1),
    })
    .optional(),
});
export const nativeSessionRequest = z.strictObject({
  runtimeId: z.string().min(1),
  sessionKey: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
});
export const nativeSessionFacts = nativeSessionRequest.omit({ runtimeId: true }).extend({
  agentId: z.string().min(1),
  task: nativeCallFacts.shape.task.unwrap(),
});
export type NativeSessionFacts = z.infer<typeof nativeSessionFacts>;
export const nativeExecutionScope = z.strictObject({
  runtimeId: z.string().min(1),
  agentId: z.string().min(1),
  sessionKey: z.string().min(1),
  workspaceRef: RefSchema.optional(),
  allowedTools: z.array(z.string()),
  model: nativeModelBinding,
});
export type NativeExecutionScope = z.infer<typeof nativeExecutionScope>;
export type NativeCallFacts = z.infer<typeof nativeCallFacts>;

export const nativeToolRecoveryPlan = nativeSessionRequest.extend({
  callId:z.string().min(1),terminalEntryId:z.string().min(1),pendingToolCallIds:z.array(z.string().min(1)).min(1),executionScope:nativeExecutionScope,
});
export const nativeToolRecoveryRequest = z.strictObject({ native:nativeSessionRequest.extend({callId:z.string().min(1)}),expectedScope:nativeExecutionScope });
export type NativeToolRecoveryPlan=z.infer<typeof nativeToolRecoveryPlan>;

export const nativeTaskProgress=z.strictObject({
  nativeStatus:z.enum(["ok","error","timeout","pending","accepted","unknown"]),
  active:z.boolean(),runId:z.string().min(1),sessionKey:z.string().min(1),sessionId:z.string().min(1).optional(),
  startedAt:z.number().int().nonnegative().optional(),endedAt:z.number().int().nonnegative().optional(),providerStarted:z.boolean().optional(),
  reason:z.enum(["native_run_queued","native_run_outcome_pending","native_run_not_confirmed"]).optional(),
});
export type NativeTaskProgress=z.infer<typeof nativeTaskProgress>;
