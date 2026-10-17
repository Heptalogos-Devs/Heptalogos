// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** A logical Subject foreground and bounded action receipts; no model-held database lock.
 * @module subject-reactor-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** History and late role results survive revocation of foreground qualification. */
export const subjectReactorMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `CREATE TABLE heptalogos.subject_foreground (
      subject_id uuid PRIMARY KEY, focus_revision bigint NOT NULL CHECK(focus_revision>=1),
      reaction_id uuid, updated_at timestamptz NOT NULL
    );
    CREATE TABLE heptalogos.subject_reaction (
      reaction_id uuid PRIMARY KEY, subject_id uuid NOT NULL,
      activity_id uuid NOT NULL REFERENCES heptalogos.life_activity(activity_id),
      document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
      created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
    );
    CREATE UNIQUE INDEX subject_reaction_run ON heptalogos.subject_reaction(subject_id,(document->>'currentRunId')) WHERE document->>'currentRunId' IS NOT NULL;
    CREATE INDEX subject_reaction_subject ON heptalogos.subject_reaction(subject_id,created_at DESC);
    CREATE TABLE heptalogos.subject_reactor_action (
      action_id uuid PRIMARY KEY, reaction_id uuid NOT NULL REFERENCES heptalogos.subject_reaction(reaction_id),
      request_digest text NOT NULL, document jsonb NOT NULL CHECK(jsonb_typeof(document)='object')
    );
    CREATE UNIQUE INDEX subject_reactor_action_step ON heptalogos.subject_reactor_action(reaction_id,(document->>'step'));
    REVOKE ALL ON heptalogos.subject_foreground,heptalogos.subject_reaction,heptalogos.subject_reactor_action FROM PUBLIC;
    GRANT SELECT,INSERT,UPDATE ON heptalogos.subject_foreground,heptalogos.subject_reaction,heptalogos.subject_reactor_action TO heptalogos_runtime;`,
      )
      .execute(db);
  },
};
