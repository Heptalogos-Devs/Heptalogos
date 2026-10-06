// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Defines the current persistent Subject authority, reaction, and handler contracts.
 * @module contracts
 */

import {
  createContributionId,
  createMicroSystemId,
  createMessagingPlatformId,
  type CanonicalConversationId,
  type CanonicalMessageId,
  type CommunicationCommitId,
  type CanonicalJsonValue,
  type InstallationId,
  type Instant,
  type PackageGenerationId,
  type ProductGenerationId,
  type ReactionId,
  type SubjectId,
  type WorkItemId,
} from "@heptalogos/foundation-contracts";
import type {
  ExecutionContextRuntime,
  ExecutionLineageService,
  LineageContextRef,
} from "@heptalogos/execution-lineage";
import type { AIRuntimeService } from "@heptalogos/ai-runtime";
import type { EvidenceService } from "@heptalogos/evidence";
import type { MessagingService, MessageFact } from "@heptalogos/messaging";
import type {
  PersistenceMutationTransactionContext,
  PersistenceService,
} from "@heptalogos/persistence";
import type {
  RuntimeWorkHandler,
  WorkHandlerProvisionDescriptor,
  WorkHandlerTarget,
} from "@heptalogos/runtime-kernel";
import type { TimeService } from "@heptalogos/time-service";
import type {
  ConfigurationDefinition,
  ConfigurationDefinitionId,
  ConfigurationRevisionId,
  ConfigurationService,
} from "@heptalogos/configuration";
import type {
  GatewayProfileId,
  ModelInvocationProtocol,
  ModelBindingId,
  ModelProfileId,
} from "@heptalogos/ai-runtime";
import { Type } from "@heptalogos/schema-runtime/typebox";
import type {
  PreparedWorkCreation,
  WorkErrorClassifier,
  WorkQueueService,
} from "@heptalogos/work-queue";

/** The current logical platform identifier retained for Subject Chat context. */
export const SUBJECT_CHAT_PLATFORM = createMessagingPlatformId(
  "heptalogos-subject-chat",
);
/** The Subject MicroSystem identity. */
export const SUBJECT_SYSTEM_ID = createMicroSystemId("product.subject");
/** The one current Subject Reaction WorkHandler contribution. */
export const SUBJECT_REACTION_CONTRIBUTION_ID = createContributionId(
  "subject.reaction.execute",
);
/** The one current Subject Reaction WorkQueue profile. */
export const SUBJECT_REACTION_QUEUE_PROFILE_ID = createMicroSystemId(
  "work.subject-reaction",
) as never;
/** The one current Subject Reaction resource admission class. */
export const SUBJECT_REACTION_RESOURCE_CLASS = createMicroSystemId(
  "resource.subject-reaction",
) as never;

/** Stable current Subject Expression configuration-definition identity. */
export const SUBJECT_EXPRESSION_CONFIGURATION_DEFINITION_ID =
  "subject.expression.v1" as ConfigurationDefinitionId;

/** Product-owned budget used by the independent Expression invocation. */
export interface SubjectExpressionConfigV1 {
  readonly schemaVersion: 1;
  readonly maxOutputTokens: number;
}

/** JSON Schema for the current Subject Expression configuration. */
export const subjectExpressionConfigSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    maxOutputTokens: Type.Integer({ minimum: 1, maximum: 4_096 }),
  },
  { additionalProperties: false },
);

/** Product Subject owner-provided Expression configuration definition. */
export const subjectExpressionConfigurationDefinition: ConfigurationDefinition =
  Object.freeze({
    schemaVersion: 1 as const,
    definitionId: SUBJECT_EXPRESSION_CONFIGURATION_DEFINITION_ID,
    owner: "product.subject",
    version: 1,
    scopeKind: "SUBJECT" as const,
    valueSchema: subjectExpressionConfigSchema as unknown as CanonicalJsonValue,
    classification: "SUBJECT_CONFIG" as const,
    visibility: "ADVANCED" as const,
    manageability: "EDITABLE" as const,
    activation: "LIVE" as const,
    sensitivity: "INTERNAL" as const,
    defaultAuthority: "PRODUCT_DEFAULT" as const,
    consumerRefs: Object.freeze(["product.subject.expression"]),
  });

