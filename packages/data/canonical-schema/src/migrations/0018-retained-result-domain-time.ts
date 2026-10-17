// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Repairs retained results in installations that already applied the original 0011.
 * @module retained-result-domain-time-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import type { CanonicalDatabase } from "../migration-pool.js";

type RetainedDocument = Record<string, CanonicalJsonValue> & {
  observation: Record<string, CanonicalJsonValue>;
};
/** Only the original TemporalExtent envelope receives its implicit real domain. */
export const retainedResultDomainTimeMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    const retained = await sql<{ result_id: string; document: RetainedDocument }>`
      SELECT result_id,document FROM heptalogos.role_run_result
      WHERE jsonb_typeof(document#>'{observation,occurredTime}')='object'
      AND NOT (document#>'{observation,occurredTime}' ?| ARRAY['timeDomainRef','extent'])
    `.execute(db);
    for (const row of retained.rows) {
      const extent = row.document.observation.occurredTime;
      if (!extent || typeof extent !== "object" || Array.isArray(extent)) continue;
      const keys = Object.keys(extent);
      if (
        keys.length > 1 ||
        keys.some((key) => key !== "instant" && key !== "interval")
      )
        continue;
      const observation = {
        ...row.document.observation,
        occurredTime: { timeDomainRef: "time:real", extent },
      };
      const facts = Object.fromEntries(
        Object.entries(observation).filter(
          ([key]) => key !== "observedAt" && key !== "observedStamp",
        ),
      );
      const corrected = {
        ...row.document,
        observation,
        factsDigest: digestCanonicalJson("host.native-cognition.v1", facts).hex,
      };
      await sql`UPDATE heptalogos.role_run_result SET document=${JSON.stringify(corrected)}::jsonb WHERE result_id=${row.result_id}::uuid`.execute(
        db,
      );
    }
  },
};
