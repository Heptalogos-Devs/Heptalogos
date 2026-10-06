// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Composes the Subject semantic owner and its RuntimeKernel handler.
 * @module service
 */

import {
  UUID_V7_PATTERN,
  formatInstant,
  type CanonicalJsonValue,
  type Instant,
  type WorkItemId,
} from "@heptalogos/foundation-contracts";
import {
  createContractVersion,
  type MicroSystemDefinition,
  type RuntimeContractData,
  type RuntimeWorkHandler,
  type RuntimeWorkHandlerInvocation,
  type WorkHandlerPayloadContract,
  type WorkHandlerProvisionDescriptor,
} from "@heptalogos/runtime-kernel";
import type { WorkErrorClassifier } from "@heptalogos/work-queue";
import {
  SUBJECT_REACTION_CONTRIBUTION_ID,
  SUBJECT_REACTION_QUEUE_PROFILE_ID,
  SUBJECT_REACTION_RESOURCE_CLASS,
  SUBJECT_SYSTEM_ID,
  type SubjectReactionDefinitionOptions,
  type SubjectReactionOutcome,
  type SubjectService,
  type SubjectServiceOptions,
} from "./contracts.js";
import { createSubjectAuthority } from "./authority.js";
import { createSubjectCommunicationExecutor } from "./communication-executor.js";
import { createSubjectReactionExecutor } from "./reaction-executor.js";
import { subjectRepository } from "./repository.js";

/** Current bounded conversation proposal schema; the model does not commit it. */
export const conversationReactionProposalSchema: CanonicalJsonValue = Object.freeze({
  oneOf: [
    {
      type: "object",
      properties: {
        schemaVersion: { const: 1 },
        kind: { const: "COMMUNICATE" },
        semanticContent: {
          type: "object",
          properties: {
            schemaVersion: { const: 1 },
            content: { type: "string", minLength: 1, maxLength: 65_536 },
          },
          required: ["schemaVersion", "content"],
          additionalProperties: false,
        },
      },
      required: ["schemaVersion", "kind", "semanticContent"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        schemaVersion: { const: 1 },
        kind: { const: "NO_COMMUNICATION" },
      },
      required: ["schemaVersion", "kind"],
      additionalProperties: false,
    },
  ],
}) as unknown as CanonicalJsonValue;

export { expressionOutputSchema } from "./communication-executor.js";

const SUBJECT_REACTION_PAYLOAD_SCHEMA: WorkHandlerPayloadContract = Object.freeze({
  version: 1,
  schema: Object.freeze({
    type: "object",
    properties: {
      schemaVersion: { const: 1 },
      conversationId: { type: "string", pattern: UUID_V7_PATTERN },
      acceptedMessageId: { type: "string", pattern: UUID_V7_PATTERN },
    },
    required: ["schemaVersion", "conversationId", "acceptedMessageId"],
    additionalProperties: false,
  }),
});

const SUBJECT_REACTION_OUTCOME_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    accepted: { const: true },
    status: { enum: ["NOOP", "SUPERSEDED", "NO_COMMUNICATION", "REPLIED"] },
  },
  required: ["accepted", "status"],
  additionalProperties: false,
});

function futureRetryTime(time: SubjectServiceOptions["time"]): Instant {
  return formatInstant(new Date(Date.parse(time.now()) + 1_000));
}

