// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Adds immutable adopted Subject choices without replacing Life or native execution. @module subject-decisions-migration */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** Decision adoption and Activity mode changes share one Host transaction. */
export const subjectDecisionsMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `
CREATE TABLE heptalogos.subject_decision (
 decision_id uuid PRIMARY KEY,subject_id uuid NOT NULL,activity_id uuid NOT NULL REFERENCES heptalogos.life_activity(activity_id),
 operation_id uuid NOT NULL,source_run_id text NOT NULL,request_digest text NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),adopted_at timestamptz NOT NULL,lineage_context_ref jsonb NOT NULL,
 UNIQUE(subject_id,operation_id)
);
CREATE INDEX subject_decision_activity ON heptalogos.subject_decision(subject_id,activity_id,adopted_at,decision_id);
REVOKE ALL ON heptalogos.subject_decision FROM PUBLIC;
GRANT SELECT,INSERT ON heptalogos.subject_decision TO heptalogos_runtime;
`,
      )
      .execute(db);
  },
};
