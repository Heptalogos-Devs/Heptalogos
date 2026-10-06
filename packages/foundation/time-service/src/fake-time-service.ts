// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Implements deterministic fake time for tests while preserving the same
 * monotonic-versus-wall-clock distinctions as the system service.
 * @module fake-time-service
 */

import {
  formatInstant,
  parseInstant,
  type Instant,
} from "@heptalogos/foundation-contracts";
import type {
  ElapsedNanoseconds,
  FakeTimeService,
  MonotonicTick,
} from "./contracts.js";

/** Create an independently controlled clock for deterministic time-sensitive tests. */
export function createFakeTimeService(
  initialWallClock: Instant,
  initialMonotonic: bigint = 0n,
): FakeTimeService {
  const initialMilliseconds = Date.parse(initialWallClock);
  if (!parseInstant(initialWallClock) || !Number.isFinite(initialMilliseconds)) {
    throw new RangeError("Fake wall clock must be a canonical Instant");
  }
  if (initialMonotonic < 0n) {
    throw new RangeError("Fake monotonic clock cannot start before zero");
  }

  let wallClockMilliseconds = initialMilliseconds;
  let monotonicNanoseconds = initialMonotonic;

  return {
    now: () => formatInstant(new Date(wallClockMilliseconds)),
    monotonicNow: () => monotonicNanoseconds as MonotonicTick,
    elapsedSince(start: MonotonicTick) {
      if (start > monotonicNanoseconds) {
        throw new RangeError("Monotonic start cannot be in the future");
      }
      return (monotonicNanoseconds - start) as ElapsedNanoseconds;
    },
    setWallClock(value: Instant) {
      const milliseconds = Date.parse(value);
      if (!parseInstant(value) || !Number.isFinite(milliseconds)) {
        throw new RangeError("Fake wall clock must be a canonical Instant");
      }
      wallClockMilliseconds = milliseconds;
    },
    advanceWallClock(milliseconds: number) {
      if (!Number.isFinite(milliseconds) || !Number.isInteger(milliseconds)) {
        throw new RangeError("Wall clock delta must be a finite integer");
      }
      wallClockMilliseconds += milliseconds;
      formatInstant(new Date(wallClockMilliseconds));
    },
    advanceMonotonic(nanoseconds: bigint) {
      if (nanoseconds < 0n) {
        throw new RangeError("Monotonic clock cannot move backward");
      }
      monotonicNanoseconds += nanoseconds;
    },
  };
}
