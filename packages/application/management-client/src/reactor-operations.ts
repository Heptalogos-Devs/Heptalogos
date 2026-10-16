// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Actual Reactor reads and native opportunity projection through generated transport.
 * @module reactor-operations
 */
import * as api from "./generated/index.js";
import type * as wire from "./generated/types.gen.js";
import type { createClient } from "./generated/client/index.js";
type Base = {
  readonly client: ReturnType<typeof createClient>;
  readonly throwOnError: true;
  readonly responseStyle: "fields";
  readonly signal?: AbortSignal;
};
/** These operations never fabricate an admitted decision or completed effect. */
export function createReactorOperations(
  request: <T>(operation: (base: Base) => Promise<{ readonly data: T }>) => Promise<T>,
) {
  return {
    reactorStatus: (body: wire.ReactorStatusData["body"]) =>
      request((base) => api.reactorStatus({ ...base, body })),
    reactorHistory: (body: wire.ReactorHistoryData["body"]) =>
      request((base) => api.reactorHistory({ ...base, body })),
    reactorAttentionExplain: (body: wire.ReactorAttentionExplainData["body"]) =>
      request((base) => api.reactorAttentionExplain({ ...base, body })),
    reactorWake: (body: wire.ReactorWakeData["body"]) =>
      request((base) => api.reactorWake({ ...base, body })),
  };
}
