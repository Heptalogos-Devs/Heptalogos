// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public execution-lineage contracts, providers, persistence adapters, and
 * handoff projections for causal Foundation context propagation.
 * @packageDocumentation
 */

export {
  type ActivityImportance,
  type ActivityCompletion,
  type ActivityLink,
  type ActivityRequest,
  type ActivityTelemetryCorrelation,
  type ExecutionContext,
  type ExecutionContextRuntime,
  type HostExecutionOrigin,
  type LineageContextRef,
  type LineageContextRefV1,
} from "./contracts.js";
export { createExecutionContextRuntime } from "./execution-context-runtime.js";
export {
  decodeLineageContextRef,
  encodeLineageContextRef,
  lineageContextRefSchema,
} from "./lineage-context-ref.js";
export { createPersistenceExecutionContextProvider } from "./persistence-adapter.js";
export { createExecutionLineageService } from "./activity-repository.js";
export {
  projectBootstrapHandoff,
  type BootstrapHandoffProjection,
  type BootstrapHandoffProjectionInput,
  type BootstrapHandoffStatus,
  type BootstrapJournalCheckpointLike,
} from "./bootstrap-handoff.js";
export type {
  BootstrapRetainedActivityDraft,
  ExecutionLineageService,
} from "./contracts.js";
