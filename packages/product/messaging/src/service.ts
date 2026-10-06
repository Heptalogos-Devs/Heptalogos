// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Implements canonical built-in Subject Chat semantics over the persistence owner.
 * @module service
 */

import {
  createCanonicalConversationId,
  createCanonicalMessageId,
  createMessagingAccountId,
  digestCanonicalJson,
  parseCanonicalConversationId,
  parseCommunicationCommitId,
  parseSubjectId,
  parseUuidV7Id,
  snapshotCanonicalJson,
  type CanonicalConversationId,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionContext,
  ExecutionLineageService,
} from "@heptalogos/execution-lineage";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";
import {
  useRepositoryMutationTransaction,
  useRepositoryReadTransaction,
} from "@heptalogos/persistence/repository";
import {
  SUBJECT_CHAT_PLATFORM_ID,
  type AcceptInboundInput,
  type EnsureConversationInput,
  type InboundMessageAcceptance,
  type ListMessagesInput,
  type MaterializeOutboundInput,
  type MessageFact,
  type MessagePage,
  type MessagingConversation,
  type MessagingService,
  type MessagingServiceOptions,
} from "./contracts.js";
import { decodeMessageCursor, encodeMessageCursor } from "./cursor.js";
import { canonicalLineage, messagingRepository } from "./repository.js";
import { messagingProblem } from "./problems.js";

function inputText(value: string, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    new TextEncoder().encode(value).byteLength > maximum
  ) {
    throw messagingProblem(
      "messaging.invalid_input",
      "Messaging request is invalid",
      field + " must be non-empty and within its current byte bound",
    );
  }
  return value;
}

async function activityMutation<TPrepared, T>(
  options: MessagingServiceOptions<TPrepared>,
  kind: string,
  operation: (activity: ExecutionContext) => Promise<T>,
): Promise<T> {
  const existing = options.execution.current();
  if (existing !== undefined) return operation(existing);
  return options.execution.runActivity(
    {
      kind,
      importance: "significant",
      retentionClass: "operational",
      sensitivity: "operational",
    },
    operation,
  );
}

