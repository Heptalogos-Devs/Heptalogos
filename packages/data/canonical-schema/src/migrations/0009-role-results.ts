// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Execution-only result custody and explicit bounded Subject release. @module role-results-migration */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
export const roleResultsMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `CREATE TABLE heptalogos.role_run_result (
      result_id uuid PRIMARY KEY, subject_id uuid NOT NULL, run_id text NOT NULL REFERENCES heptalogos.life_native_run(run_id),
      document jsonb NOT NULL, recorded_at timestamptz NOT NULL);
      CREATE INDEX role_run_result_run ON heptalogos.role_run_result(run_id,recorded_at);
      CREATE TABLE heptalogos.role_result_release (
      request_id uuid PRIMARY KEY, subject_id uuid NOT NULL, child_run_id text NOT NULL REFERENCES heptalogos.life_native_run(run_id),
      document jsonb NOT NULL, recorded_at timestamptz NOT NULL);
      REVOKE ALL ON heptalogos.role_run_result,heptalogos.role_result_release FROM PUBLIC;
      GRANT SELECT,INSERT,UPDATE ON heptalogos.role_run_result,heptalogos.role_result_release TO heptalogos_runtime;`,
      )
      .execute(db);
    const scope = (role: string) =>
      `CASE WHEN ${role}='worker' THEN '{"role":"subject.execution","purpose":"professional_execution","view":"worker","contactNature":"execution_only"}'::jsonb ELSE '{"role":"subject.deliberation","purpose":"subject_deliberation","view":"subject","contactNature":"subject_experience"}'::jsonb END`;
    for (const table of ["life_native_input", "life_native_run", "life_handoff"]) {
      await sql
        .raw(
          `UPDATE heptalogos.${table} SET document=jsonb_set(document,'{registration,roleScope}',${scope("document#>>'{registration,role}'")}) WHERE document#>'{registration,roleScope}' IS NULL`,
        )
        .execute(db);
    }
    await sql
      .raw(
        `UPDATE heptalogos.life_handoff SET document=jsonb_set(document,'{request,childNativeAgentId}',document#>'{registration,nativeAgentId}') WHERE document#>'{request,childNativeAgentId}' IS NULL`,
      )
      .execute(db);
    await sql
      .raw(
        `UPDATE heptalogos.life_native_contact c SET document=jsonb_set(c.document,'{response,roleScope}',${scope("r.role")}) FROM heptalogos.life_native_run r WHERE c.run_id=r.run_id AND c.document#>'{response,roleScope}' IS NULL`,
      )
      .execute(db);
    await sql
      .raw(
        `INSERT INTO heptalogos.role_run_result(result_id,subject_id,run_id,document,recorded_at) SELECT f.request_id,f.subject_id,f.run_id,f.document,f.recorded_at FROM heptalogos.cognition_pending_feedback f JOIN heptalogos.life_native_run r ON r.run_id=f.run_id WHERE r.role='worker' ON CONFLICT DO NOTHING;
      DELETE FROM heptalogos.cognition_pending_feedback f USING heptalogos.life_native_run r WHERE r.run_id=f.run_id AND r.role='worker' AND f.receipt IS NULL;`,
      )
      .execute(db);
  },
};
