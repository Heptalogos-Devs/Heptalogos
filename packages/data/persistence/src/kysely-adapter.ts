// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Adapts Kysely transactions to the persistence-owned connection lifecycle;
 * callers receive typed transaction contracts rather than dialect objects.
 * @module kysely-adapter
 */

import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";

type InternalDatabase = Record<string, Record<string, unknown>>;
/** Names the package-private database adapter type used by persistence. */
export type PersistenceDatabase = Kysely<InternalDatabase>;

/** Creates the Kysely adapter over the persistence-owned PostgreSQL pool. */
export function createKyselyAdapter(pool: Pool): PersistenceDatabase {
  return new Kysely({
    dialect: new PostgresDialect({ pool }),
  });
}
