// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Owns Messaging persistence rows, codecs, and SQL mechanics.
 * @module repository
 */

import {
  formatInstant,
  parseInstant,
  parseMessagingPlatformId,
  parseUuidV7Id,
  type CanonicalConversationId,
  type Instant,
} from "@heptalogos/foundation-contracts";
import type { LineageContextRef } from "@heptalogos/execution-lineage";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import { executeRepositorySql } from "@heptalogos/persistence/repository";
import {
  SUBJECT_CHAT_PLATFORM_ID,
  type MessageDirection,
  type MessageFact,
  type MessagingActorKind,
  type MessagingConversation,
} from "./contracts.js";
import { messagingProblem } from "./problems.js";

/** Represents one raw canonical messaging conversation database row. */
interface ConversationRow {
  readonly conversation_id: unknown;
  readonly installation_id: unknown;
  readonly platform_id: unknown;
  readonly administrator_id: unknown;
  readonly administrator_account_id: unknown;
  readonly subject_id: unknown;
  readonly subject_account_id: unknown;
  readonly last_sequence: unknown;
  readonly created_at: unknown;
  readonly lineage_context_ref: unknown;
}

/** Represents one raw canonical MessageFact database row. */
interface MessageRow {
  readonly message_id: unknown;
  readonly conversation_id: unknown;
  readonly sequence: unknown;
  readonly direction: unknown;
  readonly sender_kind: unknown;
  readonly sender_account_id: unknown;
  readonly recipient_kind: unknown;
  readonly recipient_account_id: unknown;
  readonly text: unknown;
  readonly client_message_id: unknown;
  readonly accepted_input_digest: unknown;
  readonly caused_by_communication_commit_id: unknown;
  readonly created_at: unknown;
  readonly lineage_context_ref: unknown;
}

/** Represents the raw singleton Administrator lookup row. */
interface AdministratorRow {
  readonly administrator_id: unknown;
}

/** Select list for canonical MessageFact persistence reads. */
const MESSAGE_COLUMNS =
  "message_id, conversation_id, sequence, direction, sender_kind, " +
  "sender_account_id, recipient_kind, recipient_account_id, text, " +
  "client_message_id, accepted_input_digest, caused_by_communication_commit_id, " +
  "created_at, lineage_context_ref";

/** Select list for canonical conversation persistence reads. */
const CONVERSATION_COLUMNS =
  "conversation_id, installation_id, platform_id, administrator_id, " +
  "administrator_account_id, subject_id, subject_account_id, last_sequence, " +
  "created_at, lineage_context_ref";

function jsonValue(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw messagingProblem(
      "messaging.repository_invalid",
      "Messaging repository data is invalid",
      field + " is not valid JSON",
      "integrity",
      "manual",
    );
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  const parsed = jsonValue(value, field);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw messagingProblem(
      "messaging.repository_invalid",
      "Messaging repository data is invalid",
      field + " must be an object",
      "integrity",
      "manual",
    );
  }
  return parsed as Record<string, unknown>;
}

function instant(value: unknown, field: string): Instant {
  const parsed = parseInstant(value instanceof Date ? formatInstant(value) : value);
  if (parsed === undefined) {
    throw messagingProblem(
      "messaging.repository_invalid",
      "Messaging repository data is invalid",
      field + " is not a canonical Instant",
      "integrity",
      "manual",
    );
  }
  return parsed;
}

function integer(value: unknown, field: string, minimum: number): number {
  const parsed =
    typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw messagingProblem(
      "messaging.repository_invalid",
      "Messaging repository data is invalid",
      field + " is not a valid bounded integer",
      "integrity",
      "manual",
    );
  }
  return parsed;
}

function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw messagingProblem(
      "messaging.repository_invalid",
      "Messaging repository data is invalid",
      field + " must be non-empty text",
      "integrity",
      "manual",
    );
  }
  if (new TextEncoder().encode(value).byteLength > maximum) {
    throw messagingProblem(
      "messaging.repository_invalid",
      "Messaging repository data is invalid",
      field + " exceeds its current byte bound",
      "integrity",
      "manual",
    );
  }
  return value;
}

