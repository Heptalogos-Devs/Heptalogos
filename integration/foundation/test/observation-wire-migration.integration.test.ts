// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import { observationDomainTimeMigration } from "../../../packages/data/canonical-schema/src/migrations/0011-observation-domain-time.js";
import type { CanonicalDatabase } from "../../../packages/data/canonical-schema/src/migration-pool.js";
import { composeProductPersistence } from "../support/product-persistence.js";
import {
  qualifiedPgBin,
  cleanupCanonicalPostgresFixtures,
  RUNTIME_PASSWORD,
} from "../support/canonical-postgres.js";

type Document = Record<string, CanonicalJsonValue>;
const real = qualifiedPgBin ? describe : describe.skip;
afterEach(cleanupCanonicalPostgresFixtures);
real("stored ObservationInput wire migration", () => {
  it("keeps exact identities, snapshots and original results while upgrading only current wire envelopes", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "../../../packages/data/canonical-schema/test/fixtures/legacy-observation-wire.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as { observation: Document };
    const original = fixture.observation;
    const upgraded: Document = {
      ...original,
      occurredTime: { timeDomainRef: "time:real", extent: original.occurredTime! },
    };
    const c = await composeProductPersistence();
    const db = new Kysely<CanonicalDatabase>({
      dialect: new PostgresDialect({
        pool: new Pool({
          host: "127.0.0.1",
          port: c.fixture.port,
          database: "heptalogos",
          user: "heptalogos_runtime",
          password: RUNTIME_PASSWORD,
        }),
      }),
    });
    const activity = randomUUID();
    const operation = randomUUID();
    const contact = randomUUID();
    const result = randomUUID();
    const release = randomUUID();
    const request = original.requestId;
    const subject = original.subjectId;
    if (typeof request !== "string" || typeof subject !== "string")
      throw new Error("The captured SDK fixture requires exact string identities");
    const run = `run:${randomUUID()}`;
    const entry = { contactRef: "message:original", observation: original };
    const unknown = { ...original, requestId: randomUUID(), occurredTime: {} };
    const interval = {
      ...original,
      requestId: randomUUID(),
      occurredTime: {
        interval: { start: "2025-10-09T08:00:00Z", end: "2025-10-09T09:00:00Z" },
      },
    };
    const selectedContacts = [
      entry,
      { contactRef: "message:unknown", observation: unknown },
      { contactRef: "message:interval", observation: interval },
    ];
    const expectedContacts = [
      { ...entry, observation: upgraded },
      {
        contactRef: "message:unknown",
        observation: {
          ...unknown,
          occurredTime: { timeDomainRef: "time:real", extent: {} },
        },
      },
      {
        contactRef: "message:interval",
        observation: {
          ...interval,
          occurredTime: { timeDomainRef: "time:real", extent: interval.occurredTime },
        },
      },
    ];
    const registration = { contacts: selectedContacts, promptDigest: "exact-prompt" };
    const sourceText = original.inlineText;
    const raw = { occurredTime: { instant: "leave raw provider material unchanged" } };
    const input = {
      registration,
      prompt: "Original prompt with an occurredTime literal",
      dispatch: { requestId: randomUUID(), requestDigest: "exact-selection" },
      firstContact: {
        contacts: selectedContacts,
        observedAt: original.observedAt!,
        contactRequestId: contact,
        nousSessionId: "original-session",
      },
      raw,
    };
    const feedbackFacts = { ...original };
    delete feedbackFacts.observedAt;
    const pending = {
      observation: original,
      identity: { nativeRun: run },
      factsDigest: digestCanonicalJson("host.native-cognition.v1", feedbackFacts).hex,
      raw,
    };
    try {
      await sql`INSERT INTO heptalogos.life_activity(activity_id,subject_id,operation_id,request_digest,revision,document,created_at,updated_at,lineage_context_ref) VALUES(${activity}::uuid,${subject}::uuid,${operation}::uuid,'exact-activity',1,'{}',now(),now(),'{}')`.execute(
        db,
      );
      await sql`INSERT INTO heptalogos.life_native_run(run_id,subject_id,activity_id,session_key,role,prompt_digest,state,document,recorded_at,updated_at) VALUES(${run},${subject}::uuid,${activity}::uuid,'original-session','main','exact-prompt','completed',${JSON.stringify({ registration, native: raw })}::jsonb,now(),now())`.execute(
        db,
      );
      await sql`INSERT INTO heptalogos.life_native_input(session_key,native_run_id,prompt_digest,subject_id,activity_id,document,recorded_at) VALUES('original-session',${run},'exact-prompt',${subject}::uuid,${activity}::uuid,${JSON.stringify(input)}::jsonb,now())`.execute(
        db,
      );
      await sql`INSERT INTO heptalogos.life_handoff(child_session_key,parent_run_id,activity_id,document,recorded_at) VALUES('original-child',${run},${activity}::uuid,${JSON.stringify({ registration, request: raw })}::jsonb,now())`.execute(
        db,
      );
      await sql`INSERT INTO heptalogos.life_native_contact(contact_request_id,subject_id,run_id,invocation_id,request_digest,document,recorded_at) VALUES(${contact}::uuid,${subject}::uuid,${run},'original-invocation','exact-request',${JSON.stringify({ response: { contacts: selectedContacts }, admitted: raw })}::jsonb,now())`.execute(
        db,
      );
      await sql`INSERT INTO heptalogos.cognition_pending_feedback(request_id,subject_id,run_id,document,receipt,recorded_at,delivered_at) VALUES(${request}::uuid,${subject}::uuid,${run},${JSON.stringify(pending)}::jsonb,'{"occurrenceId":"exact-original-receipt"}',now(),now())`.execute(
        db,
      );
      await sql`INSERT INTO heptalogos.role_run_result(result_id,subject_id,run_id,document,recorded_at) VALUES(${result}::uuid,${subject}::uuid,${run},${JSON.stringify({ observation: original, providerRaw: raw })}::jsonb,now())`.execute(
        db,
      );
      await sql`INSERT INTO heptalogos.role_result_release(request_id,subject_id,child_run_id,document,recorded_at) VALUES(${release}::uuid,${subject}::uuid,${run},${JSON.stringify({ response: { contacts: [entry] }, raw })}::jsonb,now())`.execute(
        db,
      );
      const currentId = randomUUID();
      const current = {
        observation: upgraded,
        factsDigest: "current-digest-is-not-a-migration-target",
      };
      await sql`INSERT INTO heptalogos.cognition_pending_feedback(request_id,subject_id,run_id,document,recorded_at) VALUES(${currentId}::uuid,${subject}::uuid,${run},${JSON.stringify(current)}::jsonb,now())`.execute(
        db,
      );
      await db
        .transaction()
        .execute(async (tx) => observationDomainTimeMigration.up(tx));
      const storedInput = (
        await sql<{
          document: Document;
          prompt_digest: string;
        }>`SELECT document,prompt_digest FROM heptalogos.life_native_input`.execute(db)
      ).rows[0]!;
      expect(storedInput).toEqual({
        document: {
          ...input,
          registration: {
            ...registration,
            contacts: expectedContacts,
          },
          firstContact: {
            ...input.firstContact,
            contacts: expectedContacts,
          },
        },
        prompt_digest: "exact-prompt",
      });
      for (const [table, field] of [
        ["life_native_run", "registration"],
        ["life_handoff", "registration"],
        ["life_native_contact", "response"],
      ] as const) {
        const stored = (
          await sql<{
            value: { contacts: { observation: Document }[] };
          }>`SELECT document->${field} AS value FROM ${sql.table(`heptalogos.${table}`)}`.execute(
            db,
          )
        ).rows[0]!.value;
        expect(stored.contacts).toEqual(expectedContacts);
        expect(stored.contacts[0]?.observation).toEqual(upgraded);
        expect(stored.contacts[0]?.observation.inlineText).toEqual(sourceText);
        expect(stored.contacts[0]?.observation).not.toHaveProperty("observedStamp");
      }
      const saved = (
        await sql<{
          request_id: string;
          document: Document;
          receipt: Document;
        }>`SELECT request_id,document,receipt FROM heptalogos.cognition_pending_feedback WHERE request_id=${request}::uuid`.execute(
          db,
        )
      ).rows[0]!;
      const facts: Document = { ...upgraded };
      delete facts.observedAt;
      expect(saved).toEqual({
        request_id: request,
        document: {
          ...pending,
          observation: upgraded,
          factsDigest: digestCanonicalJson("host.native-cognition.v1", facts).hex,
        },
        receipt: { occurrenceId: "exact-original-receipt" },
      });
      expect(
        (
          await sql<{
            document: Document;
          }>`SELECT document FROM heptalogos.cognition_pending_feedback WHERE request_id=${currentId}::uuid`.execute(
            db,
          )
        ).rows[0]!.document,
      ).toEqual(current);
      expect(
        (
          await sql<{
            document: Document;
          }>`SELECT document FROM heptalogos.role_run_result`.execute(db)
        ).rows[0]!.document,
      ).toEqual({ observation: original, providerRaw: raw });
      expect(
        (
          await sql<{
            document: Document;
          }>`SELECT document FROM heptalogos.role_result_release`.execute(db)
        ).rows[0]!.document,
      ).toEqual({ response: { contacts: [entry] }, raw });
      const before = await sql<{
        snapshot: string;
      }>`SELECT md5(string_agg(document::text,'' ORDER BY request_id)) AS snapshot FROM heptalogos.cognition_pending_feedback`.execute(
        db,
      );
      await db
        .transaction()
        .execute(async (tx) => observationDomainTimeMigration.up(tx));
      expect(
        (
          await sql<{
            snapshot: string;
          }>`SELECT md5(string_agg(document::text,'' ORDER BY request_id)) AS snapshot FROM heptalogos.cognition_pending_feedback`.execute(
            db,
          )
        ).rows,
      ).toEqual(before.rows);
      expect(
        (
          await sql<{
            request_digest: string;
          }>`SELECT request_digest FROM heptalogos.life_native_contact`.execute(db)
        ).rows[0]!.request_digest,
      ).toBe("exact-request");
    } finally {
      await db.destroy();
      await c.close();
    }
  });
});
