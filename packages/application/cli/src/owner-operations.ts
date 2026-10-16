// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Maps explicit operator CLI verbs to schema-generated owner operations, without Product rules or database access.
 * @module owner-operations
 */
import type { GatewayHostClient } from "@heptalogos/management-client/gateway";
import { CliFailure } from "./base-command.js";
/** Explicit Activity operation names, each consumed by the existing Life or dispatch owner. */
export const lifeOperations = {
  list: "scheduleActivities",
  get: "readActivity",
  propose: "proposeActivity",
  adopt: "adoptActivity",
  transition: "transitionActivity",
  progress: "progressActivity",
  attention: "takeAttention",
  dispatch: "dispatchActivity",
} as const;
/** Explicit Pursuit operation names, each consumed by its canonical service API. */
export const pursuitOperations = {
  list: "listPursuits",
  get: "readPursuit",
  adopt: "adoptPursuit",
  evaluate: "evaluatePursuit",
  recheck: "recheckPursuit",
  transition: "transitionPursuit",
  reconsider: "reconsiderPursuit",
  history: "pursuitHistory",
} as const;
/** Forwards one JSON body unchanged; schemas, CAS, authority and idempotency stay at their actual owners. */
export function invokeOwnerOperation(
  client: GatewayHostClient,
  kind: "life" | "pursuit",
  operation: string,
  input: unknown,
): Promise<unknown> {
  const methods = kind === "life" ? lifeOperations : pursuitOperations;
  if (!Object.hasOwn(methods, operation))
    throw new CliFailure("cli.invalid_operation", "请选择帮助中列出的确定性操作。", 2);
  const method = methods[operation as keyof typeof methods] as keyof GatewayHostClient;
  return (client[method] as (body: never) => Promise<unknown>)(input as never);
}
