// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  acceptFactsInputSchema,
  prepareReadInputSchema,
  updateAttachmentInputSchema,
} from "../../src/contracts.js";

it("rejects numeric native identities before they can lose precision in the recorder", () => {
  const message = {
    kind: "message",
    conversation: {
      platform: "qq",
      accountId: "9007199254740993999",
      conversationId: "123456",
      kind: "group",
    },
    nativeMessageId: "9007199254740993123",
    direction: "INBOUND",
    author: { accountId: "10001" },
    platformSentAt: null,
    receivedAt: "2026-10-15T15:00:00.000Z",
    parts: [{ kind: "unknown", nativeDataRef: "archive:opaque" }],
    references: [],
    sourceEnvelopeRef: "archive:envelope",
  };
  const validator = compileSchema(acceptFactsInputSchema);
  expect(validator.validate({ facts: [message] }).ok).toBe(true);
  expect(
    validator.validate({ facts: [{ ...message, nativeMessageId: 9007199254740994 }] })
      .ok,
  ).toBe(false);
  expect(
    validator.validate({
      facts: [
        { ...message, conversation: { ...message.conversation, accountId: 12345 } },
      ],
    }).ok,
  ).toBe(false);
});
it("compiles shared wire schemas strictly and rejects unbounded or malformed work", () => {
  const read = compileSchema(prepareReadInputSchema);
  expect(
    read.validate({
      messageRefs: [],
      audience: { subjectId: "subject", conversationIds: [] },
      budget: { maxMessages: 513, maxBytes: 1 },
    }).ok,
  ).toBe(false);
  const attachment = compileSchema(updateAttachmentInputSchema);
  expect(
    attachment.validate({
      attachmentId: "malformed",
      expectedRevision: 0,
      state: "available",
    }).ok,
  ).toBe(false);
});
