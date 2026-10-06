// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public EffectOperation contracts and service construction; persistence,
 * lineage, and adapter mechanics remain behind their owning boundaries.
 * @packageDocumentation
 */

export type {
  EffectDispatchPort,
  EffectDispatchResult,
  EffectOperation,
  EffectOperationService,
  EffectOperationState,
  EffectOutcome,
  EffectPreparationRequest,
  EffectPreparationResult,
  EffectReconciliationResult,
} from "./contracts.js";
export type { EffectKindId, EffectOperationId } from "@heptalogos/foundation-contracts";
export {
  createEffectOperationService,
  type EffectOperationServiceOptions,
} from "./service.js";
