// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Claims share the existing Host transaction and sender facts. @module narrative-migration */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** Preserves briefs, expressions and actual future undertakings. */
export const narrativeMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `
CREATE TABLE heptalogos.expression_brief (
 brief_id uuid PRIMARY KEY, subject_id uuid NOT NULL, activity_id uuid NOT NULL REFERENCES heptalogos.life_activity(activity_id),
 renderer_run_id text NOT NULL UNIQUE, request_digest text NOT NULL, document jsonb NOT NULL, recorded_at timestamptz NOT NULL
);
CREATE TABLE heptalogos.narrative_commit (
 operation_id uuid PRIMARY KEY, brief_id uuid NOT NULL REFERENCES heptalogos.expression_brief(brief_id),
 subject_id uuid NOT NULL, behavior_id uuid NOT NULL REFERENCES heptalogos.agency_behavior(behavior_id),
 request_digest text NOT NULL, document jsonb NOT NULL, recorded_at timestamptz NOT NULL, UNIQUE(brief_id,behavior_id)
);
CREATE TABLE heptalogos.narrative_claim (
 claim_id uuid PRIMARY KEY, subject_id uuid NOT NULL, brief_id uuid NOT NULL REFERENCES heptalogos.expression_brief(brief_id),
 behavior_id uuid NOT NULL REFERENCES heptalogos.agency_behavior(behavior_id), conversation_ref text NOT NULL,
 source_index integer NOT NULL, about_domain text, about_start timestamptz, about_end timestamptz,
 document jsonb NOT NULL, recorded_at timestamptz NOT NULL
);
CREATE INDEX narrative_claim_audience ON heptalogos.narrative_claim(subject_id,conversation_ref,claim_id);
CREATE INDEX narrative_claim_time ON heptalogos.narrative_claim(subject_id,about_domain,about_start,about_end);
CREATE TABLE heptalogos.agency_commitment (
 commitment_id uuid PRIMARY KEY, subject_id uuid NOT NULL, activity_id uuid NOT NULL REFERENCES heptalogos.life_activity(activity_id),
 claim_id uuid NOT NULL REFERENCES heptalogos.narrative_claim(claim_id), due_domain text NOT NULL, due_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','completed','cancelled')), document jsonb NOT NULL, recorded_at timestamptz NOT NULL
);
CREATE INDEX agency_commitment_due ON heptalogos.agency_commitment(subject_id,due_domain,due_at) WHERE state='pending';
REVOKE ALL ON heptalogos.expression_brief,heptalogos.narrative_commit,heptalogos.narrative_claim,heptalogos.agency_commitment FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON heptalogos.expression_brief,heptalogos.narrative_commit,heptalogos.narrative_claim,heptalogos.agency_commitment TO heptalogos_runtime;
`,
      )
      .execute(db);
  },
};
