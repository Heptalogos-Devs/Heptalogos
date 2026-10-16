// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared cuts for already domain-filtered realized intervals.
 * @module world-interval-boundaries
 */
import type { RealizedWorldEvent } from "./world-contracts.js";
/** Preserve every actual overlap boundary and in-range policy change exactly once. */
export function worldIntervalBoundaries(
  start: number,
  end: number,
  events: readonly Pick<RealizedWorldEvent, "interval">[],
  policyChanges: readonly number[] = [],
): number[] {
  const cuts = new Set([start, end]);
  for (const at of policyChanges) if (at > start && at < end) cuts.add(at);
  for (const { interval } of events) {
    cuts.add(Math.max(start, Date.parse(interval.start)));
    cuts.add(Math.min(end, Date.parse(interval.end)));
  }
  return [...cuts].sort((a, b) => a - b);
}
