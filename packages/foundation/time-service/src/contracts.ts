// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines injectable monotonic, wall-clock, and timezone contracts so runtime
 * semantics do not depend on ambient process clocks.
 * @module contracts
 */

import type { Branded, Instant } from "@heptalogos/foundation-contracts";

/** Opaque monotonic-clock reading used for duration calculations. */
export type MonotonicTick = Branded<bigint, "MonotonicTick">;
/** Opaque non-negative duration measured in nanoseconds. */
export type ElapsedNanoseconds = Branded<bigint, "ElapsedNanoseconds">;
/** Opaque IANA timezone identifier accepted by the platform formatter. */
export type TimeZoneId = Branded<string, "TimeZoneId">;

/** Supplies wall-clock, monotonic, and elapsed-time operations to domain code. */
export interface TimeService {
  /** Return the current canonical wall-clock instant. */
  now(): Instant;
  /** Return a monotonic reading suitable for ordering durations. */
  monotonicNow(): MonotonicTick;
  /** Measure elapsed monotonic time from a prior reading. */
  elapsedSince(start: MonotonicTick): ElapsedNanoseconds;
}

/** Deterministic clock controls exposed by the test implementation. */
export interface FakeTimeService extends TimeService {
  /** Replace the fake wall clock without changing monotonic time. */
  setWallClock(value: Instant): void;
  /** Advance wall-clock time by an integral millisecond delta. */
  advanceWallClock(milliseconds: number): void;
  /** Advance monotonic time by a non-negative nanosecond delta. */
  advanceMonotonic(nanoseconds: bigint): void;
}
