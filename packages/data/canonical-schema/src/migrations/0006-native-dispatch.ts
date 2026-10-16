// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Adds idempotency to existing native input facts without rewriting saved state.
 * @module native-dispatch-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";
/** One trusted request can consume only one native dispatch opportunity. */
export const nativeDispatchMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        "CREATE UNIQUE INDEX life_native_dispatch_run ON heptalogos.life_native_input(native_run_id) WHERE document ? 'dispatch'; CREATE UNIQUE INDEX life_native_dispatch_request ON heptalogos.life_native_input(subject_id,(document#>>'{dispatch,requestId}')) WHERE document ? 'dispatch'",
      )
      .execute(db);
  },
};
