// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Separates exclusive world handoff selection from actual Subject perception.
 * @module world-contact-selection-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** Existing receipts remain released; new selected rows have one stable actual run owner. */
export const worldContactSelectionMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `ALTER TABLE heptalogos.world_contact_release
      ADD COLUMN state text NOT NULL DEFAULT 'released' CHECK(state IN ('selected','released')),
      ADD COLUMN selected_run_id text,
      ADD CONSTRAINT world_contact_selected_owner CHECK(state='released' OR (selected_run_id IS NOT NULL AND length(selected_run_id)>0));
      GRANT UPDATE ON heptalogos.world_contact_release TO heptalogos_runtime;`,
      )
      .execute(db);
  },
};