/** Explicit Product default pinned on first Subject materialization. */
export const DEFAULT_SUBJECT_EXPRESSION_CONFIG: SubjectExpressionConfigV1 =
  Object.freeze({ schemaVersion: 1, maxOutputTokens: 256 });

/** Stable current Subject cognition runtime configuration-definition identity. */
export const SUBJECT_COGNITION_CONFIGURATION_DEFINITION_ID =
  "subject.cognition.runtime.v1" as ConfigurationDefinitionId;

/** Product-owned bounds that constrain one OpenClaw cognition run. */
export interface SubjectCognitionConfigV1 {
  readonly schemaVersion: 1;
  readonly enabled: boolean;
  readonly maxOutputTokens: number;
  readonly runTimeoutMs: number;
  readonly maxContextBytes: number;
}

/** JSON Schema for the current Subject cognition runtime configuration. */
export const subjectCognitionConfigSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    enabled: Type.Boolean(),
    maxOutputTokens: Type.Integer({ minimum: 1, maximum: 4_096 }),
    runTimeoutMs: Type.Integer({ minimum: 1_000, maximum: 120_000 }),
    maxContextBytes: Type.Integer({ minimum: 4_096, maximum: 262_144 }),
  },
  { additionalProperties: false },
);

/** Product Subject owner-provided cognition runtime configuration definition. */
export const subjectCognitionConfigurationDefinition: ConfigurationDefinition =
  Object.freeze({
    schemaVersion: 1 as const,
    definitionId: SUBJECT_COGNITION_CONFIGURATION_DEFINITION_ID,
    owner: "product.subject",
    version: 1,
    scopeKind: "SUBJECT" as const,
    valueSchema: subjectCognitionConfigSchema as unknown as CanonicalJsonValue,
    classification: "SUBJECT_CONFIG" as const,
    visibility: "ADVANCED" as const,
    manageability: "EDITABLE" as const,
    activation: "LIVE" as const,
    sensitivity: "INTERNAL" as const,
    defaultAuthority: "PRODUCT_DEFAULT" as const,
    consumerRefs: Object.freeze([
      "product.subject.cognition",
      "product-host.subject-openclaw",
    ]),
  });

/** Explicit Product default pinned on first Subject cognition materialization. */
export const DEFAULT_SUBJECT_COGNITION_CONFIG: SubjectCognitionConfigV1 = Object.freeze(
  {
    schemaVersion: 1,
    enabled: true,
    maxOutputTokens: 256,
    runTimeoutMs: 60_000,
    maxContextBytes: 65_536,
  },
);

/** Durable Subject authority; desired state is the only persistent lifecycle intent. */
export interface SubjectAuthorityRecord {
  readonly schemaVersion: 1;
  readonly subjectId: SubjectId;
  readonly installationId: InstallationId;
  readonly desiredState: "STOPPED" | "RUNNING";
  readonly authorityRevision: number;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly lineageContextRef: LineageContextRef;
}

/** A bounded current dependency blocker in the Subject status projection. */
export interface SubjectBlocker {
  readonly code: string;
  readonly detail: string;
}

/** Subject-owned current status projection derived from intent and live facts. */
export interface SubjectStatus {
  readonly schemaVersion: 1;
  readonly subjectId: SubjectId;
  readonly desiredState: "STOPPED" | "RUNNING";
  readonly actualState:
    | "STOPPED"
    | "STARTING"
    | "READY"
    | "ACTIVE"
    | "DEGRADED"
    | "BLOCKED"
    | "STOPPING"
    | "FAILED";
  readonly authorityRevision: number;
  readonly blockers: readonly SubjectBlocker[];
}

/** Semantic content accepted for a bounded conversation communication. */
export interface ConversationSemanticContent {
  readonly schemaVersion: 1;
  readonly content: string;
}

/** Bounded current-slice cognition proposal; not the total Subject behavior contract. */
export type ConversationReactionProposal =
  | {
      readonly schemaVersion: 1;
      readonly kind: "COMMUNICATE";
      readonly semanticContent: ConversationSemanticContent;
    }
  | {
      readonly schemaVersion: 1;
      readonly kind: "NO_COMMUNICATION";
    };

