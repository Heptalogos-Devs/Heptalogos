// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Owns Subject persistence rows, codecs, and SQL mechanics.
 * @module repository
 */

import {
  formatInstant,
  parseUuidV7Id,
  type CanonicalConversationId,
  type Instant,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionContextRuntime,
  LineageContextRef,
} from "@heptalogos/execution-lineage";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import { executeRepositorySql } from "@heptalogos/persistence/repository";
import type {
  CommunicationCommit,
  ConversationReactionProposal,
  SubjectAuthorityRecord,
  SubjectCognitionProvenance,
  Reaction,
} from "./contracts.js";
import { subjectProblem } from "./problems.js";

/** Represents one raw persisted Subject authority row. */
interface AuthorityRow {
  readonly subject_id: unknown;
  readonly installation_id: unknown;
  readonly desired_state: unknown;
  readonly authority_revision: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly lineage_context_ref: unknown;
}

/** Represents one raw persisted ConversationMailbox row. */
interface MailboxRow {
  readonly conversation_id: unknown;
  readonly mailbox_revision: unknown;
  readonly consumed_through_sequence: unknown;
  readonly open_reaction_id: unknown;
  readonly updated_at: unknown;
  readonly lineage_context_ref: unknown;
}

/** Represents one raw persisted Subject Reaction row. */
interface ReactionRow {
  readonly reaction_id: unknown;
  readonly conversation_id: unknown;
  readonly observed_mailbox_revision: unknown;
  readonly observed_through_sequence: unknown;
  readonly observed_subject_authority_revision: unknown;
  readonly state: unknown;
  readonly owner_work_item_id: unknown;
  readonly owner_activity_ref: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly lineage_context_ref: unknown;
}

/** Represents one raw persisted CommunicationCommit row. */
interface CommunicationRow {
  readonly communication_commit_id: unknown;
  readonly reaction_id: unknown;
  readonly subject_id: unknown;
  readonly subject_authority_revision: unknown;
  readonly mailbox_revision: unknown;
  readonly conversation_id: unknown;
  readonly purpose: unknown;
  readonly semantic_content: unknown;
  readonly semantic_content_digest: unknown;
  readonly primary_cognition_provenance: unknown;
  readonly committed_at: unknown;
  readonly lineage_context_ref: unknown;
}

/** Represents the mailbox revision fields needed by Subject executors. */
interface MailboxRevision {
  readonly conversationId: CanonicalConversationId;
  readonly mailboxRevision: number;
  readonly consumedThroughSequence: number;
  readonly openReactionId?: string;
}

/** Select list for Subject authority persistence reads. */
const AUTHORITY_COLUMNS =
  "subject_id, installation_id, desired_state, authority_revision, " +
  "created_at, updated_at, lineage_context_ref";
/** Select list for ConversationMailbox persistence reads. */
const MAILBOX_COLUMNS =
  "conversation_id, mailbox_revision, consumed_through_sequence, " +
  "open_reaction_id, updated_at, lineage_context_ref";
/** Select list for Subject Reaction persistence reads. */
const REACTION_COLUMNS =
  "reaction_id, conversation_id, observed_mailbox_revision, " +
  "observed_through_sequence, observed_subject_authority_revision, state, " +
  "owner_work_item_id, owner_activity_ref, created_at, updated_at, " +
  "lineage_context_ref";
/** Select list for CommunicationCommit persistence reads. */
const COMMUNICATION_COLUMNS =
  "communication_commit_id, reaction_id, subject_id, subject_authority_revision, " +
  "mailbox_revision, conversation_id, purpose, semantic_content, " +
  "semantic_content_digest, primary_cognition_provenance, committed_at, " +
  "lineage_context_ref";

function parseJson(value: unknown, field: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      field + " is not valid JSON",
      "integrity",
    );
  }
}

function record(value: unknown, field: string): Record<string, unknown> {
  const parsed = parseJson(value, field);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      field + " must be an object",
      "integrity",
    );
  }
  return parsed as Record<string, unknown>;
}

function asBoundedText(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim().length === 0
  ) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      field + " is not a bounded non-empty string",
      "integrity",
    );
  }
  return value;
}

