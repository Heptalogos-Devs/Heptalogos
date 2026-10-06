// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Owns one bounded Subject cognition episode through deterministic Review.
 * @module reaction-executor
 */

import {
  createReactionId,
  createCommunicationCommitId,
  digestCanonicalJson,
  parseCanonicalConversationId,
  parseCanonicalMessageId,
  snapshotCanonicalJson,
  type CanonicalConversationId,
  type CanonicalJsonValue,
  type CanonicalMessageId,
  type WorkItemId,
} from "@heptalogos/foundation-contracts";
import {
  useRepositoryMutationTransaction,
  useRepositoryReadTransaction,
} from "@heptalogos/persistence/repository";
import type {
  CommunicationCommit,
  ConversationCognitionInput,
  ConversationReactionProposal,
  Reaction,
  SubjectCognitionProposal,
  SubjectReactionOutcome,
  SubjectServiceOptions,
} from "./contracts.js";
import { currentActivityRequired, type SubjectAuthorityOwner } from "./authority.js";
import {
  conversationReactionProposal,
  lineageJson,
  subjectRepository,
  type SubjectRepository,
} from "./repository.js";
import type { SubjectCommunicationExecutor } from "./communication-executor.js";
import { subjectProblem } from "./problems.js";

interface ReactionProgress {
  readonly reaction: Reaction;
  readonly communication?: CommunicationCommit;
  readonly outbound: boolean;
}

type AcceptedProposalCommitResult =
  | { readonly kind: "SUPERSEDED" }
  | { readonly kind: "NO_COMMUNICATION" }
  | {
      readonly kind: "COMMUNICATION_COMMITTED";
      readonly communication: CommunicationCommit;
    };

/** Owns one bounded Subject cognition episode through deterministic Review. */
export interface SubjectReactionExecutor {
  /** Processes one queued Subject Reaction work item. */
  execute(workItemId: WorkItemId, payload: unknown): Promise<SubjectReactionOutcome>;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw subjectProblem(
      "subject.reaction_payload_invalid",
      "Subject Reaction payload is invalid",
      field + " must be an object",
      "validation",
    );
  }
  return value as Record<string, unknown>;
}

