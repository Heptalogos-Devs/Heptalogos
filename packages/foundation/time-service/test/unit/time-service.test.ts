// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from "vitest";
import { parseInstant } from "@heptalogos/foundation-contracts";
import { createFakeTimeService, parseTimeZoneId } from "../../src/index.js";

describe("TimeService", () => {
  it("keeps monotonic elapsed independent from a backwards wall-clock jump", () => {
    const time = createFakeTimeService(parseInstant("2026-08-24T15:00:00.000Z")!);
    const start = time.monotonicNow();

    time.advanceMonotonic(2_000_000_000n);
    time.advanceWallClock(-60_000);

    expect(time.elapsedSince(start)).toBe(2_000_000_000n);
  });

  it("supports deterministic independent wall-clock and monotonic movement", () => {
    const time = createFakeTimeService(parseInstant("2026-08-24T15:00:00.000Z")!);

    time.advanceWallClock(1_500);
    time.advanceMonotonic(20n);

    expect(time.now()).toBe("2026-08-24T15:00:01.500Z");
    expect(time.elapsedSince(0n as ReturnType<typeof time.monotonicNow>)).toBe(20n);
  });

  it("rejects backward monotonic movement and future elapsed marks", () => {
    const time = createFakeTimeService(parseInstant("2026-08-24T15:00:00.000Z")!);
    const future = (time.monotonicNow() + 1n) as ReturnType<typeof time.monotonicNow>;

    expect(() => time.advanceMonotonic(-1n)).toThrow(RangeError);
    expect(() => time.elapsedSince(future)).toThrow(RangeError);
  });

  it("validates IANA timezone identifiers without scheduling semantics", () => {
    expect(parseTimeZoneId("Asia/Shanghai")).toBeDefined();
    expect(parseTimeZoneId("America/Los_Angeles")).toBeDefined();
    expect(parseTimeZoneId("Mars/Olympus_Mons")).toBeUndefined();
  });
});
