// Copyright 2026 Arsvine Zhu; SPDX-License-Identifier: AGPL-3.0-only
import { z } from "zod";
export {
  nativeBindingRead,
  nativeModelBinding,
  nativeCallFacts,
  nativeSessionRequest,
  nativeSessionFacts,
  nativeExecutionScope,
  nativeToolRecoveryRequest,
  nativeToolRecoveryPlan,
  nativeTaskProgress,
} from "@heptalogos/contracts";
export type {
  NativeOrigin,
  NativeSessionFacts,
  NativeExecutionScope,
  NativeCallFacts,
  NativeToolRecoveryPlan,
  NativeTaskProgress,
} from "@heptalogos/contracts";
export function nativeResourceId(input: { agentId: string; provider: string; modelId: string }) {
  return `agent:${encodeURIComponent(input.agentId)}:model:${encodeURIComponent(input.provider)}:${encodeURIComponent(input.modelId)}`;
}
export function parseNativeResourceId(value: string) {
  const match = /^agent:([^:]+):model:([^:]+):([^:]+)$/.exec(value);
  if (!match) throw new Error("Native resource identity is not an agent/provider/model tuple");
  const input = {
    agentId: decodeURIComponent(match[1]!),
    provider: decodeURIComponent(match[2]!),
    modelId: decodeURIComponent(match[3]!),
  };
  if (nativeResourceId(input) !== value)
    throw new Error("Native resource identity must use its canonical tuple");
  return input;
}
/** The source owner mints the suffix once before PREPARED is persisted. */
export function invocationIdOf(input: { runId: string; callId: string }) {
  const prefix = `${input.runId}:`;
  if (!input.callId.startsWith(prefix)) throw new Error("Native call does not belong to this run");
  return z.uuidv7().parse(input.callId.slice(prefix.length));
}
