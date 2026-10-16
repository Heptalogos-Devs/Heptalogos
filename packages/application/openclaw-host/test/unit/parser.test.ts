// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { expect, it } from "vitest";
import {
  createNativeEnvelope,
  inspectNativeEnvelope,
  parseMessageParts,
} from "../../src/parser.js";
import { QqScopePolicy, qqConversationLane } from "../../src/policy.js";
const scope = new QqScopePolicy(
  new Set(["group:1101497265", "group:1072706649", "direct:2162371684"]),
  new Set(["group:1101497265", "direct:2162371684"]),
);
it("preserves native integers, ordered rich parts and real per-message authors", () => {
  const envelope = createNativeEnvelope(
    '{"self_id":3644596926,"post_type":"message","message_type":"group","group_id":1101497265,"message_id":900719925474099312345,"time":1792108800,"sender":{"user_id":2162371684,"nickname":"author","card":"group card"},"message":[{"type":"text","data":{"text":"first"}},{"type":"at","data":{"qq":"all"}},{"type":"record","data":{"file":"native-record-id"}},{"type":"forward","data":{"id":"native-forward"}},{"type":"future","data":{"raw":"preserved by archive"}}]}',
  );
  const result = inspectNativeEnvelope(
    envelope,
    "3644596926",
    scope,
    "archive:opaque",
  )!;
  const fact = result.facts[0]!;
  expect(fact.kind).toBe("message");
  if (fact.kind !== "message") throw Error("missing fixture message");
  expect(fact.nativeMessageId).toBe("900719925474099312345");
  expect(fact.author).toEqual({
    accountId: "2162371684",
    displayName: "author",
    groupCard: "group card",
  });
  expect(fact.parts.map((p) => p.kind)).toEqual([
    "text",
    "at",
    "audio",
    "forward",
    "unknown",
  ]);
  expect(fact.parts[1]?.atAll).toBe(true);
  expect(fact.references[0]?.sourceRef).toBe("archive:opaque#/segments/3");
  expect(fact.sourceEnvelopeRef).toBe("archive:opaque");
});
it("filters unauthorized chats before durable admission and isolates direct/group sessions", () => {
  const event = createNativeEnvelope(
    '{"self_id":3644596926,"post_type":"message","group_id":999,"user_id":1,"message_id":2,"message":"body"}',
  );
  expect(inspectNativeEnvelope(event, "3644596926", scope)).toBeNull();
  expect(inspectNativeEnvelope(event, "different-account", scope)).toBeNull();
  expect(qqConversationLane("account", { kind: "group", id: "2162371684" })).not.toBe(
    qqConversationLane("account", { kind: "direct", id: "2162371684" }),
  );
});
it("uses one CQ parser for declared inbound strings and retains unknown/card/media structures", () => {
  const parsed = parseMessageParts(
    "literal&#91;x&#93;[CQ:reply,id=123][CQ:image,file=native][CQ:json,data={&quot;x&quot;:1}][CQ:unknown,k=v]",
    "archive:opaque",
  );
  expect(parsed.parts.map((p) => p.kind)).toEqual([
    "text",
    "reply",
    "image",
    "card",
    "unknown",
  ]);
  expect(parsed.parts[0]?.text).toBe("literal[x]");
  expect(parsed.references[0]?.nativeId).toBe("123");
});

it("retains actual custom sticker and native face semantics separately from image encoding", () => {
  const parsed = parseMessageParts(
    [
      {
        type: "image",
        data: {
          sub_type: 1,
          summary: "[动画表情]",
          file: "custom.gif",
          url: "https://private.invalid/signed",
        },
      },
      { type: "image", data: { sub_type: 0, file: "photo.jpg" } },
      {
        type: "face",
        data: {
          id: "424",
          raw: { faceText: "/续标识", faceType: 3, packId: "1", stickerId: "52" },
          chainCount: 0,
        },
      },
      { type: "face", data: { id: "281", raw: { faceText: "/无眼笑", faceType: 2 } } },
    ],
    "archive:actual-semantics",
  );
  expect(parsed.parts.map((p) => p.kind)).toEqual(["sticker", "image", "face", "face"]);
  expect(parsed.parts[0]!.data).toEqual({
    nativeType: "image",
    nativeSubType: 1,
    summary: "[动画表情]",
  });
  expect(parsed.parts[1]!.data).toEqual({ nativeType: "image", nativeSubType: 0 });
  expect(parsed.parts[2]!.data).toMatchObject({
    faceType: 3,
    faceText: "/续标识",
    packId: "1",
    stickerId: "52",
    chainCount: 0,
  });
  expect(parsed.parts[3]!.data).toMatchObject({ faceType: 2, faceText: "/无眼笑" });
  expect(JSON.stringify(parsed)).not.toContain("signed");
});