function asInstant(value: unknown, field: string): Instant {
  const text = value instanceof Date ? formatInstant(value) : value;
  const parsed =
    typeof text === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(text)
      ? (text as Instant)
      : undefined;
  if (parsed === undefined) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      field + " is not a canonical Instant",
      "integrity",
    );
  }
  return parsed;
}

function asInteger(value: unknown, field: string, minimum: number): number {
  const parsed =
    typeof value === "string"
      ? /^(0|[1-9][0-9]*)$/u.test(value)
        ? Number(value)
        : Number.NaN
      : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < minimum) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      field + " is not a valid bounded integer",
      "integrity",
    );
  }
  return parsed;
}

function asUuid<T extends string>(brand: T, value: unknown, field: string) {
  const parsed = parseUuidV7Id(brand, value);
  if (parsed === undefined) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      field + " is not a UUIDv7 identifier",
      "integrity",
    );
  }
  return parsed;
}

function asLineage(value: unknown, field: string): LineageContextRef {
  const parsed = record(value, field);
  if (
    parsed.schemaVersion !== 1 ||
    parseUuidV7Id("ActivityId", parsed.sourceActivityId) === undefined ||
    parseUuidV7Id("InstanceId", parsed.sourceInstanceId) === undefined ||
    parseUuidV7Id("ContinuityEpochId", parsed.sourceContinuityEpochId) === undefined
  ) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      field + " is not a valid LineageContextRef",
      "integrity",
    );
  }
  return Object.freeze(parsed as unknown as LineageContextRef);
}

function authorityFromRow(row: AuthorityRow): SubjectAuthorityRecord {
  const desiredState = row.desired_state;
  if (desiredState !== "STOPPED" && desiredState !== "RUNNING") {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      "desired_state is not a current Subject state",
      "integrity",
    );
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    subjectId: asUuid("SubjectId", row.subject_id, "subject_id"),
    installationId: asUuid("InstallationId", row.installation_id, "installation_id"),
    desiredState,
    authorityRevision: asInteger(row.authority_revision, "authority_revision", 1),
    createdAt: asInstant(row.created_at, "created_at"),
    updatedAt: asInstant(row.updated_at, "updated_at"),
    lineageContextRef: asLineage(row.lineage_context_ref, "lineage_context_ref"),
  });
}

function mailboxRevision(row: MailboxRow): MailboxRevision {
  const openReactionId =
    row.open_reaction_id === null || row.open_reaction_id === undefined
      ? undefined
      : asUuid("ReactionId", row.open_reaction_id, "open_reaction_id");
  return Object.freeze({
    conversationId: asUuid(
      "CanonicalConversationId",
      row.conversation_id,
      "conversation_id",
    ),
    mailboxRevision: asInteger(row.mailbox_revision, "mailbox_revision", 0),
    consumedThroughSequence: asInteger(
      row.consumed_through_sequence,
      "consumed_through_sequence",
      0,
    ),
    ...(openReactionId === undefined ? {} : { openReactionId }),
  });
}

function reactionFromRow(row: ReactionRow): Reaction {
  const state = row.state;
  if (
    state !== "OPEN" &&
    state !== "SUPERSEDED" &&
    state !== "NO_COMMUNICATION" &&
    state !== "COMMUNICATION_COMMITTED" &&
    state !== "REPLIED" &&
    state !== "FAILED"
  ) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      "reaction state is invalid",
      "integrity",
    );
  }
  const owner = record(row.owner_activity_ref, "owner_activity_ref");
  if (
    owner.schemaVersion !== 1 ||
    parseUuidV7Id("ActivityId", owner.activityId) === undefined
  ) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      "owner_activity_ref is invalid",
      "integrity",
    );
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    reactionId: asUuid("ReactionId", row.reaction_id, "reaction_id"),
    conversationId: asUuid(
      "CanonicalConversationId",
      row.conversation_id,
      "conversation_id",
    ),
    observedMailboxRevision: asInteger(
      row.observed_mailbox_revision,
      "observed_mailbox_revision",
      0,
    ),
    observedThroughSequence: asInteger(
      row.observed_through_sequence,
      "observed_through_sequence",
      0,
    ),
    observedSubjectAuthorityRevision: asInteger(
      row.observed_subject_authority_revision,
      "observed_subject_authority_revision",
      1,
    ),
    state,
    ownerWorkItemId: asUuid("WorkItemId", row.owner_work_item_id, "owner_work_item_id"),
    ownerActivityRef: Object.freeze({
      schemaVersion: 1 as const,
      activityId: owner.activityId as string,
    }),
    createdAt: asInstant(row.created_at, "created_at"),
    updatedAt: asInstant(row.updated_at, "updated_at"),
    lineageContextRef: asLineage(row.lineage_context_ref, "lineage_context_ref"),
  });
}

