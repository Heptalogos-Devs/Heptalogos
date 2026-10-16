// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns OneBot history pages and honest native progress without another recorder.
 * @module history
 */
import type { NativeConversation } from "@heptalogos/messaging";
import { OneBotTransport, OneBotTransportError } from "./transport.js";
import { nativeId, record } from "./lossless.js";
import {
  createNativeEnvelope,
  inspectNativeEnvelope,
  nativePageFingerprint,
  type NativeEnvelope,
} from "./parser.js";
import { QqScopePolicy } from "./policy.js";

/** One page is explicitly limited unless the concrete protocol reports a trustworthy boundary. */
export interface NativeHistoryPage {
  readonly envelopes: readonly NativeEnvelope[];
  readonly sourceRaw?: string;
  readonly cursor: string | null;
  readonly fingerprint: string;
  readonly coverage: "limited" | "unavailable";
  readonly reason: string;
}
/** Pulls only an authorized native page; identities use the same normalization as live events. */
export async function readHistoryPage(
  transport: OneBotTransport,
  scope: QqScopePolicy,
  conversation: NativeConversation,
  cursor: string | null,
  count: number,
  signal?: AbortSignal,
): Promise<NativeHistoryPage> {
  if (!scope.canReceive({ kind: conversation.kind, id: conversation.conversationId }))
    throw new Error("History conversation is outside Host scope");
  if (!Number.isSafeInteger(count) || count < 1 || count > 100)
    throw new Error("History page budget is invalid");
  const action =
    conversation.kind === "group" ? "get_group_msg_history" : "get_friend_msg_history";
  try {
    const reply = await transport.readEnvelope(
      action,
      {
        [conversation.kind === "group" ? "group_id" : "user_id"]:
          conversation.conversationId,
        ...(cursor ? { message_seq: cursor } : {}),
        count,
        reverse_order: false,
        disable_get_url: false,
        parse_mult_msg: true,
      },
      signal,
    );
    const response = reply.data;
    const messages = Array.isArray(response.messages) ? response.messages : [];
    const envelopes = messages.map((value) => {
      const event = record(value);
      return createNativeEnvelope(
        JSON.stringify({
          ...event,
          self_id: conversation.accountId,
          post_type:
            conversation.kind === "direct" &&
            (nativeId(record(event.sender).user_id) ?? nativeId(event.user_id)) ===
              conversation.accountId
              ? "message_sent"
              : "message",
          message_type: conversation.kind === "group" ? "group" : "private",
          ...(conversation.kind === "group"
            ? { group_id: conversation.conversationId }
            : {
                target_id: conversation.conversationId,
                user_id: nativeId(event.user_id) ?? conversation.conversationId,
              }),
        }),
      );
    });
    const ids = envelopes.flatMap((envelope) => {
      const parsed = inspectNativeEnvelope(envelope, conversation.accountId, scope);
      return (
        parsed?.facts.flatMap((fact) =>
          fact.kind === "message" ? [fact.nativeMessageId] : [],
        ) ?? []
      );
    });
    const first = record(messages[0]);
    const next =
      nativeId(response.next_cursor) ??
      nativeId(response.next_seq) ??
      nativeId(first.message_seq) ??
      nativeId(first.message_id) ??
      null;
    return {
      envelopes,
      sourceRaw: reply.raw,
      cursor: next,
      fingerprint: nativePageFingerprint(ids),
      coverage: "limited",
      reason: messages.length
        ? "protocol_history_window"
        : "empty_page_is_not_completeness",
    };
  } catch (error) {
    if (error instanceof OneBotTransportError && error.code !== "aborted")
      return {
        envelopes: [],
        cursor,
        fingerprint: nativePageFingerprint([]),
        coverage: "unavailable",
        reason:
          error.code === "rejected"
            ? "protocol_history_unavailable"
            : "protocol_history_disconnected",
      };
    throw error;
  }
}
/** Stops bounded recovery when a page or native cursor fails to advance. */
export function historyMadeProgress(
  previous: { cursor: string | null; fingerprint?: string },
  page: NativeHistoryPage,
): boolean {
  return (
    page.envelopes.length > 0 &&
    page.cursor !== null &&
    page.cursor !== previous.cursor &&
    page.fingerprint !== previous.fingerprint
  );
}