/** Creates the direct Subject Reaction executor over its semantic owners. */
export function createSubjectReactionExecutor(
  options: SubjectServiceOptions,
  authority: SubjectAuthorityOwner,
  communication: SubjectCommunicationExecutor,
  repository: SubjectRepository = subjectRepository,
): SubjectReactionExecutor {
  const acquireReaction = async (
    workItemId: WorkItemId,
    conversationId: CanonicalConversationId,
    acceptedMessageId: CanonicalMessageId,
  ): Promise<Reaction | undefined> => {
    const activity = currentActivityRequired(options);
    return options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (transaction) => {
        const currentAuthority = await repository.readAuthority(
          transaction,
          options.installationId,
          true,
        );
        if (currentAuthority === undefined) return undefined;
        const owned = await repository.readReactionByWorkItem(transaction, workItemId);
        if (owned !== undefined) {
          if (
            owned.state === "OPEN" &&
            (currentAuthority.desiredState !== "RUNNING" ||
              currentAuthority.authorityRevision !==
                owned.observedSubjectAuthorityRevision)
          ) {
            const now = options.time.now();
            await repository.supersedeReactionAndReleaseMailbox(transaction, {
              reactionId: owned.reactionId,
              conversationId: owned.conversationId,
              now,
              lineageContextRef: lineageJson(options.execution),
            });
            return repository.readReaction(transaction, owned.reactionId);
          }
          return owned;
        }
        if (currentAuthority.desiredState !== "RUNNING") return undefined;
        const mailbox = await repository.readMailbox(transaction, conversationId, true);
        if (mailbox === undefined) return undefined;
        if (mailbox.openReactionId !== undefined) {
          const current = await repository.readReaction(
            transaction,
            mailbox.openReactionId,
          );
          if (
            current !== undefined &&
            (current.state === "OPEN" || current.state === "COMMUNICATION_COMMITTED")
          ) {
            return current;
          }
          await repository.clearOpenReaction(transaction, {
            conversationId,
            reactionId: mailbox.openReactionId,
            now: options.time.now(),
            lineageContextRef: lineageJson(options.execution),
          });
        }
        const pending = await options.messaging.listPendingInboundWithinTransaction(
          context,
          {
            conversationId,
            afterSequence: mailbox.consumedThroughSequence,
          },
        );
        if (
          !pending.some((message) => message.messageId === acceptedMessageId) ||
          pending.length === 0
        ) {
          return undefined;
        }
        const observedThroughSequence = pending[pending.length - 1]!.sequence;
        const reactionId = createReactionId();
        const now = options.time.now();
        await repository.insertReaction(transaction, {
          reactionId,
          conversationId,
          mailboxRevision: mailbox.mailboxRevision,
          throughSequence: observedThroughSequence,
          authorityRevision: currentAuthority.authorityRevision,
          workItemId,
          activityId: activity.activityId,
          now,
          lineageContextRef: lineageJson(options.execution),
        });
        await repository.setOpenReaction(transaction, {
          conversationId,
          reactionId,
          now,
          lineageContextRef: lineageJson(options.execution),
        });
        return repository.readReaction(transaction, reactionId);
      }),
    );
  };

  const readProgress = async (reaction: Reaction): Promise<ReactionProgress> =>
    options.persistence.read((context) =>
      useRepositoryReadTransaction(context, async (transaction) => {
        const communicationCommit = await repository.readCommunication(
          transaction,
          reaction.reactionId,
        );
        const outbound =
          communicationCommit === undefined
            ? false
            : await repository.outboundExists(
                transaction,
                communicationCommit.communicationCommitId,
              );
        return Object.freeze({
          reaction,
          ...(communicationCommit === undefined
            ? {}
            : { communication: communicationCommit }),
          outbound,
        });
      }),
    );

  const contextProjection = async (reaction: Reaction): Promise<CanonicalJsonValue> => {
    const currentAuthority = await authority.getAuthority();
    const mailbox = await options.persistence.read((context) =>
      useRepositoryReadTransaction(context, (transaction) =>
        repository.readMailbox(transaction, reaction.conversationId),
      ),
    );
    if (mailbox === undefined) {
      throw subjectProblem(
        "subject.mailbox_missing",
        "Subject mailbox is unavailable",
        "The current Reaction has no ConversationMailbox",
        "integrity",
      );
    }
    const messages = await options.messaging.listInboundMessages({
      conversationId: reaction.conversationId,
      afterSequence: mailbox.consumedThroughSequence,
      throughSequence: reaction.observedThroughSequence,
    });
    const selected = messages.filter(
      (message) =>
        message.sequence > mailbox.consumedThroughSequence &&
        message.sequence <= reaction.observedThroughSequence,
    );
    return snapshotCanonicalJson({
      schemaVersion: 1,
      subjectId: currentAuthority.subjectId,
      desiredState: currentAuthority.desiredState,
      authorityRevision: currentAuthority.authorityRevision,
      conversationId: reaction.conversationId,
      mailboxRevision: reaction.observedMailboxRevision,
      messages: selected.map((message) => ({
        sequence: message.sequence,
        messageId: message.messageId,
        text: message.text,
      })),
    }).value;
  };

  const primaryGeneration = async (
    reaction: Reaction,
  ): Promise<SubjectCognitionProposal> => {
    const context = await contextProjection(reaction);
    const currentAuthority = await authority.getAuthority();
    const input: ConversationCognitionInput = {
      subjectId: currentAuthority.subjectId,
      reactionId: reaction.reactionId,
      contextProjection: context,
    };
    return options.cognitionRuntime.runConversationReaction(input);
  };

  const commitAcceptedProposal = async (
    reaction: Reaction,
    generation: SubjectCognitionProposal,
    proposal: ConversationReactionProposal,
  ): Promise<AcceptedProposalCommitResult> =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (transaction) => {
        const currentReaction = await repository.readReaction(
          transaction,
          reaction.reactionId,
          true,
        );
        const currentAuthority = await repository.readAuthority(
          transaction,
          options.installationId,
          true,
        );
        const mailbox = await repository.readMailbox(
          transaction,
          reaction.conversationId,
          true,
        );
        if (
          currentReaction === undefined ||
          currentAuthority === undefined ||
          mailbox === undefined
        ) {
          throw subjectProblem(
            "subject.commit_context_missing",
            "Subject commit context is unavailable",
            "The current Reaction, Subject authority, or mailbox could not be read",
            "integrity",
          );
        }
        if (currentReaction.state !== "OPEN") {
          if (currentReaction.state === "SUPERSEDED")
            return { kind: "SUPERSEDED" as const };
          if (currentReaction.state === "NO_COMMUNICATION")
            return { kind: "NO_COMMUNICATION" as const };
          const existing = await repository.readCommunication(
            transaction,
            reaction.reactionId,
          );
          if (existing !== undefined)
            return {
              kind: "COMMUNICATION_COMMITTED" as const,
              communication: existing,
            };
          throw subjectProblem(
            "subject.communication_missing",
            "Subject communication commit is unavailable",
            "The current Reaction state has no CommunicationCommit",
            "integrity",
          );
        }
        if (
          currentAuthority.desiredState !== "RUNNING" ||
          currentAuthority.authorityRevision !==
            reaction.observedSubjectAuthorityRevision ||
          mailbox.mailboxRevision !== reaction.observedMailboxRevision ||
          mailbox.openReactionId !== reaction.reactionId
        ) {
          const now = options.time.now();
          await repository.supersedeReactionAndReleaseMailbox(transaction, {
            reactionId: reaction.reactionId,
            conversationId: reaction.conversationId,
            now,
            lineageContextRef: lineageJson(options.execution),
          });
          await options.evidence.recordRequired(context, {
            evidenceKind: "subject.reaction.superseded",
            evidenceContractVersion: "subject.v1",
            subjectRef: currentAuthority.subjectId,
            objectRef: reaction.reactionId,
            factRef: generation.provenance.runId,
            retentionClass: "retained",
            sensitivity: "operational",
          });
          return { kind: "SUPERSEDED" as const };
        }
        await options.aiRuntime.assertModelBindingAdmissibleForCommit(
          context,
          generation.provenance,
        );
        await options.configuration.assertActiveRevisionForCommit(context, {
          definitionId: "subject.cognition.runtime.v1",
          scopeRef: {
            schemaVersion: 1,
            resourceKind: "subject",
            resourceId: currentAuthority.subjectId,
          },
          revisionId: generation.provenance.configurationRevisionId,
        });
        await options.configuration.assertActiveRevisionForCommit(context, {
          definitionId: "ai.gateway.transport.v1",
          scopeRef: {
            schemaVersion: 1,
            resourceKind: "installation",
            resourceId: options.installationId,
          },
          revisionId: generation.provenance.gatewayConfigurationRevisionId,
        });
        const now = options.time.now();
        if (proposal.kind === "NO_COMMUNICATION") {
          await repository.markNoCommunication(transaction, {
            conversationId: reaction.conversationId,
            throughSequence: reaction.observedThroughSequence,
            reactionId: reaction.reactionId,
            now,
            lineageContextRef: lineageJson(options.execution),
          });
          await options.evidence.recordRequired(context, {
            evidenceKind: "subject.reaction.no-communication.accepted",
            evidenceContractVersion: "subject.v1",
            subjectRef: currentAuthority.subjectId,
            objectRef: reaction.reactionId,
            factRef: generation.provenance.runId,
            retentionClass: "retained",
            sensitivity: "operational",
          });
          return { kind: "NO_COMMUNICATION" as const };
        }

        const semanticContent = proposal.semanticContent;
        const semanticContentDigest = digestCanonicalJson(
          "subject.semantic-content.v1",
          snapshotCanonicalJson(semanticContent as unknown as CanonicalJsonValue).value,
        ).hex;
        const communicationCommitId = createCommunicationCommitId();
        await repository.insertCommunicationCommit(transaction, {
          communicationCommitId,
          reactionId: reaction.reactionId,
          subjectId: currentAuthority.subjectId,
          authorityRevision: currentAuthority.authorityRevision,
          mailboxRevision: mailbox.mailboxRevision,
          conversationId: reaction.conversationId,
          semanticContent: JSON.stringify(semanticContent),
          semanticContentDigest,
          primaryCognitionProvenance: JSON.stringify(generation.provenance),
          now,
          lineageContextRef: lineageJson(options.execution),
        });
        const written = await repository.readCommunication(
          transaction,
          reaction.reactionId,
        );
        if (written === undefined) {
          throw subjectProblem(
            "subject.communication_missing",
            "CommunicationCommit was not materialized",
            "The current communication acceptance could not be read after insertion",
            "integrity",
          );
        }
        await repository.markCommunicationCommitted(transaction, {
          reactionId: reaction.reactionId,
          now,
          lineageContextRef: lineageJson(options.execution),
        });
        await options.evidence.recordRequired(context, {
          evidenceKind: "subject.communication.commit",
          evidenceContractVersion: "subject.v1",
          subjectRef: currentAuthority.subjectId,
          objectRef: reaction.reactionId,
          factRef: written.communicationCommitId,
          retentionClass: "retained",
          sensitivity: "operational",
        });
        return {
          kind: "COMMUNICATION_COMMITTED" as const,
          communication: written,
        };
      }),
    );

  const processReaction = async (
    workItemId: WorkItemId,
    payload: unknown,
  ): Promise<SubjectReactionOutcome> => {
    const parsed = record(payload, "reaction payload");
    const conversationId = parseCanonicalConversationId(parsed.conversationId);
    const acceptedMessageId = parseCanonicalMessageId(parsed.acceptedMessageId);
    if (
      parsed.schemaVersion !== 1 ||
      conversationId === undefined ||
      acceptedMessageId === undefined
    ) {
      throw subjectProblem(
        "subject.reaction_payload_invalid",
        "Subject Reaction payload is invalid",
        "The current Reaction trigger requires one conversationId and acceptedMessageId",
        "validation",
      );
    }
    const reaction = await acquireReaction(
      workItemId,
      conversationId,
      acceptedMessageId,
    );
    if (reaction === undefined)
      return Object.freeze({ accepted: true, status: "NOOP" });

    const progress = await readProgress(reaction);
    if (progress.outbound) {
      await communication.finalizeReplied(reaction);
      return Object.freeze({ accepted: true, status: "REPLIED" });
    }
    if (reaction.state === "NO_COMMUNICATION")
      return Object.freeze({ accepted: true, status: "NO_COMMUNICATION" });
    if (reaction.state === "SUPERSEDED")
      return Object.freeze({ accepted: true, status: "SUPERSEDED" });
    if (progress.communication !== undefined) {
      return communication.completeCommunication(reaction, progress.communication);
    }
    if (reaction.state !== "OPEN") {
      throw subjectProblem(
        "subject.reaction_state_invalid",
        "Subject Reaction cannot progress",
        "The current Reaction has no admissible open or committed communication state",
        "integrity",
      );
    }

    const primary = await primaryGeneration(reaction);
    const reviewed = conversationReactionProposal(primary.proposal);
    const accepted = await commitAcceptedProposal(reaction, primary, reviewed);
    if (accepted.kind === "SUPERSEDED")
      return Object.freeze({ accepted: true, status: "SUPERSEDED" });
    if (accepted.kind === "NO_COMMUNICATION")
      return Object.freeze({ accepted: true, status: "NO_COMMUNICATION" });
    return communication.completeCommunication(reaction, accepted.communication);
  };

  return Object.freeze({ execute: processReaction });
}