function invalidConversationProposal(detail: string): never {
  throw subjectProblem(
    "subject.reaction_proposal_invalid",
    "Subject conversation proposal is invalid",
    detail,
    "validation",
  );
}

/** Decodes and validates one bounded cognition proposal. */
export function conversationReactionProposal(
  value: unknown,
): ConversationReactionProposal {
  const parsed = record(value, "conversation_reaction_proposal");
  if (parsed.schemaVersion !== 1) {
    return invalidConversationProposal(
      "ConversationReactionProposal schemaVersion is not current",
    );
  }
  if (parsed.kind === "NO_COMMUNICATION" && Object.keys(parsed).length === 2) {
    return Object.freeze({
      schemaVersion: 1 as const,
      kind: "NO_COMMUNICATION" as const,
    });
  }
  if (parsed.kind === "COMMUNICATE") {
    if (
      typeof parsed.semanticContent !== "object" ||
      parsed.semanticContent === null ||
      Array.isArray(parsed.semanticContent)
    ) {
      return invalidConversationProposal("COMMUNICATE requires semanticContent object");
    }
    const content = parsed.semanticContent as Record<string, unknown>;
    if (
      content.schemaVersion !== 1 ||
      typeof content.content !== "string" ||
      content.content.trim() === "" ||
      new TextEncoder().encode(content.content).byteLength > 65_536 ||
      Object.keys(content).length !== 2 ||
      Object.keys(parsed).length !== 3
    ) {
      return invalidConversationProposal(
        "COMMUNICATE semanticContent is not the current bounded shape",
      );
    }
    return Object.freeze({
      schemaVersion: 1 as const,
      kind: "COMMUNICATE" as const,
      semanticContent: Object.freeze({
        schemaVersion: 1 as const,
        content: content.content,
      }),
    });
  }
  return invalidConversationProposal(
    "ConversationReactionProposal must be COMMUNICATE or NO_COMMUNICATION",
  );
}

function cognitionProvenanceFromRow(value: unknown): SubjectCognitionProvenance {
  const parsed = record(value, "primary_cognition_provenance");
  if (Object.keys(parsed).length !== 20) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      "primary_cognition_provenance contains unexpected fields",
      "integrity",
    );
  }
  const terminalToolName = parsed.terminalToolName;
  const terminalStatus = parsed.terminalStatus;
  const protocol = parsed.protocol;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.provider !== "openclaw" ||
    typeof parsed.openclawVersion !== "string" ||
    parsed.openclawVersion.length === 0 ||
    parsed.openclawVersion.length > 64 ||
    parsed.profile !== "subject" ||
    (terminalToolName !== "heptalogos_propose_communication" &&
      terminalToolName !== "heptalogos_complete_without_communication") ||
    (terminalStatus !== "ok" &&
      terminalStatus !== "error" &&
      terminalStatus !== "timeout") ||
    (protocol !== "openai-chat" && protocol !== "openai-responses")
  ) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      "primary_cognition_provenance domain values are invalid",
      "integrity",
    );
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    provider: "openclaw" as const,
    runtimeGeneration: asBoundedText(
      parsed.runtimeGeneration,
      "runtimeGeneration",
      256,
    ),
    openclawVersion: asBoundedText(parsed.openclawVersion, "openclawVersion", 64),
    profile: "subject" as const,
    agentId: asBoundedText(parsed.agentId, "agentId", 128),
    sessionKey: asBoundedText(parsed.sessionKey, "sessionKey", 512),
    runId: asBoundedText(parsed.runId, "runId", 256),
    modelProvider: asBoundedText(parsed.modelProvider, "modelProvider", 128),
    modelIdentifier: asBoundedText(parsed.modelIdentifier, "modelIdentifier", 256),
    modelBindingId: asUuid("ModelBindingId", parsed.modelBindingId, "modelBindingId"),
    bindingRevision: asInteger(parsed.bindingRevision, "bindingRevision", 1),
    modelProfileId: asUuid("ModelProfileId", parsed.modelProfileId, "modelProfileId"),
    modelProfileGeneration: asInteger(
      parsed.modelProfileGeneration,
      "modelProfileGeneration",
      1,
    ),
    gatewayProfileId: asUuid(
      "GatewayProfileId",
      parsed.gatewayProfileId,
      "gatewayProfileId",
    ),
    configurationRevisionId: asUuid(
      "ConfigurationRevisionId",
      parsed.configurationRevisionId,
      "configurationRevisionId",
    ),
    gatewayConfigurationRevisionId: asUuid(
      "ConfigurationRevisionId",
      parsed.gatewayConfigurationRevisionId,
      "gatewayConfigurationRevisionId",
    ),
    protocol,
    terminalToolName,
    terminalStatus,
  });
}

