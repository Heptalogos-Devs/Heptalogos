// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Maps one native envelope to lossless Messaging facts without network or model work.
 * @module parser
 */
import type {
  AcceptFactsInput,
  RawMessageFact,
  RawPlatformEvent,
  NativeConversation,
} from "@heptalogos/messaging";
import { createHash, randomUUID } from "node:crypto";
import { qqConversationLane, type QqTarget, QqScopePolicy } from "./policy.js";
import { controlNumber, nativeId, parseOneBotJson, record } from "./lossless.js";

/** One admitted protocol envelope, retained exactly before downstream parsing. */
export interface NativeEnvelope {
  readonly raw: string;
  readonly receivedAt: string;
  readonly receiptId: string;
}
/** Parser result carries canonical inputs plus deterministic native lane identity. */
export interface ParsedEnvelope {
  readonly facts: AcceptFactsInput["facts"];
  readonly laneKey: string;
  readonly eventId: string;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function decodeCq(value: string): string {
  return value
    .replaceAll("&#44;", ",")
    .replaceAll("&#91;", "[")
    .replaceAll("&#93;", "]")
    .replaceAll("&amp;", "&");
}
/** Parses OneBot's declared CQ-string representation once; outbound drafts never use this parser. */
function parseCqSegments(value: string): Record<string, unknown>[] {
  const segments: Record<string, unknown>[] = [];
  let cursor = 0;
  const pattern = /\[CQ:([a-zA-Z0-9_-]+)((?:,[^\]]*)?)\]/gu;
  for (const match of value.matchAll(pattern)) {
    if (match.index! > cursor)
      segments.push({
        type: "text",
        data: { text: decodeCq(value.slice(cursor, match.index)) },
      });
    const data: Record<string, string> = {};
    for (const item of (match[2] ?? "").split(",").slice(1)) {
      const split = item.indexOf("=");
      if (split > 0) data[item.slice(0, split)] = decodeCq(item.slice(split + 1));
    }
    segments.push({ type: match[1], data });
    cursor = match.index! + match[0].length;
  }
  if (cursor < value.length)
    segments.push({ type: "text", data: { text: decodeCq(value.slice(cursor)) } });
  return segments;
}
/** Returns actual ordered segments from inline array, CQ text or an explicitly unknown representation. */
export function nativeSegments(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map((segment) => record(segment))
    : typeof value === "string"
      ? parseCqSegments(value)
      : [{ type: "unknown", data: {} }];
}
/** Preserves each segment separately; malformed media cannot erase adjacent text. */
export function parseMessageParts(
  value: unknown,
  sourceRef: string,
): { parts: RawMessageFact["parts"]; references: RawMessageFact["references"] } {
  const parts: RawMessageFact["parts"] = [];
  const references: RawMessageFact["references"] = [];
  for (const [index, segment] of nativeSegments(value).entries()) {
    const kind = text(segment.type) ?? "unknown";
    const data = record(segment.data);
    const rawRef = `${sourceRef}#/segments/${index}`;
    const base = { nativeDataRef: rawRef };
    switch (kind) {
      case "text":
        parts.push({ ...base, kind: "text", text: text(data.text) ?? "" });
        break;
      case "at": {
        const target = nativeId(data.qq) ?? nativeId(data.user_id);
        parts.push({
          ...base,
          kind: "at",
          ...(target === "all"
            ? { atAll: true }
            : target
              ? { targetId: target }
              : { data: { unavailable: "missing_target" } }),
        });
        break;
      }
      case "reply": {
        const id = nativeId(data.id);
        parts.push({
          ...base,
          kind: "reply",
          ...(id ? { targetId: id } : { data: { unavailable: "missing_parent" } }),
        });
        if (id) references.push({ kind: "reply", nativeId: id, sourceRef: rawRef });
        break;
      }
      case "forward": {
        const id = nativeId(data.id) ?? nativeId(data.resid);
        parts.push({ ...base, kind: "forward", ...(id ? { targetId: id } : {}) });
        references.push({
          kind: "forward",
          nativeId: id ?? `inline:part:${index}`,
          sourceRef: rawRef,
        });
        break;
      }
      case "image":
      case "video":
      case "file":
      case "record":
      case "audio":
      case "mface":
      case "sticker": {
        const nativeSubType = controlNumber(data.sub_type);
        const mapped =
          kind === "record"
            ? "audio"
            : kind === "mface" || (kind === "image" && nativeSubType === 1)
              ? "sticker"
              : kind;
        parts.push({
          ...base,
          kind: mapped as "image" | "video" | "file" | "audio" | "sticker",
          attachment: { kind: "qq-native-segment", reference: rawRef },
          data: {
            nativeType: kind,
            ...(nativeSubType !== undefined ? { nativeSubType } : {}),
            ...(text(data.summary) ? { summary: text(data.summary) } : {}),
            ...(text(data.name) ? { name: text(data.name) } : {}),
          },
        });
        break;
      }
      case "face": {
        const nativeFace = record(data.raw);
        const semanticKeys = [
          "faceText",
          "faceType",
          "packId",
          "stickerId",
          "sourceType",
          "stickerType",
          "resultId",
          "chainCount",
        ];
        const metadata = Object.fromEntries(
          semanticKeys.flatMap((key) => {
            const value = data[key] ?? nativeFace[key];
            return typeof value === "string" ||
              typeof value === "number" ||
              typeof value === "boolean"
              ? [[key, value]]
              : [];
          }),
        );
        parts.push({
          ...base,
          kind: "face",
          ...(nativeId(data.id) ? { targetId: nativeId(data.id) } : {}),
          ...(Object.keys(metadata).length ? { data: metadata } : {}),
        });
        break;
      }
      case "json":
      case "xml":
      case "card":
        parts.push({
          ...base,
          kind: "card",
          data: { format: kind, content: text(data.data) ?? text(data.content) ?? "" },
        });
        break;
      case "share":
        parts.push({
          ...base,
          kind: "share",
          data: {
            title: text(data.title) ?? "",
            content: text(data.content) ?? "",
            url: text(data.url) ?? "",
          },
        });
        break;
      case "location":
        parts.push({
          ...base,
          kind: "location",
          data: {
            latitude: text(data.lat),
            longitude: text(data.lon),
            title: text(data.title) ?? "",
            content: text(data.content) ?? "",
          },
        });
        break;
      default:
        parts.push({ ...base, kind: "unknown", data: { nativeType: kind } });
    }
  }
  return { parts, references };
}
/** Determines authorized native scope before OpenClaw durable ingress admission. */
export function inspectNativeEnvelope(
  envelope: NativeEnvelope,
  expectedAccountId: string,
  scope: QqScopePolicy,
  sourceEnvelopeRef = `envelope:${envelope.receiptId}`,
): ParsedEnvelope | null {
  const event = record(parseOneBotJson(envelope.raw));
  const accountId = nativeId(event.self_id);
  if (!accountId || accountId !== expectedAccountId) return null;
  const groupId = nativeId(event.group_id);
  const peer =
    (event.post_type === "message_sent" ? nativeId(event.target_id) : undefined) ??
    nativeId(event.user_id) ??
    nativeId(record(event.sender).user_id);
  const target: QqTarget | undefined = groupId
    ? { kind: "group", id: groupId }
    : peer
      ? { kind: "direct", id: peer }
      : undefined;
  // Transport heartbeat/lifecycle belongs to presence, never an invented chat conversation.
  if (event.post_type === "meta_event" || !target || !scope.canReceive(target))
    return null;
  const conversation: NativeConversation = {
    platform: "qq",
    accountId,
    kind: target?.kind ?? "direct",
    conversationId: target?.id ?? accountId,
  };
  const seconds = controlNumber(event.time);
  const platformSentAt =
    seconds === undefined || !Number.isFinite(new Date(seconds * 1000).getTime())
      ? null
      : new Date(seconds * 1000).toISOString();
  const nativeMessageId = nativeId(event.message_id) ?? nativeId(event.msg_id);
  const sender = record(event.sender);
  const authorId = nativeId(sender.user_id) ?? peer;
  if (
    (event.post_type === "message" || event.post_type === "message_sent") &&
    nativeMessageId &&
    authorId
  ) {
    const fact: RawMessageFact = {
      kind: "message",
      conversation,
      nativeMessageId,
      direction: authorId === accountId ? "OUTBOUND" : "INBOUND",
      author: {
        accountId: authorId,
        ...(nativeId(sender.uid) ? { uid: nativeId(sender.uid) } : {}),
        ...(text(sender.nickname) ? { displayName: text(sender.nickname) } : {}),
        ...(text(sender.card) ? { groupCard: text(sender.card) } : {}),
      },
      platformSentAt,
      receivedAt: envelope.receivedAt,
      ...parseMessageParts(event.message, sourceEnvelopeRef),
      sourceEnvelopeRef,
    };
    return {
      facts: [fact],
      eventId: JSON.stringify([
        accountId,
        conversation.kind,
        conversation.conversationId,
        nativeMessageId,
      ]),
      laneKey: qqConversationLane(accountId, {
        kind: conversation.kind,
        id: conversation.conversationId,
      }),
    };
  }
  const type = [
    event.post_type,
    event.notice_type ?? event.request_type ?? event.meta_event_type,
    event.sub_type,
  ]
    .filter((v) => typeof v === "string")
    .join(".");
  const reliable = nativeId(event.event_id);
  const recall =
    event.notice_type === "group_recall" || event.notice_type === "friend_recall";
  const fact: RawPlatformEvent = {
    kind: "event",
    conversation,
    eventKey: reliable ?? `receipt:${envelope.receiptId}`,
    eventType: type || "unknown",
    platformSentAt,
    receivedAt: envelope.receivedAt,
    sourceEnvelopeRef,
    ...(authorId ? { actor: { accountId: authorId } } : {}),
    ...(recall && nativeMessageId
      ? { targetNativeMessageId: nativeMessageId, effect: "retract" }
      : { effect: "none" }),
  };
  return {
    facts: [fact],
    eventId: JSON.stringify([
      accountId,
      conversation.kind,
      conversation.conversationId,
      fact.eventKey,
    ]),
    laneKey: qqConversationLane(accountId, {
      kind: conversation.kind,
      id: conversation.conversationId,
    }),
  };
}
/** Assigns a durable receive identity only to events without a reliable native event id. */
export function createNativeEnvelope(
  raw: string,
  receivedAt = new Date().toISOString(),
): NativeEnvelope {
  return { raw, receivedAt, receiptId: randomUUID() };
}
/** Stable native page fingerprint detects replay/no-progress without exposing body text. */
export function nativePageFingerprint(ids: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(ids)).digest("hex");
}
