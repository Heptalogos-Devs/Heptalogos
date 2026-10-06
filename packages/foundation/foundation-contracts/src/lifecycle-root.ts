// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines the finite lifecycle-root identity vocabulary used to keep ownership
 * and shutdown lineage distinct across Foundation services.
 * @module lifecycle-root
 */

/** The complete stable set of lifecycle roots owned by Foundation storage. */
export const LIFECYCLE_ROOT_IDS = [
  "PROGRAM",
  "INSTANCE",
  "CONFIGURATION",
  "DATA",
  "SECRET",
  "BLOB",
  "BACKUP",
  "LOG",
  "CACHE",
  "TEMP",
  "RUN",
  "PACKAGE_STAGING",
] as const;

/** Identifies one lifecycle root without collapsing distinct storage owners. */
export type LifecycleRootId = (typeof LIFECYCLE_ROOT_IDS)[number];