function communicationFromRow(row: CommunicationRow): CommunicationCommit {
  const purpose = row.purpose;
  const content = record(row.semantic_content, "semantic_content");
  if (
    purpose !== "reply" ||
    content.schemaVersion !== 1 ||
    typeof content.content !== "string" ||
    content.content.trim() === "" ||
    Object.keys(content).length !== 2
  ) {
    throw subjectProblem(
      "subject.repository_invalid",
      "Subject repository data is invalid",
      "CommunicationCommit domain values are invalid",
      "integrity",
    );
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    communicationCommitId: asUuid(
      "CommunicationCommitId",
      row.communication_commit_id,
      "communication_commit_id",
    ),
    reactionId: asUuid("ReactionId", row.reaction_id, "reaction_id"),
    subjectId: asUuid("SubjectId", row.subject_id, "subject_id"),
    subjectAuthorityRevision: asInteger(
      row.subject_authority_revision,
      "subject_authority_revision",
      1,
    ),
    mailboxRevision: asInteger(row.mailbox_revision, "mailbox_revision", 0),
    conversationId: asUuid(
      "CanonicalConversationId",
      row.conversation_id,
      "conversation_id",
    ),
    purpose: "reply" as const,
    semanticContent: Object.freeze({
      schemaVersion: 1 as const,
      content: content.content,
    }),
    semanticContentDigest: String(row.semantic_content_digest),
    primaryCognitionProvenance: cognitionProvenanceFromRow(
      row.primary_cognition_provenance,
    ),
    committedAt: asInstant(row.committed_at, "committed_at"),
    lineageContextRef: asLineage(row.lineage_context_ref, "lineage_context_ref"),
  });
}

/** Serializes the current execution lineage reference for persistence. */
export function lineageJson(execution: ExecutionContextRuntime): string {
  return JSON.stringify(execution.createLineageContextRef());
}

