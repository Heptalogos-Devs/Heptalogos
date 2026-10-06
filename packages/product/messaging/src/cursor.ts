// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Owns the opaque bounded MessagePage cursor codec.
 * @module cursor
 */

import {
  parseCanonicalConversationId,
  type CanonicalConversationId,
} from "@heptalogos/foundation-contracts";
import { messagingProblem } from "./problems.js";

function canonicalCursorValue(
  conversationId: CanonicalConversationId,
  sequence: number,
) {
  return { schemaVersion: 1, conversationId, sequence } as const;
}

/** Encodes the current versioned sequence cursor without a server-side registry. */
export function encodeMessageCursor(
  conversationId: CanonicalConversationId,
  sequence: number,
): string {
  if (
    parseCanonicalConversationId(conversationId) === undefined ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0
  ) {
    throw messagingProblem(
      "messaging.cursor_invalid",
      "Message cursor is invalid",
      "The cursor conversation or sequence is invalid",
    );
  }
  return Buffer.from(
    JSON.stringify(canonicalCursorValue(conversationId, sequence)),
  ).toString("base64url");
}

/** Decodes and validates one versioned opaque sequence cursor. */
export function decodeMessageCursor(value: string): {
  readonly conversationId: CanonicalConversationId;
  readonly sequence: number;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    throw messagingProblem(
      "messaging.cursor_invalid",
      "Message cursor is invalid",
      "The cursor is not a valid encoded sequence cursor",
      "validation",
      "manual",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw messagingProblem(
      "messaging.cursor_invalid",
      "Message cursor is invalid",
      "The cursor payload is not an object",
    );
  }
  const record = parsed as Record<string, unknown>;
  const conversationId = parseCanonicalConversationId(record.conversationId);
  const sequence = record.sequence;
  if (
    record.schemaVersion !== 1 ||
    conversationId === undefined ||
    typeof sequence !== "number" ||
    !Number.isSafeInteger(sequence) ||
    sequence < 0
  ) {
    throw messagingProblem(
      "messaging.cursor_invalid",
      "Message cursor is invalid",
      "The cursor version, conversation, or sequence is invalid",
    );
  }
  return { conversationId, sequence };
}
