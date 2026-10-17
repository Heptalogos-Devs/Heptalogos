// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Retains only the current actual Host clock pause obligation.
 * @module world-host-lifecycle-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** Adds the current Host pause receipt to the canonical owner. */
export const worldHostLifecycleMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `CREATE TABLE heptalogos.world_host_lifecycle (
      subject_id uuid PRIMARY KEY, document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'), lineage_context_ref jsonb NOT NULL
    );
    REVOKE ALL ON heptalogos.world_host_lifecycle FROM PUBLIC;
    GRANT SELECT,INSERT,UPDATE ON heptalogos.world_host_lifecycle TO heptalogos_runtime;`,
      )
      .execute(db);
  },
};
