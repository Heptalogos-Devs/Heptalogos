// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Adapts platform monotonic and wall clocks to the TimeService contract without
 * allowing domain code to call ambient clock APIs directly.
 * @module system-time-service
 */

import { formatInstant } from "@heptalogos/foundation-contracts";
import type { ElapsedNanoseconds, MonotonicTick, TimeService } from "./contracts.js";

/** Create the production clock backed by platform wall and monotonic sources. */
export function createSystemTimeService(): TimeService {
  return {
    now: () => formatInstant(new Date()),
    monotonicNow: () => process.hrtime.bigint() as MonotonicTick,
    elapsedSince(start: MonotonicTick) {
      const current = process.hrtime.bigint();
      if (start > current) {
        throw new RangeError("Monotonic start cannot be in the future");
      }
      return (current - start) as ElapsedNanoseconds;
    },
  };
}
