// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Defines shared retention and sensitivity vocabulary so data owners can state
 * governance semantics without importing storage or runtime frameworks.
 * @module data-governance
 */

/** States how long a data value is retained by its semantic owner. */
export type RetentionClass = "ephemeral" | "operational" | "retained" | "audit";

/** States the sensitivity boundary that callers must preserve. */
export type Sensitivity = "public" | "operational" | "sensitive" | "pii" | "secret";
