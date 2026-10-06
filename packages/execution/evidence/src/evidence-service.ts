// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persists and reads retained Evidence through the caller's persistence and
 * time authorities, preserving sensitivity and lineage semantics at the seam.
 * @module evidence-service
 */

import { createEvidenceId } from "@heptalogos/foundation-contracts";
import {
  executeRepositorySql,
  type PersistenceInternalTransaction,
  useRepositoryMutationTransaction,
} from "@heptalogos/persistence/repository";
import type { EvidenceDraft, EvidenceRecord, EvidenceService } from "./contracts.js";
import {
  evidenceActivityRequiredProblem,
  evidenceRetentionNotDurableProblem,
  invalidEvidenceContractVersionProblem,
  invalidEvidenceKindProblem,
  invalidEvidenceReferenceProblem,
  invalidEvidenceSensitivityProblem,
} from "./problems.js";
import type { TimeService } from "@heptalogos/time-service";

// Intentional duplication: Evidence and execution-lineage validate parallel
// governance fields under different owner contracts and failure semantics.
/* jscpd:ignore-start */
const retentionValues = new Set(["operational", "retained", "audit"]);
const sensitivityValues = new Set([
  "public",
  "operational",
  "sensitive",
  "pii",
  "secret",
]);

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function validBounded(value: string, maximumBytes: number): boolean {
  return value.trim().length > 0 && utf8Length(value) <= maximumBytes;
}
/* jscpd:ignore-end */

function validateDraft(draft: EvidenceDraft): void {
  if (!validBounded(draft.evidenceKind, 128)) {
    throw invalidEvidenceKindProblem();
  }
  if (!validBounded(draft.evidenceContractVersion, 128)) {
    throw invalidEvidenceContractVersionProblem();
  }
  for (const reference of [draft.subjectRef, draft.objectRef, draft.factRef]) {
    if (reference !== undefined && !validBounded(reference, 1024)) {
      throw invalidEvidenceReferenceProblem();
    }
  }
  if (!retentionValues.has(draft.retentionClass)) {
    throw evidenceRetentionNotDurableProblem();
  }
  if (!sensitivityValues.has(draft.sensitivity)) {
    throw invalidEvidenceSensitivityProblem();
  }
}

async function executeSql(
  transaction: PersistenceInternalTransaction,
  text: string,
  parameters: readonly unknown[],
): Promise<void> {
  try {
    await executeRepositorySql(transaction, text, parameters);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23503"
    ) {
      throw evidenceActivityRequiredProblem();
    }
    throw error;
  }
}

/** Creates the Evidence service bound to the caller's injectable time source. */
export function createEvidenceService(time: TimeService): EvidenceService {
  return {
    async recordRequired(transaction, draft): Promise<EvidenceRecord> {
      validateDraft(draft);
      const evidenceId = createEvidenceId();
      const recordedAt = time.now();
      await useRepositoryMutationTransaction(
        transaction,
        async (databaseTransaction) => {
          await executeSql(
            databaseTransaction,
            `INSERT INTO "heptalogos"."evidence_record" (
            evidence_id, activity_id, evidence_kind, evidence_contract_version,
            recorded_at, subject_ref, object_ref, fact_ref, retention_class,
            sensitivity
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              evidenceId,
              transaction.execution.activityId,
              draft.evidenceKind,
              draft.evidenceContractVersion,
              recordedAt,
              draft.subjectRef ?? null,
              draft.objectRef ?? null,
              draft.factRef ?? null,
              draft.retentionClass,
              draft.sensitivity,
            ],
          );
        },
      );
      return Object.freeze({
        ...draft,
        evidenceId,
        activityId: transaction.execution.activityId,
        recordedAt,
      });
    },
  };
}
