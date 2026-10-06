// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public injectable time contracts and system/fake constructors for Foundation
 * services that need deterministic elapsed and wall-clock semantics.
 * @packageDocumentation
 */

export {
  type ElapsedNanoseconds,
  type FakeTimeService,
  type MonotonicTick,
  type TimeService,
  type TimeZoneId,
} from "./contracts.js";
export { createFakeTimeService } from "./fake-time-service.js";
export { createSystemTimeService } from "./system-time-service.js";
export { parseTimeZoneId } from "./time-zone.js";
