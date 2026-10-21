// Adapted from subject-clock.rs and Hept world-host-runtime.ts/world-lifecycle.ts.
// Copyright 2026 Aravine Zhu; SPDX-License-Identifier: AGPL-3.0-only
import { addMicros, micros, scaleMicros } from "@nous-wave/platform/time";
import type {
  ClockChangeReceipt,
  ClockOfflinePolicy,
} from "@nous-wave/contracts/time";
/** A confirmed Host stop owns only its exact current revision; operator pause stays paused. */
export function recoverClock(input: {
  point: string;
  realAt: string;
  wall: string;
  onlineRate: string;
  currentRate: string;
  policy: ClockOfflinePolicy;
  status: string;
  latest?: ClockChangeReceipt;
}) {
  const hostOwned =
    input.latest?.snapshot &&
    "segment" in input.latest.snapshot &&
    input.latest.snapshot.segment.reason === "host_stop";
  const paused = input.status === "paused" && !hostOwned;
  const elapsed = micros(input.wall) - micros(input.realAt);
  const rate =
    input.policy.mode === "elapsed" && !paused ? input.policy.offlineRate : "0";
  const point = addMicros(
    input.point,
    scaleMicros(elapsed > 0n ? elapsed : 0n, rate),
  );
  return {
    point,
    rate: paused ? "0" : input.onlineRate,
    gap: hostOwned ? null : "shutdown_point_unknown",
    status: hostOwned ? ("resumed" as const) : ("recovered" as const),
  };
}
