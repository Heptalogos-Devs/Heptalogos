// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Restricted SQL helpers for the single canonical Messaging owner. @module repository */
import {
  executeRepositorySql,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";
import { createCanonicalConversationId } from "@heptalogos/foundation-contracts";
import type { NativeConversation } from "./contracts.js";

/** Actual Host Activity reference, derived from the admitted transaction rather than fabricated lineage. */
export function transactionLineage(context: PersistenceMutationTransactionContext) {
  return {
    schemaVersion: 1 as const,
    sourceActivityId: context.execution.activityId,
    sourceInstanceId: context.execution.instanceId,
    sourceContinuityEpochId: context.execution.continuityEpochId,
  };
}
/** Resolves and locks a conversation before allocating its next sequence. */
export async function lockConversation(
  tx: PersistenceInternalTransaction,
  context: PersistenceMutationTransactionContext,
  input: NativeConversation,
) {
  await executeRepositorySql(
    tx,
    `INSERT INTO heptalogos.messaging_conversation
    (conversation_id,installation_id,platform_id,native_account_id,native_conversation_id,conversation_kind,last_sequence,created_at,lineage_context_ref)
    VALUES($1,$2,$3,$4,$5,$6,0,now(),$7::jsonb)
    ON CONFLICT(platform_id,native_account_id,conversation_kind,native_conversation_id) DO NOTHING`,
    [
      createCanonicalConversationId(),
      context.execution.installationId,
      input.platform,
      input.accountId,
      input.conversationId,
      input.kind,
      JSON.stringify(transactionLineage(context)),
    ],
  );
  const [row] = await executeRepositorySql<{
    conversation_id: string;
    last_sequence: string | number;
  }>(
    tx,
    `SELECT conversation_id,last_sequence FROM heptalogos.messaging_conversation
     WHERE platform_id=$1 AND native_account_id=$2 AND native_conversation_id=$3 AND conversation_kind=$4 FOR UPDATE`,
    [input.platform, input.accountId, input.conversationId, input.kind],
  );
  if (!row) throw new Error("Messaging conversation was not materialized");
  const lastSequence = Number(row.last_sequence);
  if (!Number.isSafeInteger(lastSequence))
    throw new Error("Messaging sequence exceeds safe range");
  return { conversationId: row.conversation_id, lastSequence };
}
/** Parses driver JSON consistently for both the real pg adapter and repository tests. */
export function document<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}
