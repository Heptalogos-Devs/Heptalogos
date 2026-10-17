// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Retains exact pre-commit rejections and completed foreground claim request identities.
 * @module subject-continuation-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** Does not change original brief facts or create delivery/cognition state. */
export const subjectContinuationMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql`CREATE TABLE heptalogos.subject_reactor_claim (
      subject_id uuid NOT NULL, request_id uuid NOT NULL, reaction_id uuid NOT NULL REFERENCES heptalogos.subject_reaction(reaction_id),
      PRIMARY KEY(subject_id,request_id)
    )`.execute(db);
    await sql`REVOKE ALL ON heptalogos.subject_reactor_claim FROM PUBLIC`.execute(db);
    await sql`GRANT SELECT,INSERT ON heptalogos.subject_reactor_claim TO heptalogos_runtime`.execute(
      db,
    );
    await sql`ALTER TABLE heptalogos.expression_brief ADD COLUMN rejection jsonb CHECK(rejection IS NULL OR jsonb_typeof(rejection)='object')`.execute(
      db,
    );
  },
};
