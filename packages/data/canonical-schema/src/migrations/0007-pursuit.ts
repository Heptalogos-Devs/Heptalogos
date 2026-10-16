// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adds behavior-side Pursuit and immutable evaluation links without changing cognition or previous effects.
 * @module pursuit-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** Pursuit operations preserve exact adoption and actual evaluation history. */
export const pursuitMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `
CREATE TABLE heptalogos.pursuit (
 pursuit_id uuid PRIMARY KEY, subject_id uuid NOT NULL, activity_id uuid NOT NULL REFERENCES heptalogos.life_activity(activity_id),
 operation_id uuid NOT NULL, request_digest text NOT NULL, revision bigint NOT NULL, document jsonb NOT NULL,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, lineage_context_ref jsonb NOT NULL,
 UNIQUE(subject_id,operation_id), CHECK(revision>=1),CHECK(jsonb_typeof(document)='object')
);
CREATE INDEX pursuit_activity ON heptalogos.pursuit(subject_id,activity_id);
CREATE TABLE heptalogos.pursuit_history (
 pursuit_id uuid NOT NULL REFERENCES heptalogos.pursuit(pursuit_id),revision bigint NOT NULL,document jsonb NOT NULL,
 recorded_at timestamptz NOT NULL,PRIMARY KEY(pursuit_id,revision)
);
CREATE TABLE heptalogos.pursuit_evaluation (
 operation_id uuid PRIMARY KEY,pursuit_id uuid NOT NULL REFERENCES heptalogos.pursuit(pursuit_id),request_digest text NOT NULL,
 document jsonb NOT NULL,recorded_at timestamptz NOT NULL
);
REVOKE ALL ON heptalogos.pursuit,heptalogos.pursuit_history,heptalogos.pursuit_evaluation FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON heptalogos.pursuit TO heptalogos_runtime;
GRANT SELECT,INSERT ON heptalogos.pursuit_history,heptalogos.pursuit_evaluation TO heptalogos_runtime;`,
      )
      .execute(db);
  },
};
