// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Owns Subject lifecycle authority, admission, and revision fences.
 * @module authority
 */

import {
  createUuidV7Id,
  parseCanonicalConversationId,
  parseCanonicalMessageId,
  parseSubjectId,
  type CanonicalConversationId,
  type CanonicalMessageId,
} from "@heptalogos/foundation-contracts";
import type { ExecutionContext } from "@heptalogos/execution-lineage";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";
import {
  useRepositoryMutationTransaction,
  useRepositoryReadTransaction,
} from "@heptalogos/persistence/repository";
import {
  SUBJECT_REACTION_QUEUE_PROFILE_ID,
  SUBJECT_REACTION_RESOURCE_CLASS,
  type PreparedSubjectInbound,
  type SubjectAuthorityRecord,
  type SubjectDependencyReadiness,
  type SubjectService,
  type SubjectServiceOptions,
  type SubjectStateActionInput,
  type SubjectStatus,
} from "./contracts.js";
import {
  lineageJson,
  subjectRepository,
  type SubjectRepository,
} from "./repository.js";
import { subjectProblem } from "./problems.js";

/** Owns persistent Subject lifecycle, admission, and authority-fence semantics. */
export type SubjectAuthorityOwner = Pick<
  SubjectService,
  | "ensureCurrent"
  | "getAuthority"
  | "getStatus"
  | "start"
  | "stop"
  | "prepareAcceptedInbound"
> & {
  /** Commits the prepared inbound mailbox update in the caller transaction. */
  commitAcceptedInbound(
    transaction: PersistenceMutationTransactionContext,
    input: {
      readonly message: {
        readonly conversationId: CanonicalConversationId;
        readonly messageId: CanonicalMessageId;
      };
      readonly preparation: PreparedSubjectInbound;
    },
  ): Promise<void>;
};

/** Returns the current execution activity required by Subject mutation semantics. */
function currentActivityRequired(options: SubjectServiceOptions): ExecutionContext {
  const activity = options.execution.current();
  if (activity === undefined) {
    throw subjectProblem(
      "subject.activity_required",
      "Subject operation requires an Activity",
      "The current Subject operation must be attributed to Execution Lineage",
      "conflict",
      "after-change",
    );
  }
  return activity;
}

async function ownedActivityMutation<T>(
  options: SubjectServiceOptions,
  kind: string,
  operation: (activity: ExecutionContext, owned: boolean) => Promise<T>,
): Promise<T> {
  const existing = options.execution.current();
  if (existing !== undefined) return operation(existing, false);
  return options.execution.runActivity(
    {
      kind,
      importance: "significant",
      retentionClass: "retained",
      sensitivity: "operational",
    },
    (activity) => operation(activity, true),
  );
}

