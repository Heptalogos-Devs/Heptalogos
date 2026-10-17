// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Consumes one durable pending message at a trusted native scheduling opportunity.
 * @module activity-opportunity
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { GatewayScope } from "./gateway-contracts.js";
/** The Channel supplies only its actual account and conversation, never grants or prompts. */
export const activityOpportunityInputSchema = Type.Object(
  {
    accountId: Type.String(),
    conversation: Type.Object(
      {
        kind: Type.Union([Type.Literal("group"), Type.Literal("direct")]),
        id: Type.String(),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
/** A notification wake never reads messages or completes pending delivery work. */
export const activityOpportunityResultSchema = Type.Object(
  {
    decision: Type.Union([Type.Literal("defer"), Type.Literal("considered")]),
    reactionId: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);
/** Native channel opportunities join the same Subject Reactor as world and task notifications. */
export function createActivityOpportunity(options: {
  readonly scope: () => Promise<GatewayScope>;
  readonly enabled: () => Promise<boolean>;
  readonly wake: (input: {
    subjectId: string;
    naturalOpportunity: boolean;
  }) => Promise<{ reactionId?: string }>;
}) {
  return async (
    input: Static<typeof activityOpportunityInputSchema>,
  ): Promise<Static<typeof activityOpportunityResultSchema>> => {
    const current = await options.scope();
    const grant = current.conversations.find(
      (c) =>
        c.kind === input.conversation.kind &&
        c.conversationId === input.conversation.id,
    );
    if (
      current.accountId !== input.accountId ||
      !grant?.receive ||
      !grant.observe ||
      !(await options.enabled())
    )
      return { decision: "defer" };
    const actual = await options.wake({
      subjectId: current.subjectId,
      naturalOpportunity: true,
    });
    return {
      decision: "considered",
      ...(actual.reactionId ? { reactionId: actual.reactionId } : {}),
    };
  };
}
