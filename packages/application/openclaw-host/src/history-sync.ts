// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reconciles limited native history after live receive starts, using the same Host accept operation.
 * @module history-sync
 */
import type { GatewayHostClient } from "@heptalogos/management-client";
import type { NativeConversation } from "@heptalogos/messaging";
import { OneBotTransport } from "./transport.js";
import { QqScopePolicy } from "./policy.js";
import { historyMadeProgress, readHistoryPage } from "./history.js";
import type { NativeEnvelope } from "./parser.js";
import type { QqPluginConfig } from "./config.js";
import { nativeId, parseOneBotJson, record } from "./lossless.js";
/** Extends a native durable envelope with protected original-history provenance only. */
export interface HistoryEnvelope extends NativeEnvelope {
  readonly originalResponseRef?: string;
  readonly originalMessageIndex?: number;
}
/** A limited provider window can overlap old progress without claiming global history completeness. */
export async function synchronizeQqHistory(
  host: GatewayHostClient,
  transport: OneBotTransport,
  scope: QqScopePolicy,
  conversation: NativeConversation,
  commit: (envelope: HistoryEnvelope) => Promise<void>,
  config: QqPluginConfig,
  signal: AbortSignal,
): Promise<void> {
  const previous = (await host.readHistoryCoverage({ conversation })).history;
  let expected = previous?.revision ?? null;
  let cursor: string | null = null;
  let fingerprint: string | undefined;
  let newest = previous?.nativeCursor ?? null;
  let reason = "history_page_budget";
  let firstNativeMessageId: string | undefined;
  let lastNativeMessageId: string | undefined;
  let coverage: "limited" | "gap" | "unavailable" = "limited";
  for (
    let pageIndex = 0;
    pageIndex < config.historyMaxPages && !signal.aborted;
    pageIndex++
  ) {
    const current = await host.gatewayScope();
    if (
      current.accountId !== conversation.accountId ||
      !current.conversations.some(
        (item) =>
          item.receive &&
          item.kind === conversation.kind &&
          item.conversationId === conversation.conversationId,
      )
    )
      return;
    const page = await readHistoryPage(
      transport,
      scope,
      conversation,
      cursor,
      config.historyPageSize,
      signal,
    );
    const source = page.sourceRaw
      ? (await host.archiveEnvelope({ kind: "envelope", value: page.sourceRaw }))
          .reference
      : undefined;
    const messages = page.envelopes.map((envelope) =>
      record(parseOneBotJson(envelope.raw)),
    );
    const ids = messages
      .map((message) => nativeId(message.message_id) ?? nativeId(message.msg_id))
      .filter((id): id is string => id !== undefined);
    if (pageIndex === 0 && ids.length)
      newest = nativeId(messages.at(-1)?.message_seq) ?? ids.at(-1)!;
    firstNativeMessageId ??= ids[0];
    if (ids.length) lastNativeMessageId = ids.at(-1);
    for (const [index, envelope] of page.envelopes.entries()) {
      signal.throwIfAborted();
      await commit({
        ...envelope,
        ...(source ? { originalResponseRef: source, originalMessageIndex: index } : {}),
      });
    }
    if (page.coverage === "unavailable") {
      coverage = "unavailable";
      reason = page.reason;
      break;
    }
    if (
      previous?.nativeCursor &&
      messages.some(
        (message) =>
          nativeId(message.message_seq) === previous.nativeCursor ||
          nativeId(message.message_id) === previous.nativeCursor,
      )
    ) {
      reason = "overlap_with_prior_native_cursor";
      break;
    }
    if (!historyMadeProgress({ cursor, fingerprint }, page)) {
      coverage = "gap";
      reason = "native_history_no_progress";
      break;
    }
    cursor = page.cursor;
    fingerprint = page.fingerprint;
  }
  if (signal.aborted) return;
  const written = await host.updateHistoryCoverage({
    conversation,
    expectedRevision: expected,
    nativeCursor: newest,
    coverage,
    reason,
    updatedAt: new Date().toISOString(),
    ...(firstNativeMessageId ? { firstNativeMessageId } : {}),
    ...(lastNativeMessageId ? { lastNativeMessageId } : {}),
  });
  expected = written.revision;
}
