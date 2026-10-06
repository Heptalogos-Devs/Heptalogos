// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Supplies the single current canonical migration baseline to Kysely without
 * preserving project-development chronology as a compatibility contract.
 * @module migration-provider
 */

import type { Migration, MigrationProvider } from "kysely/migration";
import { foundationBaselineMigration } from "./migrations/0001-foundation-baseline.js";
import { productGatewayPrerequisitesMigration } from "./migrations/0002-product-gateway-prerequisites.js";
import { productSubjectL4Migration } from "./migrations/0003-product-subject-l4.js";

const migrations: Readonly<Record<string, Migration>> = Object.freeze({
  "0001_foundation_baseline": foundationBaselineMigration,
  "0002_product_gateway_prerequisites": productGatewayPrerequisitesMigration,
  "0003_product_subject_l4": productSubjectL4Migration,
});

/** Provides the current canonical migration set to Kysely's Migrator. */
export const canonicalMigrationProvider: MigrationProvider = {
  async getMigrations(): Promise<Record<string, Migration>> {
    return { ...migrations };
  },
};

/** Lists migration names in the same order as the current baseline. */
export const canonicalMigrationNames = Object.freeze([
  "0001_foundation_baseline",
  "0002_product_gateway_prerequisites",
  "0003_product_subject_l4",
] as const);
