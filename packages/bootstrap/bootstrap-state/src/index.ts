// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public BootstrapState contracts for versioned envelopes, journals, witnesses,
 * codecs, and crash-safe stores; file and serialization mechanics stay owned
 * by their internal modules.
 * @packageDocumentation
 */

export {
  BOOTSTRAP_STATE_DIGEST_DOMAIN,
  parseBootstrapState,
  sealBootstrapState,
} from "./codec.js";
export type {
  BootstrapRuntimeGenerationId,
  BootstrapStateBody,
  BootstrapStateBodyV1,
  BootstrapStateEnvelope,
  BootstrapStateEnvelopeV1,
  BootstrapStateParseResult,
  PrivatePostgresBootstrapStateV1,
  PrivatePostgresInitializationProfileRevision,
  ProductGenerationId,
} from "./model.js";
export { BootstrapStateStore } from "./store.js";
export type { BootstrapStateLoadResult } from "./store.js";
export { BootstrapJournal, createBootstrapJournalCheckpoint } from "./journal.js";
export type {
  BootId,
  BootstrapActivityId,
  BootstrapJournalCheckpointV1,
  BootstrapJournalCheckpoint,
  BootstrapStageOutcome,
} from "./journal.js";
export {
  MAINTENANCE_JOURNAL_DIGEST_DOMAIN,
  canonicalMaintenanceJournalText,
  createMaintenanceOperationId,
  maintenanceOperationRef,
  parseMaintenanceJournal,
  sealMaintenanceJournal,
} from "./maintenance/codec.js";
export type {
  MaintenanceJournalBodyV1,
  MaintenanceJournalEnvelopeV1,
  MaintenanceJournalParseResult,
  MaintenanceOperationId,
  MaintenanceActivityId,
  MaintenanceOperationType,
  MaintenancePhase,
} from "./maintenance/model.js";
export { MaintenanceJournalStore } from "./maintenance/store.js";
export type { MaintenanceJournalLoadResult } from "./maintenance/model.js";
export {
  BOOTSTRAP_OWNER_WITNESS_DIGEST_DOMAIN,
  canonicalBootstrapOwnerWitnessText,
  parseBootstrapOwnerWitness,
  sealBootstrapOwnerWitness,
} from "./bootstrap-owner-witness-codec.js";
export { BootstrapOwnerWitnessStore } from "./bootstrap-owner-witness-store.js";
export type {
  BootstrapLockGenerationId,
  BootstrapOwnerWitnessBodyV1,
  BootstrapOwnerWitnessEnvelopeV1,
  BootstrapOwnerWitnessParseResult,
} from "./bootstrap-owner-witness-model.js";
export { createBootstrapLockGenerationId } from "./bootstrap-owner-witness-model.js";
