// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only
/** Trusted Activity dispatch contracts; a message cannot supply grants or prompts.
 * @module activity-dispatch-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
const object = { additionalProperties: false } as const;
const uuid = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});
/** Exact selected real messages for an already adopted Activity. */
export const activityDispatchInputSchema = Type.Object(
  {
    requestId: uuid,
    subjectId: uuid,
    activityId: uuid,
    conversationRef: Type.String({
      pattern: "^conversation:heptalogos:[0-9a-f-]{36}$",
    }),
    messageRefs: Type.Array(uuid, { minItems: 1, maxItems: 64, uniqueItems: true }),
  },
  object,
);
/** The public request is a selection, never model instructions or authority. */
export type ActivityDispatchInput = Static<typeof activityDispatchInputSchema>;
/** Bounded status of one irreversible native dispatch opportunity. */
export const activityDispatchResultSchema = Type.Object(
  {
    requestId: uuid,
    nativeRunId: uuid,
    sessionKey: Type.String(),
    promptDigest: Type.String(),
    state: Type.Union([
      Type.Literal("dispatching"),
      Type.Literal("completed"),
      Type.Literal("failed"),
      Type.Literal("uncertain"),
    ]),
    replayed: Type.Boolean(),
    result: Type.Optional(Type.Unknown()),
    code: Type.Optional(Type.String()),
  },
  object,
);
/** Saved dispatch result. Retrying this identity never issues another native call. */
export type ActivityDispatchResult = Static<typeof activityDispatchResultSchema>;
/** Host-selected inputs passed to the existing public native agent CLI adapter. */
export interface NativeActivityParams {
  readonly agentId: string;
  readonly sessionKey: string;
  readonly message: string;
  readonly idempotencyKey: string;
  readonly timeout: number;
  readonly deliver: true;
  readonly channel: "heptalogos-qq";
  readonly accountId: string;
  readonly to: string;
}
/** The official SDK owns actual execution and delivery, including its final result. */
export type NativeActivityDispatch = (
  params: NativeActivityParams,
) => Promise<
  { status: "terminal"; result: unknown } | { status: "unresolved"; code: string }
>;