function uuid<T extends string>(brand: T, value: unknown, field: string) {
  const parsed = parseUuidV7Id(brand, value);
  if (parsed === undefined) {
    throw messagingProblem(
      "messaging.repository_invalid",
      "Messaging repository data is invalid",
      field + " is not a UUIDv7 identifier",
      "integrity",
      "manual",
    );
  }
  return parsed;
}

function lineage(value: unknown, field: string): LineageContextRef {
  const parsed = object(value, field);
  if (
    parsed.schemaVersion !== 1 ||
    parseUuidV7Id("ActivityId", parsed.sourceActivityId) === undefined ||
    parseUuidV7Id("InstanceId", parsed.sourceInstanceId) === undefined ||
    parseUuidV7Id("ContinuityEpochId", parsed.sourceContinuityEpochId) === undefined
  ) {
    throw messagingProblem(
      "messaging.repository_invalid",
      "Messaging repository data is invalid",
      field + " is not a valid LineageContextRef",
      "integrity",
      "manual",
    );
  }
  return Object.freeze(parsed as unknown as LineageContextRef);
}

function rowConversation(row: ConversationRow): MessagingConversation {
  const platformId = parseMessagingPlatformId(row.platform_id);
  if (platformId !== SUBJECT_CHAT_PLATFORM_ID) {
    throw messagingProblem(
      "messaging.repository_invalid",
      "Messaging repository data is invalid",
      "The canonical conversation is not the current Subject Chat platform",
      "integrity",
      "manual",
    );
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    conversationId: uuid(
      "CanonicalConversationId",
      row.conversation_id,
      "conversation_id",
    ),
    installationId: uuid("InstallationId", row.installation_id, "installation_id"),
    platformId: SUBJECT_CHAT_PLATFORM_ID,
    administratorId: uuid("AdministratorId", row.administrator_id, "administrator_id"),
    administratorAccountId: uuid(
      "MessagingAccountId",
      row.administrator_account_id,
      "administrator_account_id",
    ),
    subjectId: uuid("SubjectId", row.subject_id, "subject_id"),
    subjectAccountId: uuid(
      "MessagingAccountId",
      row.subject_account_id,
      "subject_account_id",
    ),
    lastSequence: integer(row.last_sequence, "last_sequence", 0),
    createdAt: instant(row.created_at, "created_at"),
    lineageContextRef: lineage(row.lineage_context_ref, "lineage_context_ref"),
  });
}

function rowMessage(row: MessageRow): MessageFact {
  const direction = row.direction;
  const senderKind = row.sender_kind;
  const recipientKind = row.recipient_kind;
  if (
    (direction !== "INBOUND" && direction !== "OUTBOUND") ||
    (senderKind !== "ADMINISTRATOR" && senderKind !== "SUBJECT") ||
    (recipientKind !== "ADMINISTRATOR" && recipientKind !== "SUBJECT")
  ) {
    throw messagingProblem(
      "messaging.repository_invalid",
      "Messaging repository data is invalid",
      "The canonical MessageFact direction or actor kind is invalid",
      "integrity",
      "manual",
    );
  }
  const clientMessageId = row.client_message_id;
  const acceptedInputDigest = row.accepted_input_digest;
  const communicationCommitId = row.caused_by_communication_commit_id;
  return Object.freeze({
    schemaVersion: 1 as const,
    messageId: uuid("CanonicalMessageId", row.message_id, "message_id"),
    conversationId: uuid(
      "CanonicalConversationId",
      row.conversation_id,
      "conversation_id",
    ),
    sequence: integer(row.sequence, "sequence", 1),
    direction: direction as MessageDirection,
    senderKind: senderKind as MessagingActorKind,
    senderAccountId: uuid(
      "MessagingAccountId",
      row.sender_account_id,
      "sender_account_id",
    ),
    recipientKind: recipientKind as MessagingActorKind,
    recipientAccountId: uuid(
      "MessagingAccountId",
      row.recipient_account_id,
      "recipient_account_id",
    ),
    text: text(row.text, "text", 65_536),
    ...(clientMessageId === null || clientMessageId === undefined
      ? {}
      : { clientMessageId: text(clientMessageId, "client_message_id", 256) }),
    ...(acceptedInputDigest === null || acceptedInputDigest === undefined
      ? {}
      : {
          acceptedInputDigest: text(acceptedInputDigest, "accepted_input_digest", 64),
        }),
    ...(communicationCommitId === null || communicationCommitId === undefined
      ? {}
      : {
          causedByCommunicationCommitId: uuid(
            "CommunicationCommitId",
            communicationCommitId,
            "caused_by_communication_commit_id",
          ),
        }),
    createdAt: instant(row.created_at, "created_at"),
    lineageContextRef: lineage(row.lineage_context_ref, "lineage_context_ref"),
  });
}

