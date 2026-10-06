// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Maps Evidence service failures into shared Foundation Problem envelopes while
 * keeping database-driver details out of the public contract.
 * @module problems
 */

import {
  createProblemError,
  type Problem,
  type ProblemError,
} from "@heptalogos/foundation-contracts";

function evidenceProblem(
  problemCode: string,
  category: Problem["category"],
  title: string,
  detail: string,
): ProblemError {
  return createProblemError({
    problemCode,
    category,
    retryClass: "never",
    title,
    detail,
  });
}

/** Reports an Evidence kind outside the bounded contract. */
export function invalidEvidenceKindProblem(): ProblemError {
  return evidenceProblem(
    "evidence.invalid_kind",
    "integrity",
    "Evidence kind is invalid",
    "Evidence kind must be non-empty and at most 128 UTF-8 bytes",
  );
}

/** Reports an Evidence contract version outside the bounded contract. */
export function invalidEvidenceContractVersionProblem(): ProblemError {
  return evidenceProblem(
    "evidence.invalid_contract_version",
    "integrity",
    "Evidence contract version is invalid",
    "Evidence contract version must be non-empty and at most 128 UTF-8 bytes",
  );
}

/** Reports an Evidence reference outside the bounded UTF-8 size contract. */
export function invalidEvidenceReferenceProblem(): ProblemError {
  return evidenceProblem(
    "evidence.invalid_reference",
    "integrity",
    "Evidence reference is invalid",
    "Evidence references must be non-empty and at most 1024 UTF-8 bytes when present",
  );
}

/** Reports a required Evidence record that is not durably retained. */
export function evidenceRetentionNotDurableProblem(): ProblemError {
  return evidenceProblem(
    "evidence.retention_not_durable",
    "integrity",
    "Required Evidence retention is not durable",
    "Required Evidence cannot use ephemeral retention",
  );
}

/** Reports an Evidence write missing its retained causal Activity. */
export function evidenceActivityRequiredProblem(): ProblemError {
  return evidenceProblem(
    "evidence.persistence.activity_required",
    "integrity",
    "Required Evidence has no retained causal Activity",
    "The canonical Evidence foreign key requires the transaction Activity to be retained first",
  );
}

/** Reports a sensitivity value outside the shared Foundation vocabulary. */
export function invalidEvidenceSensitivityProblem(): ProblemError {
  return evidenceProblem(
    "evidence.invalid_sensitivity",
    "integrity",
    "Evidence sensitivity is invalid",
    "Evidence sensitivity is not a supported Foundation sensitivity value",
  );
}
