// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from "vitest";
import { worldRequest } from "../../src/world-request.js";
describe("ordinary world CLI parameters", () => {
  it("keeps world knowledge time separate from real recording cutoff and requires explicit mutation identity", () => {
    const flags = {
      "subject-id": "subject",
      "world-id": "world",
      domain: "school",
      from: "2026-10-16T00:00:00Z",
      to: "2026-10-16T01:00:00Z",
      "as-recorded-at": "2026-10-17T02:00:00Z",
      "knowledge-at": "2026-10-16T00:45:00Z",
    };
    expect(worldRequest("query", flags)).toEqual({
      subjectId: "subject",
      worldId: "world",
      interval: { timeDomainRef: "school", start: flags.from, end: flags.to },
      view: "subject",
      limit: 50,
      asRecordedAt: flags["as-recorded-at"],
      knowledgeAtWorldTime: { timeDomainRef: "school", at: flags["knowledge-at"] },
    });
    expect(() => worldRequest("advance", flags)).toThrow("--activity-id");
    expect(() => worldRequest("realize", flags)).toThrow("完整 owner 请求");
    const exact = { operationId: "caller-operation", expectedRevision: 4 };
    expect(worldRequest("realize", {}, exact)).toBe(exact);
  });
});
