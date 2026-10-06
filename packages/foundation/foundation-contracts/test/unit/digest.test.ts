// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { digestCanonicalJson } from "../../src/digest.js";

describe("digestCanonicalJson", () => {
  it("is stable across object member ordering", () => {
    expect(digestCanonicalJson("test.domain/v1", { b: 2, a: 1 }).hex).toBe(
      digestCanonicalJson("test.domain/v1", { a: 1, b: 2 }).hex,
    );
  });

  it("separates identical payloads by digest domain", () => {
    const payload = { id: "same" } as const;
    expect(digestCanonicalJson("approval/v1", payload).hex).not.toBe(
      digestCanonicalJson("artifact/v1", payload).hex,
    );
  });

  it("returns lowercase SHA-256 hex", () => {
    expect(digestCanonicalJson("test.domain/v1", { a: 1 }).hex).toMatch(
      /^[0-9a-f]{64}$/u,
    );
  });
});
