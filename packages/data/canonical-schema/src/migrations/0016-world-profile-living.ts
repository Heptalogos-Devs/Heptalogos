// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Adds adopted WorldProfile, interval-derived living state and pending semantic world actions.
 * @module world-profile-living-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** All records belong to the existing WorldLife owner and fenced Host database. */
export const worldProfileLivingMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `
ALTER TABLE heptalogos.world_contact_release ADD COLUMN selection_history jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE heptalogos.world_profile(subject_id uuid NOT NULL,world_id uuid NOT NULL,revision bigint NOT NULL,document jsonb NOT NULL,lineage_context_ref jsonb NOT NULL,PRIMARY KEY(subject_id,world_id),FOREIGN KEY(subject_id,world_id) REFERENCES heptalogos.world_life(subject_id,world_id));
CREATE TABLE heptalogos.world_profile_history(subject_id uuid NOT NULL,world_id uuid NOT NULL,revision bigint NOT NULL,document jsonb NOT NULL,recorded_at timestamptz NOT NULL,effective_at timestamptz NOT NULL,PRIMARY KEY(subject_id,world_id,revision));
CREATE INDEX world_profile_effective ON heptalogos.world_profile_history(subject_id,world_id,effective_at,revision);
CREATE TABLE heptalogos.world_living(subject_id uuid NOT NULL,world_id uuid NOT NULL,document jsonb NOT NULL,PRIMARY KEY(subject_id,world_id),FOREIGN KEY(subject_id,world_id) REFERENCES heptalogos.world_profile(subject_id,world_id));
CREATE TABLE heptalogos.world_living_history(subject_id uuid NOT NULL,world_id uuid NOT NULL,revision bigint NOT NULL,integrated_through timestamptz NOT NULL,document jsonb NOT NULL,PRIMARY KEY(subject_id,world_id,revision));
CREATE INDEX world_living_history_cut ON heptalogos.world_living_history(subject_id,world_id,integrated_through,revision);
CREATE TABLE heptalogos.world_action(subject_id uuid NOT NULL,world_id uuid NOT NULL,action_id uuid NOT NULL,operation_id uuid NOT NULL,request_digest text NOT NULL,state text NOT NULL,ends_at timestamptz NOT NULL,document jsonb NOT NULL,PRIMARY KEY(subject_id,action_id),UNIQUE(subject_id,operation_id));
CREATE INDEX world_action_due ON heptalogos.world_action(subject_id,world_id,state,ends_at,action_id);
REVOKE ALL ON heptalogos.world_profile,heptalogos.world_profile_history,heptalogos.world_living,heptalogos.world_living_history,heptalogos.world_action FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON heptalogos.world_profile,heptalogos.world_living,heptalogos.world_action TO heptalogos_runtime;
GRANT SELECT,INSERT ON heptalogos.world_profile_history,heptalogos.world_living_history TO heptalogos_runtime;
`,
      )
      .execute(db);
  },
};