/** Creates the current Messaging semantic owner over one Host-fenced database. */
export function createMessagingService<TPrepared>(
  options: MessagingServiceOptions<TPrepared>,
): MessagingService {
  const execution = options.execution;
  const lineageService: ExecutionLineageService = options.lineage;

  const withRequiredLineage = async (
    transaction: PersistenceMutationTransactionContext,
    activity: ExecutionContext,
    complete: boolean,
    outcome: "SUCCEEDED" | "FAILED" = "SUCCEEDED",
  ): Promise<void> => {
    if (lineageService === undefined) return;
    if (complete) {
      await lineageService.completeCurrent(transaction, activity, {
        endedAt: options.time.now(),
        outcome,
      });
    } else {
      await lineageService.retainCurrent(transaction, activity);
    }
  };

  const getConversationForAdministrator = async (
    administratorId: string,
  ): Promise<MessagingConversation | undefined> => {
    const parsedAdministrator = parseUuidV7Id("AdministratorId", administratorId);
    if (parsedAdministrator === undefined) return undefined;
    return options.persistence.read((context) =>
      useRepositoryReadTransaction(context, (transaction) =>
        messagingRepository.queryConversation(
          transaction,
          options.installationId,
          parsedAdministrator,
        ),
      ),
    );
  };

  const ensureCurrentConversation = async (
    input: EnsureConversationInput,
  ): Promise<MessagingConversation | undefined> => {
    const subjectId = parseSubjectId(input.subjectId);
    if (subjectId === undefined) {
      throw messagingProblem(
        "messaging.invalid_input",
        "Messaging request is invalid",
        "subjectId must be a UUIDv7 SubjectId",
      );
    }
    return activityMutation(
      options,
      "messaging.conversation.ensure",
      async (activity) =>
        options.persistence.mutate((context) =>
          useRepositoryMutationTransaction(context, async (transaction) => {
            await withRequiredLineage(context, activity, false);
            const administratorId =
              await messagingRepository.readCurrentAdministratorId(transaction);
            if (administratorId === undefined) {
              if (lineageService !== undefined) {
                await withRequiredLineage(context, activity, true);
              }
              return undefined;
            }
            const administratorAccountId = createMessagingAccountId();
            const subjectAccountId = createMessagingAccountId();
            const conversationId = createCanonicalConversationId();
            const createdAt = options.time.now();
            const lineageRef = canonicalLineage(execution);
            await messagingRepository.insertConversation(transaction, {
              conversationId,
              installationId: options.installationId,
              platformId: SUBJECT_CHAT_PLATFORM_ID,
              administratorId,
              administratorAccountId,
              subjectId,
              subjectAccountId,
              createdAt,
              lineageContextRef: lineageRef,
            });
            const conversation = await messagingRepository.queryConversation(
              transaction,
              options.installationId,
            );
            if (conversation === undefined) {
              throw messagingProblem(
                "messaging.repository_invalid",
                "Messaging conversation was not materialized",
                "The current built-in conversation could not be read after insertion",
                "integrity",
                "manual",
              );
            }
            if (
              conversation.subjectId !== subjectId ||
              conversation.administratorId !== administratorId
            ) {
              throw messagingProblem(
                "messaging.conversation_conflict",
                "Built-in conversation conflicts with the current installation",
                "The persisted Subject Chat conversation does not match the current Subject or Administrator",
                "conflict",
              );
            }
            await messagingRepository.insertMailbox(transaction, {
              conversationId: conversation.conversationId,
              updatedAt: createdAt,
              lineageContextRef: lineageRef,
            });
            if (lineageService !== undefined)
              await withRequiredLineage(context, activity, true);
            return conversation;
          }),
        ),
    );
  };

  const acceptInbound = async (
    input: AcceptInboundInput,
  ): Promise<InboundMessageAcceptance> => {
    const administratorId = parseUuidV7Id("AdministratorId", input.administratorId);
    if (administratorId === undefined) {
      throw messagingProblem(
        "messaging.authentication_invalid",
        "Messaging Administrator is invalid",
        "The authenticated Administrator identity is not current",
        "conflict",
      );
    }
    const clientMessageId = inputText(input.clientMessageId, "clientMessageId", 256);
    const messageText = inputText(input.text, "text", 65_536);
    const digest = digestCanonicalJson(
      "messaging.accepted-input.v1",
      snapshotCanonicalJson({
        schemaVersion: 1,
        clientMessageId,
        text: messageText,
      }).value,
    ).hex;
    const candidateMessageId = createCanonicalMessageId();
    return activityMutation(options, "messaging.inbound.accept", async (activity) => {
      const conversation = await getConversationForAdministrator(administratorId);
      if (conversation === undefined) {
        throw messagingProblem(
          "messaging.conversation_not_ready",
          "Subject Chat is not initialized",
          "The current Administrator has no built-in Subject Chat conversation",
          "unavailable",
          "after-change",
        );
      }
      const preparation = await options.inboundConsumer.prepare({
        conversationId: conversation.conversationId,
        acceptedMessageId: candidateMessageId,
      });
      return options.persistence.mutate((context) =>
        useRepositoryMutationTransaction(context, async (transaction) => {
          if (lineageService !== undefined)
            await withRequiredLineage(context, activity, false);
          const current = await messagingRepository.queryConversation(
            transaction,
            options.installationId,
            administratorId,
            true,
          );
          if (
            current === undefined ||
            current.conversationId !== conversation.conversationId
          ) {
            throw messagingProblem(
              "messaging.conversation_not_ready",
              "Subject Chat is not initialized",
              "The current built-in conversation changed before message acceptance",
              "conflict",
            );
          }
          const existingMessage = await messagingRepository.readInboundByClientId(
            transaction,
            {
              conversationId: current.conversationId,
              administratorAccountId: current.administratorAccountId,
              clientMessageId,
            },
          );
          if (existingMessage !== undefined) {
            if (existingMessage.acceptedInputDigest !== digest) {
              throw messagingProblem(
                "messaging.idempotency_conflict",
                "Inbound client message conflicts with an accepted fact",
                "The clientMessageId is already bound to different canonical input",
                "conflict",
              );
            }
            if (lineageService !== undefined)
              await withRequiredLineage(context, activity, true);
            return Object.freeze({
              schemaVersion: 1 as const,
              status: "EXISTING" as const,
              message: existingMessage,
            });
          }
          const sequence = current.lastSequence + 1;
          const createdAt = options.time.now();
          const lineageRef = canonicalLineage(execution);
          await messagingRepository.insertInboundMessage(transaction, {
            messageId: candidateMessageId,
            conversationId: current.conversationId,
            sequence,
            administratorAccountId: current.administratorAccountId,
            subjectAccountId: current.subjectAccountId,
            text: messageText,
            clientMessageId,
            acceptedInputDigest: digest,
            createdAt,
            lineageContextRef: lineageRef,
          });
          await messagingRepository.updateConversationLastSequence(transaction, {
            conversationId: current.conversationId,
            sequence,
          });
          const message = await messagingRepository.readMessage(
            transaction,
            candidateMessageId,
          );
          if (message === undefined) {
            throw messagingProblem(
              "messaging.repository_invalid",
              "Inbound MessageFact was not materialized",
              "The current inbound insert could not be read back",
              "integrity",
              "manual",
            );
          }
          await options.inboundConsumer.commit(context, { message, preparation });
          await options.evidence.recordRequired(context, {
            evidenceKind: "messaging.inbound.accepted",
            evidenceContractVersion: "messaging.v1",
            subjectRef: message.messageId,
            objectRef: message.conversationId,
            factRef: digest,
            retentionClass: "retained",
            sensitivity: "operational",
          });
          if (lineageService !== undefined)
            await withRequiredLineage(context, activity, true);
          return Object.freeze({
            schemaVersion: 1 as const,
            status: "ACCEPTED" as const,
            message,
          });
        }),
      );
    });
  };

  const listMessages = async (input: ListMessagesInput): Promise<MessagePage> => {
    const conversation = await getConversationForAdministrator(input.administratorId);
    if (conversation === undefined) {
      throw messagingProblem(
        "messaging.conversation_not_ready",
        "Subject Chat is not initialized",
        "The current Administrator has no built-in Subject Chat conversation",
        "unavailable",
        "after-change",
      );
    }
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw messagingProblem(
        "messaging.invalid_input",
        "Messaging request is invalid",
        "limit must be an integer from 1 through 100",
      );
    }
    let afterSequence = 0;
    if (input.cursor !== undefined) {
      const cursor = decodeMessageCursor(input.cursor);
      if (cursor.conversationId !== conversation.conversationId) {
        throw messagingProblem(
          "messaging.cursor_invalid",
          "Message cursor is invalid",
          "The cursor belongs to another current conversation",
          "conflict",
        );
      }
      afterSequence = cursor.sequence;
    }
    const messages = await options.persistence.read((context) =>
      useRepositoryReadTransaction(context, (transaction) =>
        messagingRepository.readMessagesPage(
          transaction,
          conversation.conversationId,
          afterSequence,
          limit,
        ),
      ),
    );
    return Object.freeze({
      schemaVersion: 1 as const,
      conversationId: conversation.conversationId,
      messages,
      ...(messages.length === limit
        ? {
            nextCursor: encodeMessageCursor(
              conversation.conversationId,
              messages[messages.length - 1]!.sequence,
            ),
          }
        : {}),
    });
  };

  const listPendingInboundWithinTransaction = async (
    transaction: PersistenceMutationTransactionContext,
    input: {
      readonly conversationId: CanonicalConversationId;
      readonly afterSequence: number;
      readonly throughSequence?: number;
    },
  ): Promise<readonly MessageFact[]> =>
    useRepositoryMutationTransaction(transaction, (databaseTransaction) =>
      messagingRepository.queryMessages(
        databaseTransaction,
        input.conversationId,
        input.afterSequence,
        input.throughSequence,
      ),
    );

  const listInboundMessages = async (input: {
    readonly conversationId: CanonicalConversationId;
    readonly afterSequence: number;
    readonly throughSequence?: number;
  }): Promise<readonly MessageFact[]> => {
    if (
      parseCanonicalConversationId(input.conversationId) === undefined ||
      !Number.isSafeInteger(input.afterSequence) ||
      input.afterSequence < 0 ||
      (input.throughSequence !== undefined &&
        (!Number.isSafeInteger(input.throughSequence) || input.throughSequence < 0))
    ) {
      throw messagingProblem(
        "messaging.invalid_input",
        "Messaging request is invalid",
        "The inbound message sequence range is invalid",
      );
    }
    return options.persistence.read((context) =>
      useRepositoryReadTransaction(context, (databaseTransaction) =>
        messagingRepository.queryMessages(
          databaseTransaction,
          input.conversationId,
          input.afterSequence,
          input.throughSequence,
        ),
      ),
    );
  };

  const materializeOutboundWithinTransaction = async (
    transaction: PersistenceMutationTransactionContext,
    input: MaterializeOutboundInput,
  ): Promise<MessageFact> => {
    const communicationCommitId = parseCommunicationCommitId(
      input.communicationCommitId,
    );
    if (communicationCommitId === undefined) {
      throw messagingProblem(
        "messaging.invalid_input",
        "Messaging request is invalid",
        "communicationCommitId must be a UUIDv7 CommunicationCommitId",
      );
    }
    const outboundText = inputText(input.text, "text", 65_536);
    return useRepositoryMutationTransaction(
      transaction,
      async (databaseTransaction) => {
        const conversationRaw =
          await messagingRepository.readCommunicationConversationId(
            databaseTransaction,
            communicationCommitId,
          );
        const conversationId = parseCanonicalConversationId(conversationRaw);
        if (conversationId === undefined) {
          throw messagingProblem(
            "messaging.communication_not_found",
            "CommunicationCommit was not found",
            "The local outbound fact requires a current CommunicationCommit",
            "conflict",
          );
        }
        const existing = await messagingRepository.readOutboundByCommunicationCommit(
          databaseTransaction,
          communicationCommitId,
        );
        if (existing !== undefined) return existing;
        const conversation = await messagingRepository.queryConversationById(
          databaseTransaction,
          conversationId,
          true,
        );
        if (conversation === undefined) {
          throw messagingProblem(
            "messaging.conversation_not_ready",
            "Subject Chat is not initialized",
            "The CommunicationCommit target conversation is not current",
            "conflict",
          );
        }
        const sequence = conversation.lastSequence + 1;
        const messageId = createCanonicalMessageId();
        const createdAt = options.time.now();
        await messagingRepository.insertOutboundMessage(databaseTransaction, {
          messageId,
          conversationId: conversation.conversationId,
          sequence,
          subjectAccountId: conversation.subjectAccountId,
          administratorAccountId: conversation.administratorAccountId,
          text: outboundText,
          communicationCommitId,
          createdAt,
          lineageContextRef: canonicalLineage(execution),
        });
        await messagingRepository.updateConversationLastSequence(databaseTransaction, {
          conversationId: conversation.conversationId,
          sequence,
        });
        const written = await messagingRepository.readMessage(
          databaseTransaction,
          messageId,
        );
        if (written === undefined) {
          throw messagingProblem(
            "messaging.repository_invalid",
            "Outbound MessageFact was not materialized",
            "The current outbound insert could not be read back",
            "integrity",
            "manual",
          );
        }
        return written;
      },
    );
  };

  const materializeOutbound = async (
    input: MaterializeOutboundInput,
  ): Promise<MessageFact> =>
    activityMutation(options, "messaging.outbound.materialize", () =>
      options.persistence.mutate((transaction) =>
        materializeOutboundWithinTransaction(transaction, input),
      ),
    );

  return Object.freeze({
    ensureCurrentConversation,
    getConversationForAdministrator,
    acceptInbound,
    listMessages,
    listInboundMessages,
    listPendingInboundWithinTransaction,
    materializeOutboundWithinTransaction,
    materializeOutbound,
  });
}
