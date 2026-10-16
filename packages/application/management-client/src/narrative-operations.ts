// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read-only narrative calls use the schema-generated shared transport.
 * @module narrative-operations
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
/** Management can inspect actual claims and receipt links; it cannot manufacture a review. */
export function createNarrativeOperations(
  request: <T>(operation: (base: Base) => Promise<{ readonly data: T }>) => Promise<T>,
) {
  return {
    claimsTo: (body: wire.ClaimsToData["body"]) =>
      request((base) => api.claimsTo({ ...base, body })),
    explainStatement: (body: wire.ExplainStatementData["body"]) =>
      request((base) => api.explainStatement({ ...base, body })),
  };
}
