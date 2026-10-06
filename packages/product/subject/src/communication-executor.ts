// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Owns Expression and outbound execution after a CommunicationCommit.
 * @module communication-executor
 */

import {
  createUuidV7Id,
  snapshotCanonicalJson,
  type CanonicalJsonValue,
} from "@heptalogos/foundation-contracts";
import type { GenerationResult, InvocationSpec } from "@heptalogos/ai-runtime";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import { useRepositoryMutationTransaction } from "@heptalogos/persistence/repository";
import {
  SUBJECT_EXPRESSION_CONFIGURATION_DEFINITION_ID,
  type CommunicationCommit,
  type Reaction,
  type SubjectReactionOutcome,
  type SubjectServiceOptions,
  type SubjectExpressionConfigV1,
} from "./contracts.js";
import { currentActivityRequired } from "./authority.js";
import {
  subjectRepository,
  lineageJson,
  type SubjectRepository,
} from "./repository.js";
import { subjectProblem } from "./problems.js";

/** Current expression output schema; expression cannot introduce authority. */
export const expressionOutputSchema: CanonicalJsonValue = Object.freeze({
  type: "object",
  properties: {
    schemaVersion: { const: 1 },
    text: { type: "string", minLength: 1, maxLength: 65_536 },
  },
  required: ["schemaVersion", "text"],
  additionalProperties: false,
});

/** Owns Expression realization and outbound/re-entry after a commit. */
export interface SubjectCommunicationExecutor {
  /** Expresses one committed communication and completes its Reaction. */
  completeCommunication(
    reaction: Reaction,
    communication: CommunicationCommit,
  ): Promise<SubjectReactionOutcome>;
  /** Reconciles a committed Reaction that already has its outbound fact. */
  finalizeReplied(reaction: Reaction): Promise<void>;
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw subjectProblem(
      "subject.expression_invalid",
      "Subject expression is invalid",
      field + " must be an object",
      "validation",
    );
  }
  return value as Record<string, unknown>;
}

