// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Public Evidence contracts and service construction for retained Foundation
 * records; persistence and clock mechanics remain delegated to their owners.
 * @packageDocumentation
 */

export type {
  EvidenceDraft,
  EvidenceRecord,
  EvidenceRef,
  EvidenceService,
} from "./contracts.js";
export { createEvidenceService } from "./evidence-service.js";
