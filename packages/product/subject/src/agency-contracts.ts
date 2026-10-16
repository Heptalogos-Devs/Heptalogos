// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Exact adopted native deliveries and their actual network outcomes.
 * @module agency-contracts
 */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceInternalTransaction } from "@heptalogos/persistence/repository";
import type { PersistenceService } from "@heptalogos/persistence";
import type { LifeActivity } from "./contracts.js";
const object = { additionalProperties: false } as const;
const ref = Type.String({ minLength: 1, maxLength: 2048 });
const index = Type.Integer({ minimum: 0, maximum: 65535 });
/** Complete prepared source payload; native SDK owns its representation. */
export const preparedDeliverySchema = Type.Object(
  {
    channel: ref,
    accountId: ref,
    to: ref,
    replyToId: Type.Optional(Type.Union([ref, Type.Null()])),
    replyToMode: Type.Optional(
      Type.Union([Type.Literal("first"), Type.Literal("all")]),
    ),
    threadId: Type.Optional(Type.Union([ref, Type.Number(), Type.Null()])),
    nativeIntentId: ref,
    runId: ref,
    preparedBatch: Type.Record(Type.String(), Type.Unknown()),
  },
  object,
);
/** Deterministic adoption request, supplied by the trusted native channel adapter. */
export type PreparedDelivery = Static<typeof preparedDeliverySchema>;
/** Host reference is durable and non-secret; possession alone grants no send permission. */
export const adoptedDeliverySchema = Type.Object({ reference: ref }, object);
/** One actual post-policy network payload, retaining its original source position. */
export const deliveryPayloadSchema = Type.Object(
  {
    sourceIndex: index,
    kind: Type.Union([
      Type.Literal("text"),
      Type.Literal("media"),
      Type.Literal("payload"),
    ]),
    text: Type.Optional(Type.String({ maxLength: 131072 })),
    mediaUrl: Type.Optional(ref),
    payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    deliveryPartIndex: Type.Optional(index),
    deliveryPartCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 65536 })),
  },
  object,
);
/** Authorization always carries the adopted recipient and exact actual part. */
export const authorizeDeliverySchema = Type.Object(
  {
    reference: ref,
    channel: ref,
    accountId: ref,
    to: ref,
    replyToId: Type.Optional(Type.Union([ref, Type.Null()])),
    threadId: Type.Optional(Type.Union([ref, Type.Number(), Type.Null()])),
    deliveryQueueId: ref,
    payload: deliveryPayloadSchema,
  },
  object,
);
/** Outcomes distinguish definite pre-send rejection from ambiguous network execution. */
export const deliveryOutcomeSchema = Type.Union([
  Type.Object(
    {
      state: Type.Literal("accepted"),
      platformMessageId: ref,
      acceptedAt: Type.String({
        pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$",
      }),
    },
    object,
  ),
  Type.Object({ state: Type.Literal("not_sent"), code: ref }, object),
  Type.Object({ state: Type.Literal("failed"), code: ref }, object),
  Type.Object({ state: Type.Literal("uncertain"), code: ref }, object),
]);
/** A callback records only the attempt that actually crossed or approached the network point. */
export const recordDeliverySchema = Type.Object(
  {
    reference: ref,
    sourceIndex: index,
    partIndex: index,
    attemptId: ref,
    outcome: deliveryOutcomeSchema,
  },
  object,
);
/** Begin returns the prior accepted receipt or permits exactly one network attempt. */
export const beginDeliveryResultSchema = Type.Union([
  Type.Object({ action: Type.Literal("send"), attemptId: ref }, object),
  Type.Object(
    { action: Type.Literal("return"), outcome: deliveryOutcomeSchema },
    object,
  ),
]);
/** Current trusted run and source permission, rechecked by Host before every effect. */
export interface AgencyRunAuthority {
  readonly activity: LifeActivity;
  readonly role: "main" | "worker";
  readonly actorEntityRef: string;
  readonly conversationRef: string;
  readonly sourceRefs: readonly string[];
  /** Canonical selected messages verified by the Host's Messaging owner. */
  readonly messageSources: readonly {
    readonly sourceRef: string;
    readonly conversationRef: string;
  }[];
}
/** Agency owns semantic adoption and effect facts; it starts no sender or retry worker. */
export interface AgencyOptions {
  readonly persistence: PersistenceService;
  readonly now: () => string;
  /** Runs after the physical fact is durable, outside its write transaction. */
  readonly onDeliveryRecorded?: (fact: AgencyDeliveryFact) => Promise<void>;
  /** External propagation checks run before the short send-point transaction. */
  readonly checkSources: (runId: string) => Promise<void>;
  readonly authority: (
    runId: string,
    recipient: { channel: string; accountId: string; to: string },
    transaction?: PersistenceInternalTransaction,
  ) => Promise<AgencyRunAuthority>;
}
/** A physical attempt fact; an accepted platform receipt does not imply human reading. */
export interface AgencyDeliveryFact {
  readonly subjectId: string;
  readonly activityId: string;
  readonly runId: string;
  readonly reference: string;
  readonly nativeIntentId: string;
  readonly channel: string;
  readonly accountId: string;
  readonly to: string;
  readonly sourceIndex: number;
  readonly partIndex: number;
  readonly attemptId: string;
  readonly recordedAt: string;
  readonly outcome: Static<typeof deliveryOutcomeSchema>;
}