/** Creates the direct Subject communication executor. */
export function createSubjectCommunicationExecutor(
  options: SubjectServiceOptions,
  repository: SubjectRepository = subjectRepository,
): SubjectCommunicationExecutor {
  const expressionGeneration = async (
    communication: CommunicationCommit,
  ): Promise<GenerationResult> => {
    const activity = currentActivityRequired(options);
    const binding = await options.aiRuntime.getModelBinding("subject.expression");
    if (binding === undefined || !binding.enabled) {
      throw subjectProblem(
        "subject.expression_unavailable",
        "Subject expression binding is unavailable",
        "The current subject.expression ModelBinding is not usable",
        "unavailable",
        "after-change",
      );
    }
    const configuration = await options.configuration.getEffectiveRevision(
      SUBJECT_EXPRESSION_CONFIGURATION_DEFINITION_ID,
      {
        schemaVersion: 1,
        resourceKind: "subject",
        resourceId: communication.subjectId,
      },
    );
    if (configuration === undefined) {
      throw subjectProblem(
        "subject.expression_configuration_unavailable",
        "Subject expression configuration is unavailable",
        "An active subject.expression.v1 ConfigurationRevision is required",
        "unavailable",
        "after-change",
      );
    }
    const expressionConfig =
      configuration.value as unknown as SubjectExpressionConfigV1;
    const contextProjection = snapshotCanonicalJson({
      schemaVersion: 1,
      communicationCommitId: communication.communicationCommitId,
      conversationId: communication.conversationId,
      semanticContent: communication.semanticContent as unknown as CanonicalJsonValue,
    }).value;
    const spec: InvocationSpec = {
      schemaVersion: 1,
      invocationId: createUuidV7Id("InvocationId"),
      ownerActivityRef: activity.activityId,
      modelBindingId: binding.modelBindingId,
      expectedBindingRevision: binding.revision,
      contextProjection,
      messages: Object.freeze([
        Object.freeze({
          role: "system" as const,
          text: "Express the committed Subject reply as bounded text. Do not add actions.",
        }),
        Object.freeze({
          role: "user" as const,
          text: communication.semanticContent.content,
        }),
      ]),
      objective: "Express the already committed semantic reply.",
      outputSchema: expressionOutputSchema,
      budget: { maxOutputTokens: expressionConfig.maxOutputTokens },
      lineageContextRef: options.execution.createLineageContextRef(),
    };
    return options.aiRuntime.invoke(spec);
  };

  const finalizeCommittedReaction = async (
    transaction: PersistenceInternalTransaction,
    context: PersistenceMutationTransactionContext,
    reaction: Reaction,
    communication: CommunicationCommit,
  ): Promise<void> => {
    const now = options.time.now();
    await repository.advanceMailbox(transaction, {
      conversationId: reaction.conversationId,
      throughSequence: reaction.observedThroughSequence,
      reactionId: reaction.reactionId,
      now,
      lineageContextRef: lineageJson(options.execution),
    });
    await repository.markReplied(transaction, {
      reactionId: reaction.reactionId,
      now,
      lineageContextRef: lineageJson(options.execution),
    });
    await options.evidence.recordRequired(context, {
      evidenceKind: "subject.outbound.materialized",
      evidenceContractVersion: "subject.v1",
      subjectRef: reaction.reactionId,
      objectRef: communication.communicationCommitId,
      retentionClass: "retained",
      sensitivity: "operational",
    });
  };

  const finalizeReplied = async (reaction: Reaction): Promise<void> =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (transaction) => {
        const current = await repository.readReaction(
          transaction,
          reaction.reactionId,
          true,
        );
        if (current === undefined || current.state === "REPLIED") return;
        if (current.state !== "COMMUNICATION_COMMITTED") {
          throw subjectProblem(
            "subject.reaction_state_invalid",
            "Subject Reaction cannot be finalized as replied",
            "Only a CommunicationCommit-backed Reaction can become REPLIED",
            "integrity",
          );
        }
        const communication = await repository.readCommunication(
          transaction,
          reaction.reactionId,
        );
        if (communication === undefined) {
          throw subjectProblem(
            "subject.communication_missing",
            "Subject communication commit is unavailable",
            "A COMMUNICATION_COMMITTED Reaction has no CommunicationCommit",
            "integrity",
          );
        }
        await finalizeCommittedReaction(transaction, context, reaction, communication);
      }),
    );

  const parseExpressionText = (value: CanonicalJsonValue): string => {
    const parsed = record(value, "expression output");
    if (
      parsed.schemaVersion !== 1 ||
      typeof parsed.text !== "string" ||
      parsed.text.trim() === ""
    ) {
      throw subjectProblem(
        "subject.expression_invalid",
        "Subject expression is invalid",
        "The current expression output is not bounded non-empty text",
        "validation",
      );
    }
    return parsed.text;
  };

  const materializeExpression = async (
    reaction: Reaction,
    communication: CommunicationCommit,
    generation: GenerationResult,
  ): Promise<"REPLIED"> =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, async (transaction) => {
        const hasOutbound = await repository.outboundExists(
          transaction,
          communication.communicationCommitId,
        );
        const current = await repository.readReaction(
          transaction,
          reaction.reactionId,
          true,
        );
        if (current === undefined) {
          throw subjectProblem(
            "subject.reaction_missing",
            "Subject Reaction is unavailable",
            "The committed communication Reaction could not be read",
            "integrity",
          );
        }
        if (current.state === "REPLIED") return "REPLIED";
        if (current.state !== "COMMUNICATION_COMMITTED") {
          throw subjectProblem(
            "subject.reaction_state_invalid",
            "Subject Reaction cannot materialize communication",
            "Only a COMMUNICATION_COMMITTED Reaction may materialize outbound text",
            "integrity",
          );
        }
        if (!hasOutbound) {
          await options.aiRuntime.assertGenerationAdmissibleForCommit(
            context,
            generation,
          );
          await options.messaging.materializeOutboundWithinTransaction(context, {
            communicationCommitId: communication.communicationCommitId,
            text: parseExpressionText(generation.candidate),
          });
        }
        await finalizeCommittedReaction(transaction, context, reaction, communication);
        return "REPLIED" as const;
      }),
    );

  const completeCommunication = async (
    reaction: Reaction,
    communication: CommunicationCommit,
  ): Promise<SubjectReactionOutcome> => {
    const expression = await expressionGeneration(communication);
    await materializeExpression(reaction, communication, expression);
    return Object.freeze({ accepted: true, status: "REPLIED" });
  };

  return Object.freeze({ completeCommunication, finalizeReplied });
}