/** Creates the direct Subject authority owner over the supplied repository. */
export function createSubjectAuthority(
  options: SubjectServiceOptions,
  repository: SubjectRepository = subjectRepository,
): SubjectAuthorityOwner {
  const ensureCurrent = async (): Promise<SubjectAuthorityRecord> =>
    ownedActivityMutation(
      options,
      "subject.authority.initialized",
      async (activity, owned) =>
        options.persistence.mutate((context) =>
          useRepositoryMutationTransaction(context, async (transaction) => {
            if (owned) await options.lineage.retainCurrent(context, activity);
            const existing = await repository.readAuthority(
              transaction,
              options.installationId,
              true,
            );
            if (existing !== undefined) {
              if (owned) {
                await options.evidence.recordRequired(context, {
                  evidenceKind: "subject.authority.read",
                  evidenceContractVersion: "subject.v1",
                  subjectRef: existing.subjectId,
                  retentionClass: "retained",
                  sensitivity: "operational",
                });
                await options.lineage.completeCurrent(context, activity, {
                  endedAt: options.time.now(),
                  outcome: "SUCCEEDED",
                });
              }
              return existing;
            }
            const subjectId = createUuidV7Id("SubjectId");
            const now = options.time.now();
            await repository.insertAuthority(transaction, {
              subjectId,
              installationId: options.installationId,
              now,
              lineageContextRef: lineageJson(options.execution),
            });
            const current = await repository.readAuthority(
              transaction,
              options.installationId,
              true,
            );
            if (current === undefined) {
              throw subjectProblem(
                "subject.authority_missing",
                "Subject authority was not initialized",
                "The current Subject authority could not be read after initialization",
                "integrity",
              );
            }
            if (owned) {
              await options.evidence.recordRequired(context, {
                evidenceKind: "subject.authority.created",
                evidenceContractVersion: "subject.v1",
                subjectRef: current.subjectId,
                retentionClass: "retained",
                sensitivity: "operational",
              });
              await options.lineage.completeCurrent(context, activity, {
                endedAt: options.time.now(),
                outcome: "SUCCEEDED",
              });
            }
            return current;
          }),
        ),
    );

  const getAuthority = async (): Promise<SubjectAuthorityRecord> => {
    const authority = await options.persistence.read((context) =>
      useRepositoryReadTransaction(context, (transaction) =>
        repository.readAuthority(transaction, options.installationId),
      ),
    );
    if (authority === undefined) {
      throw subjectProblem(
        "subject.authority_missing",
        "Subject authority is unavailable",
        "The current Product Host has not initialized Subject authority",
        "unavailable",
        "after-change",
      );
    }
    return authority;
  };

  const getStatus = async (): Promise<SubjectStatus> => {
    const authority = await getAuthority();
    const dependencies: SubjectDependencyReadiness =
      await options.getHardPrerequisites();
    const hasOpenReaction = await options.persistence.read((context) =>
      useRepositoryReadTransaction(context, (transaction) =>
        repository.hasOpenReactionForInstallation(transaction, options.installationId),
      ),
    );
    let actualState: SubjectStatus["actualState"];
    const blockers = authority.desiredState === "RUNNING" ? dependencies.blockers : [];
    if (authority.desiredState === "STOPPED") {
      actualState = hasOpenReaction ? "STOPPING" : "STOPPED";
    } else if (!dependencies.usable) {
      actualState = "BLOCKED";
    } else {
      actualState = hasOpenReaction ? "ACTIVE" : "READY";
    }
    return Object.freeze({
      schemaVersion: 1 as const,
      subjectId: authority.subjectId,
      desiredState: authority.desiredState,
      actualState,
      authorityRevision: authority.authorityRevision,
      blockers: Object.freeze([...blockers]),
    });
  };

  const setDesiredState = async (
    desiredState: "STOPPED" | "RUNNING",
    input: SubjectStateActionInput,
  ): Promise<SubjectStatus> => {
    const subjectId = parseSubjectId(input.subjectId);
    if (
      subjectId === undefined ||
      !Number.isSafeInteger(input.expectedAuthorityRevision) ||
      input.expectedAuthorityRevision < 1
    ) {
      throw subjectProblem(
        "subject.invalid_action",
        "Subject state action is invalid",
        "subjectId and expectedAuthorityRevision are invalid",
        "validation",
      );
    }
    await ownedActivityMutation(
      options,
      "subject." + desiredState.toLowerCase(),
      async (activity, owned) =>
        options.persistence.mutate((context) =>
          useRepositoryMutationTransaction(context, async (transaction) => {
            if (owned) await options.lineage.retainCurrent(context, activity);
            const authority = await repository.readAuthority(
              transaction,
              options.installationId,
              true,
            );
            if (authority === undefined || authority.subjectId !== subjectId) {
              throw subjectProblem(
                "subject.not_found",
                "Subject was not found",
                "The requested SubjectId is not current for this Installation",
                "conflict",
              );
            }
            if (authority.authorityRevision !== input.expectedAuthorityRevision) {
              throw subjectProblem(
                "subject.authority_stale",
                "Subject authority is stale",
                "The requested Subject authorityRevision is no longer current",
                "conflict",
                "after-change",
              );
            }
            if (authority.desiredState !== desiredState) {
              await repository.updateDesiredState(transaction, {
                subjectId,
                desiredState,
                now: options.time.now(),
                lineageContextRef: lineageJson(options.execution),
              });
            }
            if (owned) {
              await options.evidence.recordRequired(context, {
                evidenceKind: "subject.authority.changed",
                evidenceContractVersion: "subject.v1",
                subjectRef: subjectId,
                factRef: desiredState,
                retentionClass: "retained",
                sensitivity: "operational",
              });
              await options.lineage.completeCurrent(context, activity, {
                endedAt: options.time.now(),
                outcome: "SUCCEEDED",
              });
            }
          }),
        ),
    );
    return getStatus();
  };

  const prepareAcceptedInbound = async (input: {
    readonly conversationId: CanonicalConversationId;
    readonly acceptedMessageId: CanonicalMessageId;
  }): Promise<PreparedSubjectInbound> => {
    if (
      parseCanonicalConversationId(input.conversationId) === undefined ||
      parseCanonicalMessageId(input.acceptedMessageId) === undefined
    ) {
      throw subjectProblem(
        "subject.invalid_input",
        "Subject Chat input is invalid",
        "conversationId and acceptedMessageId must be canonical UUIDv7 identities",
        "validation",
      );
    }
    const status = await getStatus();
    if (status.desiredState !== "RUNNING") {
      throw subjectProblem(
        "subject.not_running",
        "Subject is stopped",
        "Subject Chat cognition admission requires desiredState RUNNING",
        "conflict",
        "after-change",
      );
    }
    if (
      status.actualState === "READY" ||
      status.actualState === "ACTIVE" ||
      status.actualState === "DEGRADED"
    ) {
      const work = await options.workQueue.prepareCreate({
        target: options.reactionTarget,
        payload: Object.freeze({
          schemaVersion: 1,
          conversationId: input.conversationId,
          acceptedMessageId: input.acceptedMessageId,
        }),
        queueProfileId: SUBJECT_REACTION_QUEUE_PROFILE_ID,
        resourceAdmissionClass: SUBJECT_REACTION_RESOURCE_CLASS,
        partitionKey: input.conversationId,
        priority: 100,
      });
      return Object.freeze({
        subjectId: status.subjectId,
        authorityRevision: status.authorityRevision,
        work,
      });
    }
    throw subjectProblem(
      "subject.dependencies_unavailable",
      "Subject dependencies are unavailable",
      status.blockers.map((blocker) => blocker.code).join(", "),
      "unavailable",
      "after-change",
    );
  };

  const commitAcceptedInbound = async (
    transaction: PersistenceMutationTransactionContext,
    input: {
      readonly message: {
        readonly conversationId: CanonicalConversationId;
        readonly messageId: CanonicalMessageId;
      };
      readonly preparation: PreparedSubjectInbound;
    },
  ): Promise<void> => {
    await useRepositoryMutationTransaction(transaction, async (databaseTransaction) => {
      const authority = await repository.readAuthority(
        databaseTransaction,
        options.installationId,
        true,
      );
      if (
        authority === undefined ||
        authority.subjectId !== input.preparation.subjectId
      ) {
        throw subjectProblem(
          "subject.authority_missing",
          "Subject authority changed",
          "The accepted inbound fact no longer has the prepared Subject authority",
          "conflict",
          "after-change",
        );
      }
      if (authority.authorityRevision !== input.preparation.authorityRevision) {
        throw subjectProblem(
          "subject.stale_authority_revision",
          "Subject authority is stale",
          "The accepted inbound preparation was made under an older authorityRevision",
          "conflict",
          "after-change",
        );
      }
      if (authority.desiredState !== "RUNNING") {
        throw subjectProblem(
          "subject.not_running",
          "Subject is stopped",
          "The Subject stop fence closed cognition admission before commit",
          "conflict",
          "after-change",
        );
      }
      const mailbox = await repository.readMailbox(
        databaseTransaction,
        input.message.conversationId,
        true,
      );
      if (mailbox === undefined) {
        throw subjectProblem(
          "subject.mailbox_missing",
          "Subject mailbox is unavailable",
          "The built-in conversation has no current ConversationMailbox",
          "integrity",
        );
      }
      await repository.updateAcceptedInboundMailbox(databaseTransaction, {
        conversationId: input.message.conversationId,
        now: options.time.now(),
        lineageContextRef: lineageJson(options.execution),
      });
      await options.workQueue.commitPrepared(transaction, input.preparation.work);
      await options.evidence.recordRequired(transaction, {
        evidenceKind: "subject.mailbox.accepted",
        evidenceContractVersion: "subject.v1",
        subjectRef: authority.subjectId,
        objectRef: input.message.messageId,
        factRef: input.message.conversationId,
        retentionClass: "retained",
        sensitivity: "operational",
      });
    });
  };

  const owner: SubjectAuthorityOwner = {
    ensureCurrent,
    getAuthority,
    getStatus,
    start: (input) => setDesiredState("RUNNING", input),
    stop: (input) => setDesiredState("STOPPED", input),
    prepareAcceptedInbound,
    commitAcceptedInbound,
  };
  return Object.freeze(owner);
}

export { currentActivityRequired };
