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

import { narrativeMigration } from "./migrations/0010-narrative.js";
import { observationDomainTimeMigration } from "./migrations/0011-observation-domain-time.js";
import { roleResultsMigration } from "./migrations/0009-role-results.js";
import { subjectDecisionsMigration } from "./migrations/0012-subject-decisions.js";

import { worldHostLifecycleMigration } from "./migrations/0013-world-host-lifecycle.js";

import { worldContactSelectionMigration } from "./migrations/0014-world-contact-selection.js";

import { subjectAttentionMigration } from "./migrations/0017-subject-attention.js";

import { subjectReactorMigration } from "./migrations/0015-subject-reactor.js";

import { worldProfileLivingMigration } from "./migrations/0016-world-profile-living.js";

import { retainedResultDomainTimeMigration } from "./migrations/0018-retained-result-domain-time.js";

const migrations: Readonly<Record<string, Migration>> = Object.freeze({
  "0001_foundation_baseline": foundationBaselineMigration,
  "0002_product_gateway_prerequisites": productGatewayPrerequisitesMigration,
  "0003_product_subject_l4": productSubjectL4Migration,
  "0004_messaging_identity": messagingIdentityMigration,
  "0005_life_agency": lifeAgencyMigration,
  "0006_native_dispatch": nativeDispatchMigration,
  "0007_pursuit": pursuitMigration,
  "0008_world_life": worldLifeMigration,
  "0009_role_results": roleResultsMigration,
  "0010_narrative": narrativeMigration,
  "0011_observation_domain_time": observationDomainTimeMigration,
  "0012_subject_decisions": subjectDecisionsMigration,
  "0013_world_host_lifecycle": worldHostLifecycleMigration,
  "0014_world_contact_selection": worldContactSelectionMigration,
  "0015_subject_reactor": subjectReactorMigration,
  "0016_world_profile_living": worldProfileLivingMigration,
  "0017_subject_attention": subjectAttentionMigration,
  "0018_retained_result_domain_time": retainedResultDomainTimeMigration,
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
  "0009_role_results",
  "0010_narrative",
  "0011_observation_domain_time",
  "0012_subject_decisions",
  "0013_world_host_lifecycle",
  "0014_world_contact_selection",
  "0015_subject_reactor",
  "0016_world_profile_living",
  "0017_subject_attention",
  "0018_retained_result_domain_time",
] as const);
