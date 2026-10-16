// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Schema-generated world operations share the existing authenticated gateway client.
 * @module world-operations
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
/** Every wire DTO is generated from the world owner; there is no second HTTP transport. */
export function createWorldOperations(
  request: <T>(operation: (base: Base) => Promise<{ readonly data: T }>) => Promise<T>,
) {
  return {
    worldCalendarRead: (body: wire.WorldCalendarReadData["body"]) =>
      request((base) => api.worldCalendarRead({ ...base, body })),
    worldCalendarChange: (body: wire.WorldCalendarChangeData["body"]) =>
      request((base) => api.worldCalendarChange({ ...base, body })),
    worldProfileAdopt: (body: wire.WorldProfileAdoptData["body"]) =>
      request((base) => api.worldProfileAdopt({ ...base, body })),
    worldProfileRead: (body: wire.WorldProfileReadData["body"]) =>
      request((base) => api.worldProfileRead({ ...base, body })),
    worldLiving: (body: wire.WorldLivingData["body"]) =>
      request((base) => api.worldLiving({ ...base, body })),
    worldClockRead: (body: wire.WorldClockReadData["body"]) =>
      request((base) => api.worldClockRead({ ...base, body })),
    worldClockConfigure: (body: wire.WorldClockConfigureData["body"]) =>
      request((base) => api.worldClockConfigure({ ...base, body })),
    worldConfigure: (body: wire.WorldConfigureData["body"]) =>
      request((base) => api.worldConfigure({ ...base, body })),
    worldRead: (body: wire.WorldReadData["body"]) =>
      request((base) => api.worldRead({ ...base, body })),
    worldPrepare: (body: wire.WorldPrepareData["body"]) =>
      request((base) => api.worldPrepare({ ...base, body })),
    worldRealize: (body: wire.WorldRealizeData["body"]) =>
      request((base) => api.worldRealize({ ...base, body })),
    worldAdvanceRules: (body: wire.WorldAdvanceRulesData["body"]) =>
      request((base) => api.worldAdvanceRules({ ...base, body })),
    worldQuery: (body: wire.WorldQueryData["body"]) =>
      request((base) => api.worldQuery({ ...base, body })),
    worldHistory: (body: wire.WorldHistoryData["body"]) =>
      request((base) => api.worldHistory({ ...base, body })),
    worldCoverage: (body: wire.WorldCoverageData["body"]) =>
      request((base) => api.worldCoverage({ ...base, body })),
    worldActorResolve: (body: wire.WorldActorResolveData["body"]) =>
      request((base) => api.worldActorResolve({ ...base, body })),
    worldActors: (body: wire.WorldActorsData["body"]) =>
      request((base) => api.worldActors({ ...base, body })),
    advanceWorldOpportunity: (body: wire.AdvanceWorldOpportunityData["body"]) =>
      request((base) => api.advanceWorldOpportunity({ ...base, body })),
  };
}