/** Bounded context supplied from the canonical Subject owner to its runtime. */
export interface ConversationCognitionInput {
  readonly subjectId: SubjectId;
  readonly reactionId: ReactionId;
  readonly contextProjection: CanonicalJsonValue;
}

/** Public terminal status returned by the OpenClaw agent.wait contract. */
export type SubjectCognitionTerminalStatus = "ok" | "error" | "timeout";

/** Stable provider provenance captured from one accepted cognition proposal. */
export interface SubjectCognitionProvenance {
  readonly schemaVersion: 1;
  readonly provider: "openclaw";
  readonly runtimeGeneration: string;
  readonly openclawVersion: string;
  readonly profile: "subject";
  readonly agentId: string;
  readonly sessionKey: string;
  readonly runId: string;
  readonly modelProvider: string;
  readonly modelIdentifier: string;
  readonly modelBindingId: ModelBindingId;
  readonly bindingRevision: number;
  readonly modelProfileId: ModelProfileId;
  readonly modelProfileGeneration: number;
  readonly gatewayProfileId: GatewayProfileId;
  readonly configurationRevisionId: ConfigurationRevisionId;
  readonly gatewayConfigurationRevisionId: ConfigurationRevisionId;
  readonly protocol: ModelInvocationProtocol;
  readonly terminalToolName:
    "heptalogos_propose_communication" | "heptalogos_complete_without_communication";
  readonly terminalStatus: SubjectCognitionTerminalStatus;
}

/** One bounded proposal plus the provider evidence needed by deterministic Review. */
export interface SubjectCognitionProposal {
  readonly proposal: ConversationReactionProposal;
  readonly provenance: SubjectCognitionProvenance;
}

/** Current Subject-side cognition runtime readiness projection. */
export interface SubjectCognitionRuntimeReadiness {
  readonly schemaVersion: 1;
  readonly state: "READY" | "BLOCKED";
  readonly blockers: readonly SubjectBlocker[];
}

/** Narrow mechanics port between Subject semantics and its cognition harness. */
export interface SubjectCognitionRuntime {
  /** Runs one terminal cognition reaction and returns its typed proposal. */
  runConversationReaction(
    input: ConversationCognitionInput,
  ): Promise<SubjectCognitionProposal>;
  /** Reports readiness for the current effective runtime projection. */
  readiness(): Promise<SubjectCognitionRuntimeReadiness>;
}

/** One current durable Reaction workspace owned by Subject. */
export interface Reaction {
  readonly schemaVersion: 1;
  readonly reactionId: ReactionId;
  readonly conversationId: CanonicalConversationId;
  readonly observedMailboxRevision: number;
  readonly observedThroughSequence: number;
  readonly observedSubjectAuthorityRevision: number;
  readonly state:
    | "OPEN"
    | "SUPERSEDED"
    | "NO_COMMUNICATION"
    | "COMMUNICATION_COMMITTED"
    | "REPLIED"
    | "FAILED";
  readonly ownerWorkItemId: WorkItemId;
  readonly ownerActivityRef: { readonly schemaVersion: 1; readonly activityId: string };
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
  readonly lineageContextRef: LineageContextRef;
}

/** Immutable accepted communication Authority and primary generation provenance. */
export interface CommunicationCommit {
  readonly schemaVersion: 1;
  readonly communicationCommitId: CommunicationCommitId;
  readonly reactionId: ReactionId;
  readonly subjectId: SubjectId;
  readonly subjectAuthorityRevision: number;
  readonly mailboxRevision: number;
  readonly conversationId: CanonicalConversationId;
  readonly purpose: "reply";
  readonly semanticContent: ConversationSemanticContent;
  readonly semanticContentDigest: string;
  readonly primaryCognitionProvenance: SubjectCognitionProvenance;
  readonly committedAt: Instant;
  readonly lineageContextRef: LineageContextRef;
}

/** Ephemeral prepared Subject work attached atomically to one accepted message. */
export interface PreparedSubjectInbound {
  readonly subjectId: SubjectId;
  readonly authorityRevision: number;
  readonly work: PreparedWorkCreation;
}

