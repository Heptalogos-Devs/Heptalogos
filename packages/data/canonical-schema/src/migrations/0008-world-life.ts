// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Adds first-party world state and append-only realized history. @module world-life-migration */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** World facts and operation replay are local to the Host database. */
export const worldLifeMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `
CREATE TABLE heptalogos.identity_world_actor (
 world_id uuid NOT NULL, actor_key text NOT NULL, entity_ref uuid NOT NULL UNIQUE REFERENCES heptalogos.identity_entity(entity_ref),
 PRIMARY KEY(world_id,actor_key)
);
REVOKE ALL ON heptalogos.identity_world_actor FROM PUBLIC;
GRANT SELECT,INSERT ON heptalogos.identity_world_actor TO heptalogos_runtime;
CREATE TABLE heptalogos.world_life (
 subject_id uuid NOT NULL, world_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>=1),
 time_domain_ref text NOT NULL, document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 updated_at timestamptz NOT NULL, PRIMARY KEY(subject_id,world_id)
);
CREATE TABLE heptalogos.world_life_history (
 subject_id uuid NOT NULL, world_id uuid NOT NULL, revision bigint NOT NULL,
 document jsonb NOT NULL, recorded_at timestamptz NOT NULL,
 PRIMARY KEY(subject_id,world_id,revision),
 FOREIGN KEY(subject_id,world_id) REFERENCES heptalogos.world_life(subject_id,world_id)
);
CREATE TABLE heptalogos.world_event (
 subject_id uuid NOT NULL, world_id uuid NOT NULL, event_id uuid NOT NULL,
 time_domain_ref text NOT NULL, occurred_start timestamptz NOT NULL, occurred_end timestamptz NOT NULL,
 recorded_at timestamptz NOT NULL, document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 PRIMARY KEY(subject_id,world_id,event_id), CHECK(occurred_start<occurred_end),
 FOREIGN KEY(subject_id,world_id) REFERENCES heptalogos.world_life(subject_id,world_id)
);
CREATE INDEX world_event_interval ON heptalogos.world_event(subject_id,world_id,time_domain_ref,occurred_start,occurred_end);
CREATE TABLE heptalogos.world_realization (
 subject_id uuid NOT NULL, world_id uuid NOT NULL, operation_id uuid NOT NULL,
 request_digest text NOT NULL, document jsonb NOT NULL, recorded_at timestamptz NOT NULL,
 PRIMARY KEY(subject_id,operation_id)
);
CREATE TABLE heptalogos.world_contact_release (
 subject_id uuid NOT NULL, world_id uuid NOT NULL, event_id uuid NOT NULL,
 contact_ref text NOT NULL, recorded_at timestamptz NOT NULL,
 PRIMARY KEY(subject_id,world_id,event_id),
 FOREIGN KEY(subject_id,world_id,event_id) REFERENCES heptalogos.world_event(subject_id,world_id,event_id)
);
REVOKE ALL ON heptalogos.world_life,heptalogos.world_life_history,heptalogos.world_event,heptalogos.world_realization,heptalogos.world_contact_release FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON heptalogos.world_life TO heptalogos_runtime;
GRANT SELECT,INSERT ON heptalogos.world_life_history,heptalogos.world_event,heptalogos.world_realization,heptalogos.world_contact_release TO heptalogos_runtime;
`,
      )
      .execute(db);
  },
};
