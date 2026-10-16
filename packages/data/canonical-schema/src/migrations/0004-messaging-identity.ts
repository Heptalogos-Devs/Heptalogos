// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Evolves the existing recorder in place and preserves every legacy message.
 * @module messaging-identity-migration
 */
import { sql, type Kysely } from "kysely";
import type { Migration } from "kysely/migration";
import type { CanonicalDatabase } from "../migration-pool.js";

/** Adds multi-account native facts, pending material work and Host identity. */
export const messagingIdentityMigration: Migration = {
  async up(db: Kysely<CanonicalDatabase>): Promise<void> {
    await sql
      .raw(
        `
ALTER TABLE heptalogos.messaging_conversation
  DROP CONSTRAINT messaging_conversation_installation_id_key,
  DROP CONSTRAINT messaging_conversation_platform_check,
  ALTER administrator_id DROP NOT NULL,
  ALTER administrator_account_id DROP NOT NULL,
  ALTER subject_id DROP NOT NULL,
  ALTER subject_account_id DROP NOT NULL,
  ADD COLUMN native_account_id text,
  ADD COLUMN native_conversation_id text,
  ADD COLUMN conversation_kind text;
UPDATE heptalogos.messaging_conversation SET
 native_account_id = subject_account_id::text,
 native_conversation_id = conversation_id::text,
 conversation_kind = 'direct';
ALTER TABLE heptalogos.messaging_conversation
 ALTER native_account_id SET NOT NULL,
 ALTER native_conversation_id SET NOT NULL,
 ALTER conversation_kind SET NOT NULL,
 ADD CONSTRAINT messaging_conversation_native_unique UNIQUE(platform_id,native_account_id,conversation_kind,native_conversation_id),
 ADD CONSTRAINT messaging_conversation_kind_check CHECK(conversation_kind IN ('direct','group'));
ALTER TABLE heptalogos.message_fact
 DROP CONSTRAINT message_fact_direction_fields_check,
 ALTER sender_kind DROP NOT NULL,
 ALTER sender_account_id DROP NOT NULL,
 ALTER recipient_kind DROP NOT NULL,
 ALTER recipient_account_id DROP NOT NULL,
 ALTER text DROP NOT NULL,
 ADD COLUMN native_message_id text,
 ADD COLUMN document jsonb,
 ADD COLUMN lifecycle text NOT NULL DEFAULT 'present';
UPDATE heptalogos.message_fact m SET
 native_message_id = COALESCE(client_message_id,caused_by_communication_commit_id::text,message_id::text),
 document = jsonb_build_object(
  'schemaVersion',1,'kind','message','messageId',m.message_id::text,'conversationId',m.conversation_id::text,'sequence',m.sequence,
  'conversation',jsonb_build_object('platform',c.platform_id,'accountId',c.native_account_id,'conversationId',c.native_conversation_id,'kind',c.conversation_kind),
  'nativeMessageId',COALESCE(m.client_message_id,m.caused_by_communication_commit_id::text,m.message_id::text),
  'direction',m.direction,'author',jsonb_build_object('accountId',m.sender_account_id::text),
  'platformSentAt',NULL,'receivedAt',to_char(m.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'parts',jsonb_build_array(jsonb_build_object('kind','text','text',m.text)),
  'references','[]'::jsonb,'sourceEnvelopeRef','legacy:message:'||m.message_id::text,'lineageContextRef',m.lineage_context_ref
 )
FROM heptalogos.messaging_conversation c WHERE c.conversation_id=m.conversation_id;
ALTER TABLE heptalogos.message_fact
 ALTER native_message_id SET NOT NULL,
 ALTER document SET NOT NULL,
 ADD CONSTRAINT message_fact_native_unique UNIQUE(conversation_id,native_message_id),
 ADD CONSTRAINT message_fact_lifecycle_check CHECK(lifecycle IN ('present','retracted'));
CREATE TABLE heptalogos.messaging_platform_event(
 event_id uuid PRIMARY KEY, conversation_id uuid NOT NULL REFERENCES heptalogos.messaging_conversation(conversation_id),
 event_key text NOT NULL, event_type text NOT NULL, target_native_message_id text,
 effect text NOT NULL CHECK(effect IN ('none','retract')), document jsonb NOT NULL,
 lineage_context_ref jsonb NOT NULL, received_at timestamptz NOT NULL,
 UNIQUE(conversation_id,event_key)
);
CREATE INDEX messaging_event_target ON heptalogos.messaging_platform_event(conversation_id,target_native_message_id) WHERE effect='retract';
CREATE TABLE heptalogos.messaging_pending(
 pending_id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('message','event')), fact_id uuid NOT NULL,
 conversation_id uuid NOT NULL REFERENCES heptalogos.messaging_conversation(conversation_id),
 completed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(kind,fact_id)
);
CREATE INDEX messaging_pending_open ON heptalogos.messaging_pending(created_at,pending_id) WHERE NOT completed;
CREATE TABLE heptalogos.message_attachment(
 attachment_id uuid PRIMARY KEY, message_id uuid NOT NULL REFERENCES heptalogos.message_fact(message_id),
 part_index integer NOT NULL CHECK(part_index>=0), node_path text NOT NULL DEFAULT '', state text NOT NULL,
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), document jsonb NOT NULL,
 UNIQUE(message_id,node_path,part_index), CHECK(state IN ('pending','acquiring','available','failed','expired','retracted'))
);
CREATE TABLE heptalogos.message_reference(
 reference_id uuid PRIMARY KEY, message_id uuid NOT NULL REFERENCES heptalogos.message_fact(message_id),
 ordinal integer NOT NULL CHECK(ordinal>=0), state text NOT NULL, revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 document jsonb NOT NULL, UNIQUE(message_id,ordinal), CHECK(state IN ('pending','available','partial','unavailable'))
);
CREATE TABLE heptalogos.message_contact(
 subject_id text NOT NULL, message_id uuid NOT NULL REFERENCES heptalogos.message_fact(message_id),
 contact_id text NOT NULL, observed_at timestamptz NOT NULL, lineage_context_ref jsonb NOT NULL,
 PRIMARY KEY(subject_id,message_id,contact_id)
);
CREATE TABLE heptalogos.identity_entity(
 entity_ref uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('person','group','subject')), created_at timestamptz NOT NULL DEFAULT now(), lineage_context_ref jsonb NOT NULL
);
CREATE TABLE heptalogos.identity_external_key(
 platform text NOT NULL, kind text NOT NULL CHECK(kind IN ('account','uid','group')),
 native_id text NOT NULL, entity_ref uuid NOT NULL REFERENCES heptalogos.identity_entity(entity_ref),
 PRIMARY KEY(platform,kind,native_id)
);
CREATE TABLE heptalogos.identity_subject(
 subject_id text PRIMARY KEY, entity_ref uuid NOT NULL UNIQUE REFERENCES heptalogos.identity_entity(entity_ref)
);
REVOKE ALL ON heptalogos.messaging_platform_event,heptalogos.messaging_pending,heptalogos.message_attachment,heptalogos.message_reference,heptalogos.message_contact,heptalogos.identity_entity,heptalogos.identity_external_key,heptalogos.identity_subject FROM PUBLIC;
GRANT UPDATE(lifecycle) ON heptalogos.message_fact TO heptalogos_runtime;
GRANT SELECT,INSERT,UPDATE ON heptalogos.messaging_platform_event,heptalogos.messaging_pending,heptalogos.message_attachment,heptalogos.message_reference TO heptalogos_runtime;
GRANT SELECT,INSERT ON heptalogos.message_contact,heptalogos.identity_entity,heptalogos.identity_external_key,heptalogos.identity_subject TO heptalogos_runtime;
`,
      )
      .execute(db);
  },
};