/** Creates the Subject semantic owner over current Product foundations. */
export function createSubjectService(options: SubjectServiceOptions): SubjectService {
  const repository = subjectRepository;
  const authority = createSubjectAuthority(options, repository);
  const communication = createSubjectCommunicationExecutor(options, repository);
  const reaction = createSubjectReactionExecutor(
    options,
    authority,
    communication,
    repository,
  );

  const reactionDescriptor: WorkHandlerProvisionDescriptor = Object.freeze({
    contributionId: SUBJECT_REACTION_CONTRIBUTION_ID,
    contractVersion: createContractVersion("subject.reaction.v1"),
    payloadContracts: Object.freeze([SUBJECT_REACTION_PAYLOAD_SCHEMA]),
    outcomeSchema: SUBJECT_REACTION_OUTCOME_SCHEMA,
    queueProfileId: SUBJECT_REACTION_QUEUE_PROFILE_ID,
    resourceAdmissionClass: SUBJECT_REACTION_RESOURCE_CLASS,
    configurationBindingPolicy: "LATEST_COMPATIBLE_AT_ATTEMPT",
    restoreReplayClass: "RECONCILE_REQUIRED",
  });

  const executeReaction = async (input: {
    readonly workItemId: WorkItemId;
    readonly payload: unknown;
  }): Promise<SubjectReactionOutcome> => {
    return options.execution.runActivity(
      {
        kind: "subject.reaction.execute",
        importance: "significant",
        retentionClass: "retained",
        sensitivity: "operational",
      },
      async (activity) => {
        await options.persistence.mutate((context) =>
          options.lineage.retainCurrent(context, activity),
        );
        try {
          const result = await reaction.execute(input.workItemId, input.payload);
          await options.persistence.mutate((context) =>
            options.lineage.completeCurrent(context, activity, {
              endedAt: options.time.now(),
              outcome: "SUCCEEDED",
            }),
          );
          return result;
        } catch (error) {
          await options.persistence
            .mutate((context) =>
              options.lineage.completeCurrent(context, activity, {
                endedAt: options.time.now(),
                outcome: "FAILED",
              }),
            )
            .catch(() => undefined);
          throw error;
        }
      },
    );
  };

  const createWorkErrorClassifier = (): WorkErrorClassifier => ({
    classify(input) {
      const reasonCode = input.failure.reasonCode;
      if (
        reasonCode === "subject.primary_unavailable" ||
        reasonCode === "subject.cognition_disabled" ||
        reasonCode === "subject.cognition_runtime_unavailable" ||
        reasonCode === "subject.cognition_run_failed" ||
        reasonCode === "subject.cognition_timeout" ||
        reasonCode === "subject.expression_unavailable" ||
        reasonCode === "ai.gateway_unavailable" ||
        reasonCode === "ai.model_binding_unavailable" ||
        reasonCode === "ai.model_binding_stale" ||
        reasonCode === "ai.generation_mismatch"
      ) {
        return {
          kind: "RETRY",
          retryClass: "dependency-unavailable",
          reasonCode,
          notBefore: futureRetryTime(options.time),
        };
      }
      return {
        kind: "TERMINAL",
        retryClass:
          reasonCode === "subject.expression_invalid" ||
          reasonCode === "subject.reaction_proposal_invalid"
            ? "invalid"
            : "permanent",
        reasonCode,
      };
    },
  });

  const reactionHandler: RuntimeWorkHandler = Object.freeze({
    async execute(input: RuntimeWorkHandlerInvocation) {
      return {
        outcome: (await executeReaction({
          workItemId: input.workItemId,
          payload: input.payload,
        })) as unknown as RuntimeContractData,
      };
    },
  });

  const serviceImplementation: SubjectService = {
    ensureCurrent: () => authority.ensureCurrent(),
    getAuthority: () => authority.getAuthority(),
    getStatus: () => authority.getStatus(),
    start: (input) => authority.start(input),
    stop: (input) => authority.stop(input),
    prepareAcceptedInbound: (input) => authority.prepareAcceptedInbound(input),
    commitAcceptedInbound: (transaction, input) =>
      authority.commitAcceptedInbound(transaction, input),
    executeReaction,
    createWorkErrorClassifier,
    reactionDescriptor,
    reactionHandler,
  };
  return Object.freeze(serviceImplementation);
}

/** Registers the one current Subject Reaction handler with RuntimeKernel. */
export function createSubjectReactionDefinition(
  options: SubjectReactionDefinitionOptions,
): MicroSystemDefinition {
  const definition: MicroSystemDefinition = {
    microSystemId: SUBJECT_SYSTEM_ID,
    role: "system-service",
    generation: {
      productGenerationId: options.productGenerationId,
      packageGenerationId: options.packageGenerationId,
    },
    operatingModes: ["NORMAL", "SAFE", "MAINTENANCE", "EMERGENCY_READ_ONLY"] as const,
    serviceRequirements: [],
    capabilityRequirements: [],
    serviceProvisions: [],
    capabilityProvisions: [],
    workHandlerProvisions: [options.service.reactionDescriptor],
    activate: async (context) => {
      context.publishWorkHandler(
        options.service.reactionDescriptor,
        options.service.reactionHandler,
      );
    },
  };
  return Object.freeze(definition);
}
