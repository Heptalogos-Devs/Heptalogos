// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { resolveNarrativeReview } from "../../src/narrative.js";
import type { PreparedDelivery } from "../../src/agency-contracts.js";
import type { NarrativeReviewProposal } from "../../src/narrative-contracts.js";

const prepared = (text: string) =>
  ({
    preparedBatch: {
      entries: [{ sourceIndex: 0, status: "accepted", payload: { text } }],
    },
  }) as unknown as PreparedDelivery;
const proposal = (quote: string): NarrativeReviewProposal => ({
  claims: [
    {
      sourceIndex: 0,
      quote,
      content: "描述实际材料",
      entityRefs: [],
      kind: "external_result",
      stance: "reported",
      polarity: "affirm",
      about: null,
      basis: "report",
      sourceRefs: ["material:example"],
      eventRefs: [],
      cognitionRefs: [],
      priorClaimRefs: [],
    },
  ],
  conflicts: [],
  commitments: [],
  worldPatch: null,
});
describe("owner-derived narrative quote positions", () => {
  it("derives UTF-16 offsets from exact final text while retaining the proposed claim", () => {
    const input = proposal("猫🐈抬爪。");
    const result = resolveNarrativeReview(prepared("🙂 前缀：猫🐈抬爪。 后缀"), input);
    expect(result.claims[0]).toEqual({ ...input.claims[0], start: 6, end: 12 });
  });
  it.each(["狗。", "猫。猫。"])(
    "rejects an absent or ambiguous exact quotation in %s",
    (text) => {
      expect(() => resolveNarrativeReview(prepared(text), proposal("猫。"))).toThrow(
        "one exact quotation",
      );
    },
  );
});
