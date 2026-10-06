// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Public current Messaging contracts and canonical Subject Chat service.
 * @packageDocumentation
 */

export {
  SUBJECT_CHAT_PLATFORM_ID,
  type AcceptInboundInput,
  type AcceptedInboundPreparationInput,
  type EnsureConversationInput,
  type InboundMessageAcceptance,
  type ListMessagesInput,
  type MaterializeOutboundInput,
  type MessageDirection,
  type MessageFact,
  type MessagePage,
  type MessagingActorKind,
  type MessagingConversation,
  type MessagingInboundConsumer,
  type MessagingService,
  type MessagingServiceOptions,
} from "./contracts.js";
export { encodeMessageCursor } from "./cursor.js";
export { createMessagingService } from "./service.js";
export { messagingProblem } from "./problems.js";
