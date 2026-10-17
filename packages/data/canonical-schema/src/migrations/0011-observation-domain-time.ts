// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * One-time upgrade of canonical stored ObservationInput wire envelopes.
 * @module observation-domain-time-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import {
  digestCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import type { CanonicalDatabase } from "../migration-pool.js";

type Document = { [key: string]: CanonicalJsonValue };
const object = (value: CanonicalJsonValue | undefined): value is Document =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function observation(value: CanonicalJsonValue): CanonicalJsonValue {
  if (!object(value) || !object(value.occurredTime)) return value;
  const time = value.occurredTime;
  if ("timeDomainRef" in time || "extent" in time) return value;
  // Only the canonical old protobuf TemporalExtent keys are an old wire value.
  // This does not descend into structured material, inline text or raw output.
  if (Object.keys(time).some((key) => key !== "instant" && key !== "interval"))
    return value;
  return { ...value, occurredTime: { timeDomainRef: "time:real", extent: time } };
}
function contacts(
  value: CanonicalJsonValue | undefined,
): CanonicalJsonValue | undefined {
  if (!Array.isArray(value)) return value;
  return value.map((contact) =>
    object(contact) && contact.observation !== undefined
      ? { ...contact, observation: observation(contact.observation) }
      : contact,
  );
}
function contactSnapshot(
  value: CanonicalJsonValue | undefined,
): CanonicalJsonValue | undefined {
  if (!object(value) || !Array.isArray(value.contacts)) return value;
  return { ...value, contacts: contacts(value.contacts)! };
}
function registrationDocument(value: Document): Document {
  return {
    ...value,
    ...(value.registration === undefined
      ? {}
      : { registration: contactSnapshot(value.registration)! }),
  };
}

function inputDocument(value: Document): Document {
  return {
    ...registrationDocument(value),
    ...(value.firstContact === undefined
      ? {}
      : { firstContact: contactSnapshot(value.firstContact)! }),
  };
}

/** Migrates durable SDK envelopes once; ordinary runtime decoding remains strict. */
export const observationDomainTimeMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    const inputs = await sql<{
      session_key: string;
      native_run_id: string;
      document: Document;
    }>`SELECT session_key,native_run_id,document FROM heptalogos.life_native_input WHERE document#>'{registration,contacts}' IS NOT NULL OR document#>'{firstContact,contacts}' IS NOT NULL`.execute(
      db,
    );
    for (const row of inputs.rows) {
      const upgraded = inputDocument(row.document);
      if (JSON.stringify(upgraded) !== JSON.stringify(row.document))
        await sql`UPDATE heptalogos.life_native_input SET document=${JSON.stringify(upgraded)}::jsonb WHERE session_key=${row.session_key} AND native_run_id=${row.native_run_id}`.execute(
          db,
        );
    }
    // These are exact owner copies, compared with input.registration during
    // run and handoff replay. They must receive the same structural upgrade.
    for (const [table, key] of [
      ["life_native_run", "run_id"],
      ["life_handoff", "child_session_key"],
    ] as const) {
      const copies = await sql<{
        owner_id: string;
        document: Document;
      }>`SELECT ${sql.ref(key)} AS owner_id,document FROM ${sql.table(`heptalogos.${table}`)} WHERE document#>'{registration,contacts}' IS NOT NULL`.execute(
        db,
      );
      for (const row of copies.rows) {
        const upgraded = registrationDocument(row.document);
        if (JSON.stringify(upgraded) !== JSON.stringify(row.document))
          await sql`UPDATE ${sql.table(`heptalogos.${table}`)} SET document=${JSON.stringify(upgraded)}::jsonb WHERE ${sql.ref(key)}=${row.owner_id}`.execute(
            db,
          );
      }
    }
    const prepared = await sql<{
      contact_request_id: string;
      document: Document;
    }>`SELECT contact_request_id,document FROM heptalogos.life_native_contact WHERE document#>'{response,contacts}' IS NOT NULL`.execute(
      db,
    );
    for (const row of prepared.rows) {
      const upgraded = {
        ...row.document,
        response: contactSnapshot(row.document.response)!,
      };
      if (JSON.stringify(upgraded) !== JSON.stringify(row.document))
        await sql`UPDATE heptalogos.life_native_contact SET document=${JSON.stringify(upgraded)}::jsonb WHERE contact_request_id=${row.contact_request_id}::uuid`.execute(
          db,
        );
    }
    // 0009 promotes old execution feedback into RoleRun custody before this
    // migration. Both owners persist the same canonical ObservationInput wire.
    for (const [table, key] of [
      ["cognition_pending_feedback", "request_id"],
      ["role_run_result", "result_id"],
    ] as const) {
      const rows = await sql<{
        record_id: string;
        document: Document;
      }>`SELECT ${sql.ref(key)} AS record_id,document FROM ${sql.table(`heptalogos.${table}`)} WHERE document ? 'observation'`.execute(
        db,
      );
      for (const row of rows.rows) {
        const previous = row.document.observation!;
        const upgraded = observation(previous);
        if (JSON.stringify(upgraded) === JSON.stringify(previous)) continue;
        if (!object(upgraded)) continue;
        const facts = { ...upgraded };
        delete facts.observedAt;
        delete facts.observedStamp;
        const document = {
          ...row.document,
          observation: upgraded,
          factsDigest: digestCanonicalJson("host.native-cognition.v1", facts).hex,
        };
        await sql`UPDATE ${sql.table(`heptalogos.${table}`)} SET document=${JSON.stringify(document)}::jsonb WHERE ${sql.ref(key)}=${row.record_id}::uuid`.execute(
          db,
        );
      }
    }
  },
};
