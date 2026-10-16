// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Routes every native QQ send through Host custody and records honest physical outcomes.
 * @module delivery
 */
import type { GatewayHostClient } from "@heptalogos/management-client/gateway";
import {
  defineChannelMessageAdapter,
  type ChannelMessageAdapterShape,
  type ChannelMessageSendTextContext,
  type ChannelMessageSendMediaContext,
  type ChannelMessageSendResult,
} from "openclaw/plugin-sdk/channel-message";
import { PlatformMessageNotDispatchedError } from "openclaw/plugin-sdk/error-runtime";
import { loadWebMediaRaw } from "openclaw/plugin-sdk/web-media";
import { buildOutboundMediaLoadOptions } from "openclaw/plugin-sdk/media-runtime";
import { basename } from "node:path";
import { OneBotTransport, OneBotTransportError } from "./transport.js";
import { OneBotPresence } from "./presence.js";
import { QqScopePolicy, type QqTarget } from "./policy.js";
import { nativeId } from "./lossless.js";

/** Adapter dependencies carry no raw OneBot API into model tool surfaces. */
export interface QqDeliveryOptions {
  readonly host: GatewayHostClient;
  readonly transport: OneBotTransport;
  readonly presence: OneBotPresence;
  readonly accountId: string;
  readonly maxTextBytes: number;
  readonly mediaMaxBytes: number;
  readonly onError: (code: string) => void;
}
type Dispatch = Parameters<GatewayHostClient["beginDelivery"]>[0];
function rejected(code: string, retryable = false): PlatformMessageNotDispatchedError {
  return new PlatformMessageNotDispatchedError(code, { retryable, cause: undefined });
}
/** Requires explicit native group/direct routing; a bare number never guesses the conversation kind. */
export function parseQqTarget(to: string): QqTarget {
  const matched = /^(group|direct):([^:\s]+)$/u.exec(to);
  if (!matched) throw rejected("qq.target_invalid");
  return { kind: matched[1] as QqTarget["kind"], id: matched[2]! };
}
function policy(
  scope: Awaited<ReturnType<GatewayHostClient["gatewayScope"]>>,
): QqScopePolicy {
  return new QqScopePolicy(
    new Set(
      scope.conversations
        .filter((c) => c.receive)
        .map((c) => `${c.kind}:${c.conversationId}`),
    ),
    new Set(
      scope.conversations
        .filter((c) => c.effects.includes("send"))
        .map((c) => `${c.kind}:${c.conversationId}`),
    ),
  );
}
function receipt(
  messageId: string,
  ctx: ChannelMessageSendTextContext,
  kind: "text" | "media",
  acceptedAt: string,
): ChannelMessageSendResult {
  const partIndex = ctx.deliveryPartIndex ?? 0;
  return {
    messageId,
    target: { kind: "conversation", id: ctx.to },
    receipt: {
      primaryPlatformMessageId: messageId,
      platformMessageIds: [messageId],
      parts: [
        {
          platformMessageId: messageId,
          kind,
          index: partIndex,
          ...(ctx.replyToId ? { replyToId: ctx.replyToId } : {}),
        },
      ],
      ...(ctx.replyToId ? { replyToId: ctx.replyToId } : {}),
      sentAt: Date.parse(acceptedAt),
    },
  };
}
/** Keeps a complete reviewed draft as one physical part or rejects it before network dispatch. */
export function wholeDraftChunker(text: string, maxBytes: number): string[] {
  if (Buffer.byteLength(text) > maxBytes)
    throw rejected("qq.complete_draft_exceeds_byte_limit");
  return [text];
}
/** Creates the one public native send adapter; edit, withdraw, reaction and moderation are unsupported. */
export function createQqMessageAdapter(
  options: QqDeliveryOptions,
): ChannelMessageAdapterShape {
  const validateScope = async (to: string, accountId?: string | null) => {
    const current = await options.host.gatewayScope();
    if (current.accountId !== options.accountId || accountId !== options.accountId)
      throw rejected("qq.account_binding_changed");
    policy(current).assertCanSend(parseQqTarget(to));
    return current;
  };
  const dispatch = async (
    ctx: ChannelMessageSendTextContext,
    payload: Dispatch["payload"],
    buildSegments: () => Promise<readonly unknown[]>,
    kind: "text" | "media",
  ): Promise<ChannelMessageSendResult> => {
    if (
      !ctx.deliveryCustody?.reference ||
      !ctx.deliveryQueueId ||
      ctx.sourceIndex === undefined ||
      !Number.isSafeInteger(ctx.sourceIndex) ||
      ctx.sourceIndex < 0
    )
      throw rejected("qq.native_custody_missing");
    if (ctx.threadId !== undefined && ctx.threadId !== null)
      throw rejected("qq.thread_unsupported");
    if ((ctx.deliveryPartIndex ?? 0) !== 0 || (ctx.deliveryPartCount ?? 1) !== 1)
      throw rejected("qq.approved_source_requires_one_physical_part");
    const request: Dispatch = {
      reference: ctx.deliveryCustody.reference,
      channel: "heptalogos-qq",
      accountId: options.accountId,
      to: ctx.to,
      ...(ctx.replyToId !== undefined ? { replyToId: ctx.replyToId } : {}),
      ...(ctx.threadId !== undefined ? { threadId: ctx.threadId } : {}),
      deliveryQueueId: ctx.deliveryQueueId,
      payload: {
        ...payload,
        sourceIndex: ctx.sourceIndex,
        deliveryPartIndex: 0,
        deliveryPartCount: 1,
      },
    };
    let begun: Awaited<ReturnType<GatewayHostClient["beginDelivery"]>>;
    try {
      begun = await options.host.beginDelivery(request);
    } catch {
      throw rejected("qq.host_begin_unavailable", true);
    }
    if (begun.action === "return") {
      if (begun.outcome.state === "accepted") {
        const result = receipt(
          begun.outcome.platformMessageId,
          ctx,
          kind,
          begun.outcome.acceptedAt,
        );
        await ctx.onDeliveryResult?.(result);
        return result;
      }
      if (begun.outcome.state === "uncertain")
        throw new OneBotTransportError("invalid_response", true);
      throw rejected("qq.prior_delivery_" + begun.outcome.state);
    }
    const attemptId = begun.attemptId;
    let outcome: Parameters<GatewayHostClient["recordDelivery"]>[0]["outcome"];
    let result: ChannelMessageSendResult | undefined;
    let sendError: unknown;
    let dispatchStarted = false;
    try {
      await validateScope(ctx.to, ctx.accountId);
      const target = parseQqTarget(ctx.to);
      await options.presence.assertSendAvailable(target, ctx.signal);
      const segments = await buildSegments();
      ctx.signal?.throwIfAborted();
      await ctx.onPlatformSendDispatch?.();
      ctx.assertDirectAdapterHandoff?.();
      dispatchStarted = true;
      const reply = await options.transport.send(target, segments, ctx.signal);
      const messageId = nativeId(reply.message_id);
      if (!messageId) throw new OneBotTransportError("invalid_response", true);
      const acceptedAt = new Date().toISOString();
      outcome = { state: "accepted", platformMessageId: messageId, acceptedAt };
      result = receipt(messageId, ctx, kind, acceptedAt);
    } catch (error) {
      sendError = error;
      outcome =
        error instanceof OneBotTransportError && error.uncertain
          ? { state: "uncertain", code: "qq." + error.code }
          : dispatchStarted &&
              error instanceof OneBotTransportError &&
              error.code === "rejected"
            ? { state: "failed", code: "qq.platform_rejected" }
            : { state: "not_sent", code: "qq.pre_dispatch_rejected" };
    }
    // Native receipt persistence precedes later fallible Host feedback; either owner gate prevents replay.
    let receiptFailure = false;
    if (result)
      try {
        await ctx.onDeliveryResult?.(result);
      } catch {
        receiptFailure = true;
        options.onError("native_receipt_write_failed");
      }
    let recorded = false;
    for (let attempt = 0; attempt < 3 && !recorded; attempt++)
      try {
        await options.host.recordDelivery({
          reference: request.reference,
          sourceIndex: ctx.sourceIndex,
          partIndex: 0,
          attemptId,
          outcome,
        });
        recorded = true;
      } catch {
        options.onError("host_delivery_feedback_pending");
      }
    if (!recorded || receiptFailure)
      throw new OneBotTransportError("invalid_response", true);
    if (result) return result;
    if (outcome.state === "uncertain") throw sendError;
    throw rejected(
      outcome.state === "failed" ? "qq.platform_rejected" : "qq.not_dispatched",
      sendError instanceof OneBotTransportError && sendError.code === "not_connected",
    );
  };
  const text = async (
    ctx: ChannelMessageSendTextContext,
  ): Promise<ChannelMessageSendResult> => {
    const segments: unknown[] = [
      ...(ctx.replyToId ? [{ type: "reply", data: { id: ctx.replyToId } }] : []),
      { type: "text", data: { text: ctx.text } },
    ];
    return dispatch(
      ctx,
      { sourceIndex: ctx.sourceIndex ?? 0, kind: "text", text: ctx.text },
      async () => {
        wholeDraftChunker(ctx.text, options.maxTextBytes);
        return segments;
      },
      "text",
    );
  };
  const media = async (
    ctx: ChannelMessageSendMediaContext,
  ): Promise<ChannelMessageSendResult> => {
    return dispatch(
      ctx,
      {
        sourceIndex: ctx.sourceIndex ?? 0,
        kind: "media",
        text: ctx.text,
        mediaUrl: ctx.mediaUrl,
      },
      async () => {
        wholeDraftChunker(ctx.text, options.maxTextBytes);
        const load = buildOutboundMediaLoadOptions({
          maxBytes: options.mediaMaxBytes,
          mediaAccess: ctx.mediaAccess,
          mediaLocalRoots: ctx.mediaLocalRoots,
          mediaReadFile: ctx.mediaReadFile,
          optimizeImages: false,
        });
        if (load.localRoots === "any")
          throw rejected("qq.unbounded_local_media_forbidden");
        const loaded = await loadWebMediaRaw(ctx.mediaUrl, {
          ...load,
          maxBytes: options.mediaMaxBytes,
        });
        const type = ctx.forceDocument
          ? "file"
          : loaded.kind === "image"
            ? "image"
            : loaded.kind === "audio"
              ? "record"
              : loaded.kind === "video"
                ? "video"
                : "file";
        const name = basename(loaded.fileName ?? "attachment").replace(
          /[\0\r\n]/gu,
          "_",
        );
        const segments: unknown[] = [
          ...(ctx.replyToId ? [{ type: "reply", data: { id: ctx.replyToId } }] : []),
          ...(ctx.text ? [{ type: "text", data: { text: ctx.text } }] : []),
          {
            type,
            data: { file: "base64://" + loaded.buffer.toString("base64"), name },
          },
        ];
        return segments;
      },
      "media",
    );
  };
  return defineChannelMessageAdapter({
    id: "heptalogos-qq",
    receive: {
      defaultAckPolicy: "after_receive_record",
      supportedAckPolicies: ["after_receive_record"],
    },
    deliveryCustody: {
      async adopt(context) {
        await validateScope(context.to, context.accountId);
        if (!context.deliveryIntentId || !context.runId)
          throw rejected("qq.native_producer_provenance_missing");
        if (context.threadId !== undefined && context.threadId !== null)
          throw rejected("qq.thread_unsupported");
        return options.host.adoptDelivery({
          channel: "heptalogos-qq",
          accountId: options.accountId,
          to: context.to,
          nativeIntentId: context.deliveryIntentId,
          runId: context.runId,
          preparedBatch: Object.fromEntries(Object.entries(context.preparedBatch)),
          ...(context.reply?.replyToId ? { replyToId: context.reply.replyToId } : {}),
          ...(context.reply?.source === "implicit"
            ? { replyToMode: context.reply.mode }
            : {}),
          ...(context.threadId !== undefined ? { threadId: context.threadId } : {}),
        });
      },
      async authorize(context) {
        await validateScope(context.to, context.accountId);
        const kind = context.payload.kind;
        if (kind !== "text" && kind !== "media" && kind !== "payload")
          throw rejected("qq.payload_kind_unsupported");
        if (!context.deliveryQueueId) throw rejected("qq.native_queue_missing");
        const { payload: rawPayload, ...nativePayload } = context.payload;
        const payload: Dispatch["payload"] = {
          ...nativePayload,
          kind,
          ...(rawPayload
            ? { payload: Object.fromEntries(Object.entries(rawPayload)) }
            : {}),
        };
        await options.host.authorizeDelivery({
          reference: context.custody.reference,
          channel: "heptalogos-qq",
          accountId: options.accountId,
          to: context.to,
          deliveryQueueId: context.deliveryQueueId,
          payload,
          ...(context.replyToId !== undefined ? { replyToId: context.replyToId } : {}),
          ...(context.threadId !== undefined ? { threadId: context.threadId } : {}),
        });
      },
    },
    durableFinal: {
      capabilities: { text: true, media: true, replyTo: true, batch: true },
      automaticUnknownSendReconciliation: false,
    },
    send: { text, media },
  });
}
