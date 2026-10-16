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

import { messagingIdentityMigration } from "./migrations/0004-messaging-identity.js";

import { lifeAgencyMigration } from "./migrations/0005-life-agency.js";

import { nativeDispatchMigration } from "./migrations/0006-native-dispatch.js";

import { pursuitMigration } from "./migrations/0007-pursuit.js";

import { worldLifeMigration } from "./migrations/0008-world-life.js";

const migrations: Readonly<Record<string, Migration>> = Object.freeze({
  "0001_foundation_baseline": foundationBaselineMigration,
  "0002_product_gateway_prerequisites": productGatewayPrerequisitesMigration,
  "0003_product_subject_l4": productSubjectL4Migration,
  "0004_messaging_identity": messagingIdentityMigration,
  "0005_life_agency": lifeAgencyMigration,
  "0006_native_dispatch": nativeDispatchMigration,
  "0007_pursuit": pursuitMigration,
  "0008_world_life": worldLifeMigration,
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
  "0004_messaging_identity",
  "0005_life_agency",
  "0006_native_dispatch",
  "0007_pursuit",
  "0008_world_life",
] as const);