/** Readiness facts supplied by ProductHost's current system owners. */
export interface SubjectDependencyReadiness {
  readonly usable: boolean;
  readonly blockers: readonly SubjectBlocker[];
}

/** Input for normal Management Subject desired-state actions. */
export interface SubjectStateActionInput {
  readonly subjectId: SubjectId | string;
  readonly expectedAuthorityRevision: number;
}

/** Bounded result returned by the Reaction WorkHandler. */
export interface SubjectReactionOutcome {
  readonly accepted: true;
  readonly status: "NOOP" | "SUPERSEDED" | "NO_COMMUNICATION" | "REPLIED";
}

/** Current Subject service surface consumed by ProductHost and Management. */
export interface SubjectService {
  /** Ensures the one persistent Subject authority exists. */
  ensureCurrent(): Promise<SubjectAuthorityRecord>;
  /** Reads the durable Subject authority record. */
  getAuthority(): Promise<SubjectAuthorityRecord>;
  /** Reads the current Subject status projection. */
  getStatus(): Promise<SubjectStatus>;
  /** Commits desired RUNNING state under an authority revision fence. */
  start(input: SubjectStateActionInput): Promise<SubjectStatus>;
  /** Commits desired STOPPED state under an authority revision fence. */
  stop(input: SubjectStateActionInput): Promise<SubjectStatus>;
  /** Prepares a Reaction WorkItem for one accepted inbound fact. */
  prepareAcceptedInbound(input: {
    readonly conversationId: CanonicalConversationId;
    readonly acceptedMessageId: CanonicalMessageId;
  }): Promise<PreparedSubjectInbound>;
  /** Commits mailbox advancement and the prepared Reaction WorkItem atomically. */
  commitAcceptedInbound(
    transaction: PersistenceMutationTransactionContext,
    input: {
      readonly message: MessageFact;
      readonly preparation: PreparedSubjectInbound;
    },
  ): Promise<void>;
  /** Executes one generation-pinned Reaction work item. */
  executeReaction(input: {
    readonly workItemId: WorkItemId;
    readonly payload: unknown;
  }): Promise<SubjectReactionOutcome>;
  /** Creates the Subject-specific WorkItem failure classifier. */
  createWorkErrorClassifier(): WorkErrorClassifier;
  /** Describes the current Subject Reaction contribution. */
  readonly reactionDescriptor: WorkHandlerProvisionDescriptor;
  /** Exposes the current Subject Reaction handler implementation. */
  readonly reactionHandler: RuntimeWorkHandler;
}

/** Composition dependencies for the Subject owner. */
export interface SubjectServiceOptions {
  /** Current Installation identity. */
  readonly installationId: InstallationId;
  /** Host-fenced canonical persistence owner. */
  readonly persistence: PersistenceService;
  /** Current Activity and lineage context owner. */
  readonly execution: ExecutionContextRuntime;
  /** Retained Activity and causation owner. */
  readonly lineage: ExecutionLineageService;
  /** Required retained evidence owner. */
  readonly evidence: EvidenceService;
  /** Current time owner. */
  readonly time: TimeService;
  /** Canonical Messaging semantic owner. */
  readonly messaging: MessagingService;
  /** Narrow WorkQueue creation seam. */
  readonly workQueue: Pick<WorkQueueService, "prepareCreate" | "commitPrepared">;
  /** AIRuntime Expression invocation and commit-fence owner. */
  readonly aiRuntime: AIRuntimeService;
  /** Subject cognition mechanics port; the Product Host supplies OpenClaw. */
  readonly cognitionRuntime: SubjectCognitionRuntime;
  /** Current managed Product configuration owner. */
  readonly configuration: ConfigurationService;
  /** Current hard prerequisite projection supplied by ProductHost. */
  readonly getHardPrerequisites: () => Promise<SubjectDependencyReadiness>;
  /** Generation-pinned target for the Subject Reaction handler. */
  readonly reactionTarget: WorkHandlerTarget;
}

/** Options for registering the Subject-owned Reaction handler in RuntimeKernel. */
export interface SubjectReactionDefinitionOptions {
  readonly productGenerationId: ProductGenerationId;
  readonly packageGenerationId: PackageGenerationId;
  readonly service: SubjectService;
}
