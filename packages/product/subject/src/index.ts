// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Public current Subject authority, reaction contracts, and service.
 * @packageDocumentation
 */

export {
  SUBJECT_CHAT_PLATFORM,
  SUBJECT_REACTION_CONTRIBUTION_ID,
  SUBJECT_REACTION_QUEUE_PROFILE_ID,
  SUBJECT_REACTION_RESOURCE_CLASS,
  SUBJECT_SYSTEM_ID,
  SUBJECT_EXPRESSION_CONFIGURATION_DEFINITION_ID,
  SUBJECT_COGNITION_CONFIGURATION_DEFINITION_ID,
  subjectExpressionConfigSchema,
  subjectCognitionConfigSchema,
  subjectExpressionConfigurationDefinition,
  subjectCognitionConfigurationDefinition,
  DEFAULT_SUBJECT_EXPRESSION_CONFIG,
  DEFAULT_SUBJECT_COGNITION_CONFIG,
} from "./contracts.js";
export {
  conversationReactionProposalSchema,
  expressionOutputSchema,
  createSubjectReactionDefinition,
  createSubjectService,
} from "./service.js";
export type {
  CommunicationCommit,
  ConversationReactionProposal,
  ConversationSemanticContent,
  PreparedSubjectInbound,
  Reaction,
  SubjectAuthorityRecord,
  SubjectBlocker,
  SubjectDependencyReadiness,
  SubjectReactionDefinitionOptions,
  SubjectReactionOutcome,
  SubjectService,
  SubjectServiceOptions,
  SubjectExpressionConfigV1,
  SubjectCognitionConfigV1,
  ConversationCognitionInput,
  SubjectCognitionProvenance,
  SubjectCognitionProposal,
  SubjectCognitionRuntime,
  SubjectCognitionRuntimeReadiness,
  SubjectCognitionTerminalStatus,
  SubjectStateActionInput,
  SubjectStatus,
} from "./contracts.js";
export { subjectProblem } from "./problems.js";