/** Serializes the current execution lineage reference for persistence. */
export function canonicalLineage(execution: {
  /** Creates the current lineage reference owned by Execution Lineage. */
  createLineageContextRef(): LineageContextRef;
}): string {
  return JSON.stringify(execution.createLineageContextRef());
}

/** Owns raw persistence operations for the canonical Messaging records. */
export interface MessagingRepository {
  /** Reads the current conversation for an installation and administrator. */
  queryConversation(
    transaction: PersistenceInternalTransaction,
    installationId: string,
    administratorId?: string,
    forUpdate?: boolean,
  ): Promise<MessagingConversation | undefined>;
  /** Reads one conversation by its canonical identifier. */
  queryConversationById(
    transaction: PersistenceInternalTransaction,
    conversationId: string,
    forUpdate?: boolean,
  ): Promise<MessagingConversation | undefined>;
  /** Reads inbound messages in one canonical sequence interval. */
  queryMessages(
    transaction: PersistenceInternalTransaction,
    conversationId: CanonicalConversationId,
    afterSequence: number,
    throughSequence?: number,
  ): Promise<readonly MessageFact[]>;
  /** Reads one bounded ordered message page after a sequence. */
  readMessagesPage(
    transaction: PersistenceInternalTransaction,
    conversationId: CanonicalConversationId,
    afterSequence: number,
    limit: number,
  ): Promise<readonly MessageFact[]>;
  /** Reads the singleton current Administrator identifier. */
  readCurrentAdministratorId(
    transaction: PersistenceInternalTransaction,
  ): Promise<string | undefined>;
  /** Reads an inbound fact by its client idempotency key. */
  readInboundByClientId(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly conversationId: string;
      readonly administratorAccountId: string;
      readonly clientMessageId: string;
    },
  ): Promise<MessageFact | undefined>;
  /** Reads one canonical MessageFact by identifier. */
  readMessage(
    transaction: PersistenceInternalTransaction,
    messageId: string,
  ): Promise<MessageFact | undefined>;
  /** Reads the conversation associated with a CommunicationCommit. */
  readCommunicationConversationId(
    transaction: PersistenceInternalTransaction,
    communicationCommitId: string,
  ): Promise<unknown>;
  /** Reads an outbound fact associated with a CommunicationCommit. */
  readOutboundByCommunicationCommit(
    transaction: PersistenceInternalTransaction,
    communicationCommitId: string,
  ): Promise<MessageFact | undefined>;
  /** Inserts the canonical conversation if it does not already exist. */
  insertConversation(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly conversationId: string;
      readonly installationId: string;
      readonly administratorId: string;
      readonly administratorAccountId: string;
      readonly subjectId: string;
      readonly subjectAccountId: string;
      readonly platformId: string;
      readonly createdAt: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Inserts the initial mailbox projection for a conversation. */
  insertMailbox(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly conversationId: string;
      readonly updatedAt: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Inserts one accepted inbound MessageFact. */
  insertInboundMessage(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly messageId: string;
      readonly conversationId: string;
      readonly sequence: number;
      readonly administratorAccountId: string;
      readonly subjectAccountId: string;
      readonly text: string;
      readonly clientMessageId: string;
      readonly acceptedInputDigest: string;
      readonly createdAt: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Advances the canonical conversation sequence. */
  updateConversationLastSequence(
    transaction: PersistenceInternalTransaction,
    input: { readonly conversationId: string; readonly sequence: number },
  ): Promise<void>;
  /** Inserts one materialized outbound MessageFact. */
  insertOutboundMessage(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly messageId: string;
      readonly conversationId: string;
      readonly sequence: number;
      readonly subjectAccountId: string;
      readonly administratorAccountId: string;
      readonly text: string;
      readonly communicationCommitId: string;
      readonly createdAt: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
}

const messagingRepositoryImplementation: MessagingRepository = {
  async queryConversation(
    transaction,
    installationId,
    administratorId,
    forUpdate = false,
  ) {
    const rows = await executeRepositorySql<ConversationRow>(
      transaction,
      "SELECT " +
        CONVERSATION_COLUMNS +
        ' FROM "heptalogos"."messaging_conversation" WHERE installation_id = $1 ' +
        (administratorId === undefined ? "" : "AND administrator_id = $2 ") +
        (forUpdate ? "FOR UPDATE" : ""),
      administratorId === undefined
        ? [installationId]
        : [installationId, administratorId],
    );
    const row = rows[0];
    return row === undefined ? undefined : rowConversation(row);
  },
  async queryConversationById(transaction, conversationId, forUpdate = false) {
    const rows = await executeRepositorySql<ConversationRow>(
      transaction,
      "SELECT " +
        CONVERSATION_COLUMNS +
        ' FROM "heptalogos"."messaging_conversation" WHERE conversation_id = $1 ' +
        (forUpdate ? "FOR UPDATE" : ""),
      [conversationId],
    );
    const row = rows[0];
    return row === undefined ? undefined : rowConversation(row);
  },
  async queryMessages(transaction, conversationId, afterSequence, throughSequence) {
    const rows = await executeRepositorySql<MessageRow>(
      transaction,
      "SELECT " +
        MESSAGE_COLUMNS +
        ' FROM "heptalogos"."message_fact" WHERE conversation_id = $1 ' +
        "AND direction = 'INBOUND' AND sequence > $2 " +
        (throughSequence === undefined ? "" : "AND sequence <= $3 ") +
        "ORDER BY sequence ASC",
      throughSequence === undefined
        ? [conversationId, afterSequence]
        : [conversationId, afterSequence, throughSequence],
    );
    return Object.freeze(rows.map(rowMessage));
  },
  async readMessagesPage(transaction, conversationId, afterSequence, limit) {
    const rows = await executeRepositorySql<MessageRow>(
      transaction,
      "SELECT " +
        MESSAGE_COLUMNS +
        ' FROM "heptalogos"."message_fact" WHERE conversation_id = $1 ' +
        "AND sequence > $2 ORDER BY sequence ASC LIMIT $3",
      [conversationId, afterSequence, limit],
    );
    return Object.freeze(rows.map(rowMessage));
  },
  async readCurrentAdministratorId(transaction) {
    const rows = await executeRepositorySql<AdministratorRow>(
      transaction,
      'SELECT administrator_id FROM "heptalogos"."administrator" WHERE singleton = true',
    );
    return parseUuidV7Id("AdministratorId", rows[0]?.administrator_id);
  },
  async readInboundByClientId(transaction, input) {
    const rows = await executeRepositorySql<MessageRow>(
      transaction,
      "SELECT " +
        MESSAGE_COLUMNS +
        ' FROM "heptalogos"."message_fact" WHERE conversation_id = $1 ' +
        "AND sender_account_id = $2 AND client_message_id = $3 " +
        "AND direction = 'INBOUND'",
      [input.conversationId, input.administratorAccountId, input.clientMessageId],
    );
    return rows[0] === undefined ? undefined : rowMessage(rows[0]);
  },
  async readMessage(transaction, messageId) {
    const rows = await executeRepositorySql<MessageRow>(
      transaction,
      "SELECT " +
        MESSAGE_COLUMNS +
        ' FROM "heptalogos"."message_fact" WHERE message_id = $1',
      [messageId],
    );
    return rows[0] === undefined ? undefined : rowMessage(rows[0]);
  },
  async readCommunicationConversationId(transaction, communicationCommitId) {
    const rows = await executeRepositorySql<{ readonly conversation_id: unknown }>(
      transaction,
      'SELECT conversation_id FROM "heptalogos"."communication_commit" ' +
        "WHERE communication_commit_id = $1",
      [communicationCommitId],
    );
    return rows[0]?.conversation_id;
  },
  async readOutboundByCommunicationCommit(transaction, communicationCommitId) {
    const rows = await executeRepositorySql<MessageRow>(
      transaction,
      "SELECT " +
        MESSAGE_COLUMNS +
        ' FROM "heptalogos"."message_fact" ' +
        "WHERE caused_by_communication_commit_id = $1",
      [communicationCommitId],
    );
    return rows[0] === undefined ? undefined : rowMessage(rows[0]);
  },
  async insertConversation(transaction, input) {
    await executeRepositorySql(
      transaction,
      'INSERT INTO "heptalogos"."messaging_conversation" ' +
        "(conversation_id, installation_id, platform_id, administrator_id, " +
        "administrator_account_id, subject_id, subject_account_id, last_sequence, " +
        "created_at, lineage_context_ref) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9) " +
        "ON CONFLICT (installation_id) DO NOTHING",
      [
        input.conversationId,
        input.installationId,
        input.platformId,
        input.administratorId,
        input.administratorAccountId,
        input.subjectId,
        input.subjectAccountId,
        input.createdAt,
        input.lineageContextRef,
      ],
    );
  },
  async insertMailbox(transaction, input) {
    await executeRepositorySql(
      transaction,
      'INSERT INTO "heptalogos"."conversation_mailbox" ' +
        "(conversation_id, mailbox_revision, consumed_through_sequence, " +
        "open_reaction_id, updated_at, lineage_context_ref) VALUES ($1, 0, 0, NULL, $2, $3) " +
        "ON CONFLICT (conversation_id) DO NOTHING",
      [input.conversationId, input.updatedAt, input.lineageContextRef],
    );
  },
  async insertInboundMessage(transaction, input) {
    await executeRepositorySql(
      transaction,
      'INSERT INTO "heptalogos"."message_fact" ' +
        "(message_id, conversation_id, sequence, direction, sender_kind, " +
        "sender_account_id, recipient_kind, recipient_account_id, text, " +
        "client_message_id, accepted_input_digest, caused_by_communication_commit_id, " +
        "created_at, lineage_context_ref) VALUES ($1, $2, $3, 'INBOUND', 'ADMINISTRATOR', " +
        "$4, 'SUBJECT', $5, $6, $7, $8, NULL, $9, $10)",
      [
        input.messageId,
        input.conversationId,
        input.sequence,
        input.administratorAccountId,
        input.subjectAccountId,
        input.text,
        input.clientMessageId,
        input.acceptedInputDigest,
        input.createdAt,
        input.lineageContextRef,
      ],
    );
  },
  async updateConversationLastSequence(transaction, input) {
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."messaging_conversation" SET last_sequence = $2 ' +
        "WHERE conversation_id = $1",
      [input.conversationId, input.sequence],
    );
  },
  async insertOutboundMessage(transaction, input) {
    await executeRepositorySql(
      transaction,
      'INSERT INTO "heptalogos"."message_fact" ' +
        "(message_id, conversation_id, sequence, direction, sender_kind, " +
        "sender_account_id, recipient_kind, recipient_account_id, text, " +
        "client_message_id, accepted_input_digest, caused_by_communication_commit_id, " +
        "created_at, lineage_context_ref) VALUES ($1, $2, $3, 'OUTBOUND', 'SUBJECT', " +
        "$4, 'ADMINISTRATOR', $5, $6, NULL, NULL, $7, $8, $9)",
      [
        input.messageId,
        input.conversationId,
        input.sequence,
        input.subjectAccountId,
        input.administratorAccountId,
        input.text,
        input.communicationCommitId,
        input.createdAt,
        input.lineageContextRef,
      ],
    );
  },
};

/** The current direct Messaging repository implementation. */
export const messagingRepository = Object.freeze(messagingRepositoryImplementation);
