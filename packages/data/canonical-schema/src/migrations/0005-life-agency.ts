// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Adds Product activities and adopted behavior facts without replacing existing messages or cognition.
 * @module life-agency-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";

/** Creates the current Life/Agency owned records; external send retry remains native OpenClaw's responsibility. */
export const lifeAgencyMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `
CREATE TABLE heptalogos.life_activity (
 activity_id uuid PRIMARY KEY, subject_id uuid NOT NULL, operation_id uuid NOT NULL,
 request_digest text NOT NULL, revision bigint NOT NULL CHECK(revision>=1), document jsonb NOT NULL,
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, lineage_context_ref jsonb NOT NULL,
 UNIQUE(subject_id,operation_id), CHECK(jsonb_typeof(document)='object')
);
CREATE INDEX life_activity_subject ON heptalogos.life_activity(subject_id,activity_id);
CREATE INDEX life_activity_current ON heptalogos.life_activity(subject_id,(document->>'state'));
CREATE TABLE heptalogos.life_native_run (
 run_id text PRIMARY KEY, subject_id uuid NOT NULL, activity_id uuid NOT NULL REFERENCES heptalogos.life_activity(activity_id),
 session_key text NOT NULL, session_id text, parent_session_key text, role text NOT NULL CHECK(role IN ('main','worker')),
 prompt_digest text, state text NOT NULL CHECK(state IN ('admitted','running','completed','cancelled','failed','uncertain')),
 document jsonb NOT NULL, recorded_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX life_run_session ON heptalogos.life_native_run(session_key,updated_at DESC);
CREATE TABLE heptalogos.life_native_route (
 account_id text NOT NULL, conversation_kind text NOT NULL, conversation_id text NOT NULL,
 subject_id uuid NOT NULL, configuration_revision text NOT NULL, document jsonb NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(account_id,conversation_kind,conversation_id)
);
CREATE TABLE heptalogos.life_native_input (
 session_key text NOT NULL, native_run_id text NOT NULL, prompt_digest text NOT NULL, subject_id uuid NOT NULL,
 activity_id uuid NOT NULL REFERENCES heptalogos.life_activity(activity_id),
 document jsonb NOT NULL, recorded_at timestamptz NOT NULL,
 PRIMARY KEY(session_key,native_run_id)
);
CREATE TABLE heptalogos.life_native_contact (
 contact_request_id uuid PRIMARY KEY, subject_id uuid NOT NULL,
 run_id text NOT NULL REFERENCES heptalogos.life_native_run(run_id), invocation_id text NOT NULL,
 request_digest text NOT NULL, document jsonb NOT NULL, recorded_at timestamptz NOT NULL,
 UNIQUE(run_id,invocation_id)
);

CREATE TABLE heptalogos.life_handoff (
 child_session_key text PRIMARY KEY, parent_run_id text NOT NULL REFERENCES heptalogos.life_native_run(run_id),
 activity_id uuid NOT NULL REFERENCES heptalogos.life_activity(activity_id), document jsonb NOT NULL, recorded_at timestamptz NOT NULL
);
CREATE TABLE heptalogos.agency_behavior (
 behavior_id uuid PRIMARY KEY, subject_id uuid NOT NULL, activity_id uuid NOT NULL REFERENCES heptalogos.life_activity(activity_id),
 run_id text NOT NULL REFERENCES heptalogos.life_native_run(run_id), native_intent_id text NOT NULL UNIQUE,
 request_digest text NOT NULL, document jsonb NOT NULL, recorded_at timestamptz NOT NULL
);
CREATE TABLE heptalogos.agency_delivery_part (
 behavior_id uuid NOT NULL REFERENCES heptalogos.agency_behavior(behavior_id), source_index integer NOT NULL,
 part_index integer NOT NULL, state text NOT NULL CHECK(state IN ('not_sent','dispatching','accepted','failed','uncertain')),
 document jsonb NOT NULL, updated_at timestamptz NOT NULL,
 PRIMARY KEY(behavior_id,source_index,part_index)
);
CREATE TABLE heptalogos.cognition_pending_feedback (
 request_id uuid PRIMARY KEY, subject_id uuid NOT NULL, run_id text NOT NULL,
 document jsonb NOT NULL, receipt jsonb, recorded_at timestamptz NOT NULL, delivered_at timestamptz
);
CREATE INDEX cognition_feedback_pending ON heptalogos.cognition_pending_feedback(recorded_at) WHERE delivered_at IS NULL;
REVOKE ALL ON heptalogos.life_activity,heptalogos.life_native_run,heptalogos.life_native_route,heptalogos.life_native_input,heptalogos.life_native_contact,heptalogos.life_handoff,heptalogos.agency_behavior,heptalogos.agency_delivery_part,heptalogos.cognition_pending_feedback FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON heptalogos.life_activity,heptalogos.life_native_run,heptalogos.life_native_route,heptalogos.life_native_input,heptalogos.life_native_contact,heptalogos.life_handoff,heptalogos.agency_behavior,heptalogos.agency_delivery_part,heptalogos.cognition_pending_feedback TO heptalogos_runtime;
`,
      )
      .execute(db);
  },
};
