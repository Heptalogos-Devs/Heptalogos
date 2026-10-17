// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Binds schema-generated Pursuit operations to the existing authenticated/discovered gateway request owner.
 * @module pursuit-operations
 */
import * as api from "./generated/index.js";
import type * as wire from "./generated/types.gen.js";
import type { GatewayOperationRequest } from "./gateway-operation.js";
/** Extends the one Gateway client without copying DTOs, authentication or endpoint discovery. */
export function createPursuitOperations(request: GatewayOperationRequest) {
  return {
    listPursuits: (body: wire.ListPursuitsData["body"]) =>
      request((base) => api.listPursuits({ ...base, body })),
    pursuitHistory: (body: wire.PursuitHistoryData["body"]) =>
      request((base) => api.pursuitHistory({ ...base, body })),
    adoptPursuit: (body: wire.AdoptPursuitData["body"]) =>
      request((base) => api.adoptPursuit({ ...base, body })),
    readPursuit: (body: wire.ReadPursuitData["body"]) =>
      request((base) => api.readPursuit({ ...base, body })),
    recheckPursuit: (body: wire.RecheckPursuitData["body"]) =>
      request((base) => api.recheckPursuit({ ...base, body })),
    transitionPursuit: (body: wire.TransitionPursuitData["body"]) =>
      request((base) => api.transitionPursuit({ ...base, body })),
    reconsiderPursuit: (body: wire.ReconsiderPursuitData["body"]) =>
      request((base) => api.reconsiderPursuit({ ...base, body })),
    evaluatePursuit: (body: wire.EvaluatePursuitData["body"]) =>
      request((base) => api.evaluatePursuit({ ...base, body })),
  };
}