/** Owns direct persistence operations for Subject-owned records. */
export interface SubjectRepository {
  /** Reads the current Subject authority for an installation. */
  readAuthority(
    transaction: PersistenceInternalTransaction,
    installationId: string,
    forUpdate?: boolean,
  ): Promise<SubjectAuthorityRecord | undefined>;
  /** Reads one ConversationMailbox projection. */
  readMailbox(
    transaction: PersistenceInternalTransaction,
    conversationId: CanonicalConversationId,
    forUpdate?: boolean,
  ): Promise<MailboxRevision | undefined>;
  /** Reads one Subject Reaction by identifier. */
  readReaction(
    transaction: PersistenceInternalTransaction,
    reactionId: string,
    forUpdate?: boolean,
  ): Promise<Reaction | undefined>;
  /** Reads the Reaction owned by one WorkItem. */
  readReactionByWorkItem(
    transaction: PersistenceInternalTransaction,
    workItemId: string,
  ): Promise<Reaction | undefined>;
  /** Reads the CommunicationCommit associated with a Reaction. */
  readCommunication(
    transaction: PersistenceInternalTransaction,
    reactionId: string,
  ): Promise<CommunicationCommit | undefined>;
  /** Checks whether a Reaction already has an outbound fact. */
  outboundExists(
    transaction: PersistenceInternalTransaction,
    communicationCommitId: string,
  ): Promise<boolean>;
  /** Checks whether an installation has an open Reaction. */
  hasOpenReactionForInstallation(
    transaction: PersistenceInternalTransaction,
    installationId: string,
  ): Promise<boolean>;
  /** Inserts the initial Subject authority record. */
  insertAuthority(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly subjectId: string;
      readonly installationId: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Updates the explicit desired Subject lifecycle state. */
  updateDesiredState(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly subjectId: string;
      readonly desiredState: "STOPPED" | "RUNNING";
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Advances a mailbox through the observed inbound sequence. */
  advanceMailbox(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly conversationId: string;
      readonly throughSequence: number;
      readonly reactionId: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Updates mailbox revision after accepted inbound admission. */
  updateAcceptedInboundMailbox(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly conversationId: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Supersedes a stale Reaction and releases its mailbox ownership. */
  supersedeReactionAndReleaseMailbox(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly reactionId: string;
      readonly conversationId: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Clears a stale open Reaction reference from a mailbox. */
  clearOpenReaction(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly conversationId: string;
      readonly reactionId: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Inserts one acquired Subject Reaction. */
  insertReaction(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly reactionId: string;
      readonly conversationId: string;
      readonly mailboxRevision: number;
      readonly throughSequence: number;
      readonly authorityRevision: number;
      readonly workItemId: string;
      readonly activityId: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Sets the canonical open Reaction mailbox reference. */
  setOpenReaction(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly conversationId: string;
      readonly reactionId: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Marks a Reaction as completed without communication. */
  markNoCommunication(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly conversationId: string;
      readonly throughSequence: number;
      readonly reactionId: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Inserts one accepted CommunicationCommit. */
  insertCommunicationCommit(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly communicationCommitId: string;
      readonly reactionId: string;
      readonly subjectId: string;
      readonly authorityRevision: number;
      readonly mailboxRevision: number;
      readonly conversationId: string;
      readonly semanticContent: string;
      readonly semanticContentDigest: string;
      readonly primaryCognitionProvenance: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Marks a Reaction after its CommunicationCommit is durable. */
  markCommunicationCommitted(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly reactionId: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
  /** Marks a Reaction after outbound realization and mailbox advancement. */
  markReplied(
    transaction: PersistenceInternalTransaction,
    input: {
      readonly reactionId: string;
      readonly now: Instant;
      readonly lineageContextRef: string;
    },
  ): Promise<void>;
}

const subjectRepositoryImplementation: SubjectRepository = {
  async readAuthority(transaction, installationId, forUpdate = false) {
    const rows = await executeRepositorySql<AuthorityRow>(
      transaction,
      "SELECT " +
        AUTHORITY_COLUMNS +
        ' FROM "heptalogos"."subject_authority" WHERE installation_id = $1 ' +
        (forUpdate ? "FOR UPDATE" : ""),
      [installationId],
    );
    return rows[0] === undefined ? undefined : authorityFromRow(rows[0]);
  },
  async readMailbox(transaction, conversationId, forUpdate = false) {
    const rows = await executeRepositorySql<MailboxRow>(
      transaction,
      "SELECT " +
        MAILBOX_COLUMNS +
        ' FROM "heptalogos"."conversation_mailbox" WHERE conversation_id = $1 ' +
        (forUpdate ? "FOR UPDATE" : ""),
      [conversationId],
    );
    return rows[0] === undefined ? undefined : mailboxRevision(rows[0]);
  },
  async readReaction(transaction, reactionId, forUpdate = false) {
    const rows = await executeRepositorySql<ReactionRow>(
      transaction,
      "SELECT " +
        REACTION_COLUMNS +
        ' FROM "heptalogos"."reaction" WHERE reaction_id = $1 ' +
        (forUpdate ? "FOR UPDATE" : ""),
      [reactionId],
    );
    return rows[0] === undefined ? undefined : reactionFromRow(rows[0]);
  },
  async readReactionByWorkItem(transaction, workItemId) {
    const rows = await executeRepositorySql<ReactionRow>(
      transaction,
      "SELECT " +
        REACTION_COLUMNS +
        ' FROM "heptalogos"."reaction" WHERE owner_work_item_id = $1 FOR UPDATE',
      [workItemId],
    );
    return rows[0] === undefined ? undefined : reactionFromRow(rows[0]);
  },
  async readCommunication(transaction, reactionId) {
    const rows = await executeRepositorySql<CommunicationRow>(
      transaction,
      "SELECT " +
        COMMUNICATION_COLUMNS +
        ' FROM "heptalogos"."communication_commit" WHERE reaction_id = $1',
      [reactionId],
    );
    return rows[0] === undefined ? undefined : communicationFromRow(rows[0]);
  },
  async outboundExists(transaction, communicationCommitId) {
    const rows = await executeRepositorySql<{ readonly message_id: unknown }>(
      transaction,
      'SELECT message_id FROM "heptalogos"."message_fact" ' +
        "WHERE caused_by_communication_commit_id = $1 LIMIT 1",
      [communicationCommitId],
    );
    return rows[0] !== undefined;
  },
  async hasOpenReactionForInstallation(transaction, installationId) {
    const rows = await executeRepositorySql<{ readonly open_reaction_id: unknown }>(
      transaction,
      'SELECT open_reaction_id FROM "heptalogos"."conversation_mailbox" ' +
        "WHERE conversation_id IN (" +
        'SELECT conversation_id FROM "heptalogos"."messaging_conversation" ' +
        "WHERE installation_id = $1)",
      [installationId],
    );
    return rows.some(
      (row) => row.open_reaction_id !== null && row.open_reaction_id !== undefined,
    );
  },
  async insertAuthority(transaction, input) {
    await executeRepositorySql(
      transaction,
      'INSERT INTO "heptalogos"."subject_authority" ' +
        "(subject_id, installation_id, desired_state, authority_revision, " +
        "created_at, updated_at, lineage_context_ref) " +
        "VALUES ($1, $2, 'STOPPED', 1, $3, $3, $4) " +
        "ON CONFLICT (installation_id) DO NOTHING",
      [input.subjectId, input.installationId, input.now, input.lineageContextRef],
    );
  },
  async updateDesiredState(transaction, input) {
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."subject_authority" ' +
        "SET desired_state = $2, authority_revision = authority_revision + 1, " +
        "updated_at = $3, lineage_context_ref = $4 WHERE subject_id = $1",
      [input.subjectId, input.desiredState, input.now, input.lineageContextRef],
    );
  },
  async advanceMailbox(transaction, input) {
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."conversation_mailbox" ' +
        "SET consumed_through_sequence = GREATEST(consumed_through_sequence, $2), " +
        "open_reaction_id = CASE WHEN open_reaction_id = $3 THEN NULL ELSE open_reaction_id END, " +
        "updated_at = $4, lineage_context_ref = $5 WHERE conversation_id = $1",
      [
        input.conversationId,
        input.throughSequence,
        input.reactionId,
        input.now,
        input.lineageContextRef,
      ],
    );
  },
  async updateAcceptedInboundMailbox(transaction, input) {
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."conversation_mailbox" ' +
        "SET mailbox_revision = mailbox_revision + 1, updated_at = $2, " +
        "lineage_context_ref = $3 WHERE conversation_id = $1",
      [input.conversationId, input.now, input.lineageContextRef],
    );
  },
  async supersedeReactionAndReleaseMailbox(transaction, input) {
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."reaction" SET state = \'SUPERSEDED\', ' +
        "updated_at = $2, lineage_context_ref = $3 " +
        "WHERE reaction_id = $1 AND state = 'OPEN'",
      [input.reactionId, input.now, input.lineageContextRef],
    );
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."conversation_mailbox" ' +
        "SET open_reaction_id = NULL, updated_at = $2, lineage_context_ref = $3 " +
        "WHERE conversation_id = $1 AND open_reaction_id = $4",
      [input.conversationId, input.now, input.lineageContextRef, input.reactionId],
    );
  },
  async clearOpenReaction(transaction, input) {
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."conversation_mailbox" ' +
        "SET open_reaction_id = NULL, updated_at = $2, lineage_context_ref = $3 " +
        "WHERE conversation_id = $1 AND open_reaction_id = $4",
      [input.conversationId, input.now, input.lineageContextRef, input.reactionId],
    );
  },
  async insertReaction(transaction, input) {
    await executeRepositorySql(
      transaction,
      'INSERT INTO "heptalogos"."reaction" ' +
        "(reaction_id, conversation_id, observed_mailbox_revision, " +
        "observed_through_sequence, observed_subject_authority_revision, state, " +
        "owner_work_item_id, owner_activity_ref, created_at, updated_at, lineage_context_ref) " +
        "VALUES ($1, $2, $3, $4, $5, 'OPEN', $6, $7, $8, $8, $9)",
      [
        input.reactionId,
        input.conversationId,
        input.mailboxRevision,
        input.throughSequence,
        input.authorityRevision,
        input.workItemId,
        JSON.stringify({ schemaVersion: 1, activityId: input.activityId }),
        input.now,
        input.lineageContextRef,
      ],
    );
  },
  async setOpenReaction(transaction, input) {
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."conversation_mailbox" ' +
        "SET open_reaction_id = $2, updated_at = $3, lineage_context_ref = $4 " +
        "WHERE conversation_id = $1 AND open_reaction_id IS NULL",
      [input.conversationId, input.reactionId, input.now, input.lineageContextRef],
    );
  },
  async markNoCommunication(transaction, input) {
    await this.advanceMailbox(transaction, input);
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."reaction" SET state = \'NO_COMMUNICATION\', ' +
        "updated_at = $2, lineage_context_ref = $3 " +
        "WHERE reaction_id = $1 AND state = 'OPEN'",
      [input.reactionId, input.now, input.lineageContextRef],
    );
  },
  async insertCommunicationCommit(transaction, input) {
    await executeRepositorySql(
      transaction,
      'INSERT INTO "heptalogos"."communication_commit" ' +
        "(communication_commit_id, reaction_id, subject_id, subject_authority_revision, " +
        "mailbox_revision, conversation_id, purpose, semantic_content, " +
        "semantic_content_digest, primary_cognition_provenance, committed_at, lineage_context_ref) " +
        "VALUES ($1, $2, $3, $4, $5, $6, 'reply', $7, $8, $9, $10, $11) " +
        "ON CONFLICT (reaction_id) DO NOTHING",
      [
        input.communicationCommitId,
        input.reactionId,
        input.subjectId,
        input.authorityRevision,
        input.mailboxRevision,
        input.conversationId,
        input.semanticContent,
        input.semanticContentDigest,
        input.primaryCognitionProvenance,
        input.now,
        input.lineageContextRef,
      ],
    );
  },
  async markCommunicationCommitted(transaction, input) {
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."reaction" SET state = \'COMMUNICATION_COMMITTED\', ' +
        "updated_at = $2, lineage_context_ref = $3 " +
        "WHERE reaction_id = $1 AND state = 'OPEN'",
      [input.reactionId, input.now, input.lineageContextRef],
    );
  },
  async markReplied(transaction, input) {
    await executeRepositorySql(
      transaction,
      'UPDATE "heptalogos"."reaction" SET state = \'REPLIED\', ' +
        "updated_at = $2, lineage_context_ref = $3 " +
        "WHERE reaction_id = $1 AND state = 'COMMUNICATION_COMMITTED'",
      [input.reactionId, input.now, input.lineageContextRef],
    );
  },
};

/** The current direct Subject repository implementation. */
export const subjectRepository = Object.freeze(subjectRepositoryImplementation);
