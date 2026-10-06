// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Defines the current built-in Subject Chat and canonical MessageFact types.
 * @module contracts
 */

import {
  createMessagingPlatformId,
  type CanonicalConversationId,
  type CanonicalMessageId,
  type CommunicationCommitId,
  type InstallationId,
  type Instant,
  type MessagingAccountId,
  type MessagingPlatformId,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionLineageService,
  LineageContextRef,
} from "@heptalogos/execution-lineage";
import type { EvidenceService } from "@heptalogos/evidence";
import type {
  PersistenceMutationTransactionContext,
  PersistenceService,
} from "@heptalogos/persistence";
import type { ExecutionContextRuntime } from "@heptalogos/execution-lineage";
import type { TimeService } from "@heptalogos/time-service";

/** The only current Product Messaging platform. */
export const SUBJECT_CHAT_PLATFORM_ID: MessagingPlatformId = createMessagingPlatformId(
  "heptalogos-subject-chat",
);

/** The two canonical actors in the current direct conversation. */
export type MessagingActorKind = "ADMINISTRATOR" | "SUBJECT";
/** The two canonical directions in the current conversation. */
export type MessageDirection = "INBOUND" | "OUTBOUND";

/** One persisted built-in Administrator to Subject conversation. */
export interface MessagingConversation {
  readonly schemaVersion: 1;
  readonly conversationId: CanonicalConversationId;
  readonly installationId: InstallationId;
  readonly platformId: typeof SUBJECT_CHAT_PLATFORM_ID;
  readonly administratorId: string;
  readonly administratorAccountId: MessagingAccountId;
  readonly subjectId: string;
  readonly subjectAccountId: MessagingAccountId;
  readonly lastSequence: number;
  readonly createdAt: Instant;
  readonly lineageContextRef: LineageContextRef;
}

/** One immutable canonical conversation fact. */
export interface MessageFact {
  readonly schemaVersion: 1;
  readonly messageId: CanonicalMessageId;
  readonly conversationId: CanonicalConversationId;
  readonly sequence: number;
  readonly direction: MessageDirection;
  readonly senderKind: MessagingActorKind;
  readonly senderAccountId: MessagingAccountId;
  readonly recipientKind: MessagingActorKind;
  readonly recipientAccountId: MessagingAccountId;
  readonly text: string;
  readonly clientMessageId?: string;
  readonly acceptedInputDigest?: string;
  readonly causedByCommunicationCommitId?: CommunicationCommitId;
  readonly createdAt: Instant;
  readonly lineageContextRef: LineageContextRef;
}

/** Result returned by the idempotent inbound acceptance operation. */
export interface InboundMessageAcceptance {
  readonly schemaVersion: 1;
  readonly status: "ACCEPTED" | "EXISTING";
  readonly message: MessageFact;
}

/** Bounded page of canonical messages and its opaque continuation cursor. */
export interface MessagePage {
  readonly schemaVersion: 1;
  readonly conversationId: CanonicalConversationId;
  readonly messages: readonly MessageFact[];
  readonly nextCursor?: string;
}

/** Candidate identity passed to Subject before an inbound transaction opens. */
export interface AcceptedInboundPreparationInput {
  readonly conversationId: CanonicalConversationId;
  readonly acceptedMessageId: CanonicalMessageId;
}

/** Narrow callback used to atomically attach Subject obligation to a MessageFact. */
export interface MessagingInboundConsumer<TPrepared> {
  /** Prepares the Subject obligation before the Messaging mutation transaction. */
  prepare(input: AcceptedInboundPreparationInput): Promise<TPrepared>;
  /** Commits the prepared obligation in the current Messaging transaction. */
  commit(
    transaction: PersistenceMutationTransactionContext,
    input: {
      readonly message: MessageFact;
      readonly preparation: TPrepared;
    },
  ): Promise<void>;
}

/** Input required to create the current built-in conversation after claim. */
export interface EnsureConversationInput {
  readonly subjectId: string;
}

/** Public inbound request after Management has authenticated the Administrator. */
export interface AcceptInboundInput {
  readonly administratorId: string;
  readonly clientMessageId: string;
  readonly text: string;
}

/** Public message query after Management has authenticated the Administrator. */
export interface ListMessagesInput {
  readonly administratorId: string;
  readonly cursor?: string;
  readonly limit?: number;
}

/** Values needed to materialize one local Subject outbound fact. */
export interface MaterializeOutboundInput {
  readonly communicationCommitId: string;
  readonly text: string;
}

/** Current Messaging service options; the consumer is supplied by Product composition. */
export interface MessagingServiceOptions<TPrepared> {
  readonly installationId: InstallationId;
  readonly persistence: PersistenceService;
  readonly execution: ExecutionContextRuntime;
  readonly lineage: ExecutionLineageService;
  readonly evidence: EvidenceService;
  readonly time: TimeService;
  readonly inboundConsumer: MessagingInboundConsumer<TPrepared>;
}

/** Canonical Messaging owner used by Subject and the Subject Chat transport. */
export interface MessagingService {
  /** Creates or reads the one current built-in conversation. */
  ensureCurrentConversation(
    input: EnsureConversationInput,
  ): Promise<MessagingConversation | undefined>;
  /** Reads the built-in conversation for an authenticated Administrator. */
  getConversationForAdministrator(
    administratorId: string,
  ): Promise<MessagingConversation | undefined>;
  /** Accepts one idempotent inbound Administrator message. */
  acceptInbound(input: AcceptInboundInput): Promise<InboundMessageAcceptance>;
  /** Reads the bounded canonical conversation history. */
  listMessages(input: ListMessagesInput): Promise<MessagePage>;
  /** Reads inbound facts for a Subject context projection. */
  listInboundMessages(input: {
    readonly conversationId: CanonicalConversationId;
    readonly afterSequence: number;
    readonly throughSequence?: number;
  }): Promise<readonly MessageFact[]>;
  /** Reads pending inbound facts inside a caller-owned mutation transaction. */
  listPendingInboundWithinTransaction(
    transaction: PersistenceMutationTransactionContext,
    input: {
      readonly conversationId: CanonicalConversationId;
      readonly afterSequence: number;
      readonly throughSequence?: number;
    },
  ): Promise<readonly MessageFact[]>;
  /** Materializes one outbound fact inside a caller-owned mutation transaction. */
  materializeOutboundWithinTransaction(
    transaction: PersistenceMutationTransactionContext,
    input: MaterializeOutboundInput,
  ): Promise<MessageFact>;
  /** Materializes one outbound fact in a normal owned mutation operation. */
  materializeOutbound(input: MaterializeOutboundInput): Promise<MessageFact>;
}
