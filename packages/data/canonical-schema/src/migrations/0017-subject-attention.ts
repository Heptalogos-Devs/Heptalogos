// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Retains source consideration and actual policy explanations without copying source bodies.
 * @module subject-attention-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** Source progress does not complete unread message or world handoff work. */
export const subjectAttentionMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `CREATE TABLE heptalogos.attention_source_position(subject_id uuid NOT NULL,source_key text NOT NULL,document jsonb NOT NULL,considered_at timestamptz NOT NULL,PRIMARY KEY(subject_id,source_key));
CREATE TABLE heptalogos.attention_selection(selection_id uuid PRIMARY KEY,subject_id uuid NOT NULL,document jsonb NOT NULL,recorded_at timestamptz NOT NULL);
CREATE INDEX attention_selection_subject ON heptalogos.attention_selection(subject_id,recorded_at DESC);
REVOKE ALL ON heptalogos.attention_source_position,heptalogos.attention_selection FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON heptalogos.attention_source_position,heptalogos.attention_selection TO heptalogos_runtime;`,
      )
      .execute(db);
  },
};
