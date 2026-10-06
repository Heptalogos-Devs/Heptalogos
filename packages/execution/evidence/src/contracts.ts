// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the draft, retained-record, and service contracts for Foundation
 * Evidence without turning Evidence into a generic telemetry channel.
 * @module contracts
 */

import type {
  ActivityId,
  EvidenceId,
  Instant,
  RetentionClass,
  Sensitivity,
} from "@heptalogos/foundation-contracts";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";

/** Stable reference to one retained Evidence record. */
export interface EvidenceRef {
  readonly schemaVersion: 1;
  readonly evidenceId: EvidenceId;
}

/** Describes an Evidence fact before its identity and Activity are assigned. */
export interface EvidenceDraft {
  readonly evidenceKind: string;
  readonly evidenceContractVersion: string;
  readonly subjectRef?: string;
  readonly objectRef?: string;
  readonly factRef?: string;
  readonly retentionClass: RetentionClass;
  readonly sensitivity: Sensitivity;
}

/** Describes a retained Evidence record with causal and recording identity. */
export interface EvidenceRecord extends EvidenceDraft {
  readonly evidenceId: EvidenceId;
  readonly activityId: ActivityId;
  readonly recordedAt: Instant;
}

/** Persists required Evidence through a caller-owned mutation transaction. */
export interface EvidenceService {
  /** Records one draft and associates it with the transaction Activity. */
  recordRequired(
    transaction: PersistenceMutationTransactionContext,
    draft: EvidenceDraft,
  ): Promise<EvidenceRecord>;
}
