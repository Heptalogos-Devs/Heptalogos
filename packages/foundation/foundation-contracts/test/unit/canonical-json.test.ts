// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { canonicalizeJson, snapshotCanonicalJson } from "../../src/canonical-json.js";

describe("canonicalizeJson", () => {
  it("produces identical bytes for semantically identical object member ordering", () => {
    const a = canonicalizeJson({ z: 1, a: { y: true, x: "v" } });
    const b = canonicalizeJson({ a: { x: "v", y: true }, z: 1 });
    expect(a).toBe(b);
  });

  it("rejects values outside the supported canonical JSON domain", () => {
    expect(() => canonicalizeJson({ value: Number.NaN })).toThrow();
  });

  it("returns a detached deeply frozen snapshot", () => {
    const source = { nested: { value: 1 }, list: [1, 2] };

    const snapshot = snapshotCanonicalJson(source);
    source.nested.value = 9;
    source.list.push(3);

    expect(snapshot.value).toEqual({ nested: { value: 1 }, list: [1, 2] });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.value)).toBe(true);
    expect(Object.isFrozen((snapshot.value as { nested: object }).nested)).toBe(true);
    expect(Object.isFrozen((snapshot.value as { list: readonly number[] }).list)).toBe(
      true,
    );
  });

  it("measures the returned canonical representation", () => {
    const snapshot = snapshotCanonicalJson({ z: "é", a: true });

    expect(snapshot.canonical).toBe(canonicalizeJson(snapshot.value));
    expect(snapshot.utf8ByteLength).toBe(
      new TextEncoder().encode(snapshot.canonical).byteLength,
    );
  });

  it("rejects the same non-canonical values as canonicalizeJson", () => {
    expect(() => snapshotCanonicalJson({ value: Number.NaN })).toThrow();
    expect(() => snapshotCanonicalJson({ value: new Date(0) } as never)).toThrow();
  });
});
