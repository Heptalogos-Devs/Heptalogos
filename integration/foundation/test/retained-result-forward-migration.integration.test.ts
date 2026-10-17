// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "kysely";
import { createCanonicalSchemaInitializer } from "@heptalogos/canonical-schema";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { createMigrationDatabase } from "../../../packages/data/canonical-schema/src/migration-pool.js";
import {
  boot,
  makeFixture,
  stopManagedHostWithoutRuntime,
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
  CANONICAL_OPTIONS,
} from "../support/canonical-postgres.js";

type Document = Record<string, CanonicalJsonValue>;
type Copy = { identity: Document; observation: Document; factsDigest: string };
type Row = {
  result_id: string;
  retained: Copy;
  historical: Copy;
  receipt: Document;
  delivered_at: string;
};
const metadataUrl = new URL(
  "../../../packages/application/product-host/node_modules/@nous-wave/client/package.json",
  import.meta.url,
);
const metadata = JSON.parse(await readFile(metadataUrl, "utf8"));
const sdk = await import(
  new URL(metadata.exports["./host-bridge"].import, metadataUrl).href
);
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("forward retained result time migration", () => {
  it("repairs all eight committed-copy envelopes after 0011 without changing historical facts or receipts", async () => {
    const { rows } = JSON.parse(
      await readFile(
        new URL(
          "../../../packages/data/canonical-schema/test/fixtures/retained-result-forward-wire.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { rows: Row[] };
    expect(rows).toHaveLength(8);
    const fixture = await makeFixture();
    const initialize = createCanonicalSchemaInitializer(CANONICAL_OPTIONS);
    const activity = randomUUID(),
      operation = randomUUID();
    const first = rows[0]!;
    const subject = String(first.retained.observation.subjectId);
    const native = first.retained.identity.native as Document;
    const run = String(native.runId);
    const untouched = [
      {
        ...first.retained,
        observation: {
          ...first.historical.observation,
          requestId: randomUUID(),
          occurredTime: {
            timeDomainRef: "time:known-world",
            extent: { instant: "2026-10-16T06:50:39.200Z" },
          },
          observedStamp: {
            timeDomainRef: "time:known-world",
            at: "2026-10-16T06:50:39.200Z",
            recordedAt: "2026-10-16T06:50:40Z",
          },
        },
        factsDigest: "existing-domain-digest",
      },
      {
        ...first.retained,
        observation: {
          ...first.retained.observation,
          requestId: randomUUID(),
          occurredTime: { futureCoordinate: "unchanged-unknown-wire" },
        },
        factsDigest: "unsupported-wire-digest",
      },
    ];
    const started = await boot(fixture, async (context) => {
      await initialize(context);
      let database = createMigrationDatabase(context.authority, CANONICAL_OPTIONS);
      try {
        await database.db.transaction().execute(async (tx) => {
          // 0018 is data-only. Restore the actual already-0011/0017 ledger and
          // captured old RoleRun/new committed-copy shape in this isolated DB.
          await sql`DELETE FROM heptalogos.foundation_schema_migration WHERE name='0018_retained_result_domain_time'`.execute(
            tx,
          );
          await sql`INSERT INTO heptalogos.life_activity(activity_id,subject_id,operation_id,request_digest,revision,document,created_at,updated_at,lineage_context_ref) VALUES(${activity}::uuid,${subject}::uuid,${operation}::uuid,'retained-task',6,'{"state":"paused"}',now(),now(),'{}')`.execute(
            tx,
          );
          await sql`INSERT INTO heptalogos.life_native_run(run_id,subject_id,activity_id,session_key,role,prompt_digest,state,document,recorded_at,updated_at) VALUES(${run},${subject}::uuid,${activity}::uuid,${String(native.sessionKey)},'worker','retained-paid-prompt','uncertain',${JSON.stringify({ native, registration: { role: "worker", providerPolicyState: "unconfigured" } })}::jsonb,now(),now())`.execute(
            tx,
          );
          for (const document of untouched)
            await sql`INSERT INTO heptalogos.role_run_result(result_id,subject_id,run_id,document,recorded_at) VALUES(${String(document.observation.requestId)}::uuid,${subject}::uuid,${run},${JSON.stringify(document)}::jsonb,now())`.execute(
              tx,
            );
          for (const row of rows) {
            expect(() =>
              sdk.decodeObservationInput(row.retained.observation),
            ).toThrow();
            expect(
              sdk.decodeObservationInput(row.historical.observation).occurredTime
                .timeDomainRef,
            ).toBe("time:real");
            await sql`INSERT INTO heptalogos.role_run_result(result_id,subject_id,run_id,document,recorded_at) VALUES(${row.result_id}::uuid,${subject}::uuid,${run},${JSON.stringify(row.retained)}::jsonb,now())`.execute(
              tx,
            );
            await sql`INSERT INTO heptalogos.cognition_pending_feedback(request_id,subject_id,run_id,document,receipt,recorded_at,delivered_at) VALUES(${row.result_id}::uuid,${subject}::uuid,${run},${JSON.stringify(row.historical)}::jsonb,${JSON.stringify(row.receipt)}::jsonb,now(),${row.delivered_at}::timestamptz)`.execute(
              tx,
            );
          }
        });
        const before = (
          await sql<{
            name: string;
          }>`SELECT name FROM heptalogos.foundation_schema_migration ORDER BY name`.execute(
            database.db,
          )
        ).rows;
        expect(before.map((x) => x.name)).toContain("0011_observation_domain_time");
        expect(before).toHaveLength(17);
        const readCopies = async () =>
          (
            await sql<{
              result_id: string;
              document: Copy;
              historical: Copy;
              receipt: Document;
              delivered_at: Date;
              recorded_at: Date;
            }>`SELECT r.result_id,r.document,p.document AS historical,p.receipt,p.delivered_at,r.recorded_at FROM heptalogos.role_run_result r JOIN heptalogos.cognition_pending_feedback p ON p.request_id=r.result_id ORDER BY r.result_id`.execute(
              database.db,
            )
          ).rows;
        const old = await readCopies();
        await database.close();
        await initialize(context);
        database = createMigrationDatabase(context.authority, CANONICAL_OPTIONS);
        const migrated = await readCopies();
        expect(migrated).toHaveLength(8);
        for (const row of migrated) {
          const original = old.find((x) => x.result_id === row.result_id)!;
          const observation = row.document.observation;
          expect(
            sdk.decodeObservationInput(observation).occurredTime.timeDomainRef,
          ).toBe("time:real");
          expect(row.document.identity).toEqual(original.document.identity);
          expect({
            ...row.document,
            observation: original.document.observation,
            factsDigest: original.document.factsDigest,
          }).toEqual(original.document);
          expect(observation).toEqual(original.historical.observation);
          expect({ ...row, document: original.document }).toEqual(original);
          expect((observation.context as Document).cognition_usage).toEqual(
            (original.document.observation.context as Document).cognition_usage,
          );
          const facts = Object.fromEntries(
            Object.entries(observation).filter(
              ([key]) => !["observedAt", "observedStamp"].includes(key),
            ),
          );
          expect(row.document.factsDigest).toBe(
            digestCanonicalJson("host.native-cognition.v1", facts).hex,
          );
          expect(sdk.decodeAcceptedObservation(row.receipt).occurrenceId).toBeTruthy();
        }
        await database.close();
        await initialize(context);
        database = createMigrationDatabase(context.authority, CANONICAL_OPTIONS);
        expect(await readCopies()).toEqual(migrated);
        const controls = (
          await sql<{
            document: unknown;
          }>`SELECT document FROM heptalogos.role_run_result WHERE result_id=ANY(${untouched.map((x) => String(x.observation.requestId))}::uuid[])`.execute(
            database.db,
          )
        ).rows;
        expect(controls.map((x) => x.document)).toEqual(
          expect.arrayContaining(untouched),
        );
        const ledger = (
          await sql<{
            name: string;
          }>`SELECT name FROM heptalogos.foundation_schema_migration ORDER BY name`.execute(
            database.db,
          )
        ).rows;
        expect(ledger).toHaveLength(18);
        expect(ledger.at(-1)?.name).toBe("0018_retained_result_domain_time");
        expect(
          (
            await sql<{
              state: string;
            }>`SELECT state FROM heptalogos.life_native_run WHERE run_id=${run}`.execute(
              database.db,
            )
          ).rows[0]?.state,
        ).toBe("uncertain");
      } finally {
        await database.close();
      }
    });
    await stopManagedHostWithoutRuntime(started.host);
  }, 120000);
});
