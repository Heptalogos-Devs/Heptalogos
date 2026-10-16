// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/** Canonical messaging wire contracts, shared by Channel, Host and Life. @module contracts */
import { Type, type Static } from "@heptalogos/schema-runtime/typebox";
import type { PersistenceService } from "@heptalogos/persistence";

const key = Type.String({ minLength: 1, maxLength: 2048 });
const id = Type.String({
  pattern:
    "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
});
const timestamp = Type.String({
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$",
});
const optionalKey = Type.Optional(key);
const object = { additionalProperties: false } as const;
/** Native identifiers are strings at every boundary; no numeric coercion. */
export const nativeConversationSchema = Type.Object(
  {
    platform: key,
    accountId: key,
    conversationId: key,
    kind: Type.Union([Type.Literal("direct"), Type.Literal("group")]),
  },
  object,
);
export type NativeConversation = Static<typeof nativeConversationSchema>;
/** Authenticated author identity and presentation snapshot, never inferred from a nickname. */
export const messageAuthorSchema = Type.Object(
  {
    accountId: key,
    uid: optionalKey,
    entityRef: optionalKey,
    displayName: Type.Optional(Type.String()),
    groupCard: Type.Optional(Type.String()),
  },
  object,
);
/** A protected archive identifier, not a downloadable URL or inline raw envelope. */
export const attachmentSourceSchema = Type.Object(
  { kind: key, reference: key },
  object,
);
/** Ordered parts retain native representation references independently of interpretation. */
export const messagePartSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal("text"),
      Type.Literal("at"),
      Type.Literal("reply"),
      Type.Literal("image"),
      Type.Literal("sticker"),
      Type.Literal("face"),
      Type.Literal("audio"),
      Type.Literal("video"),
      Type.Literal("file"),
      Type.Literal("forward"),
      Type.Literal("share"),
      Type.Literal("card"),
      Type.Literal("location"),
      Type.Literal("unknown"),
    ]),
    text: Type.Optional(Type.String()),
    targetId: optionalKey,
    atAll: Type.Optional(Type.Boolean()),
    nativeDataRef: optionalKey,
    attachment: Type.Optional(attachmentSourceSchema),
    data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  object,
);
/** Unresolved replies/forwards retain the exact native target and optional source conversation. */
export const nativeMessageReferenceSchema = Type.Object(
  {
    kind: Type.Union([Type.Literal("reply"), Type.Literal("forward")]),
    nativeId: key,
    conversation: Type.Optional(nativeConversationSchema),
  },
  object,
);
/** Ingress, echo and history use precisely the same stable message identity. */
export const rawMessageFactSchema = Type.Object(
  {
    kind: Type.Literal("message"),
    conversation: nativeConversationSchema,
    nativeMessageId: key,
    direction: Type.Union([Type.Literal("INBOUND"), Type.Literal("OUTBOUND")]),
    author: messageAuthorSchema,
    platformSentAt: Type.Union([timestamp, Type.Null()]),
    receivedAt: timestamp,
    parts: Type.Array(messagePartSchema, { maxItems: 4096 }),
    references: Type.Array(nativeMessageReferenceSchema, { maxItems: 512 }),
    sourceEnvelopeRef: key,
    sourceEventRef: optionalKey,
  },
  object,
);
/** Unknown notices and requests remain concrete facts; unreliable events use a durable receipt id. */
export const rawPlatformEventSchema = Type.Object(
  {
    kind: Type.Literal("event"),
    conversation: nativeConversationSchema,
    eventKey: key,
    eventType: key,
    receivedAt: timestamp,
    platformSentAt: Type.Union([timestamp, Type.Null()]),
    sourceEnvelopeRef: key,
    actor: Type.Optional(messageAuthorSchema),
    targetNativeMessageId: optionalKey,
    effect: Type.Optional(Type.Union([Type.Literal("retract"), Type.Literal("none")])),
  },
  object,
);
/** Batch ingestion is atomic and contains no remote work. */
export const acceptFactsInputSchema = Type.Object(
  {
    facts: Type.Array(Type.Union([rawMessageFactSchema, rawPlatformEventSchema]), {
      minItems: 1,
      maxItems: 512,
    }),
  },
  object,
);
export type RawMessageFact = Static<typeof rawMessageFactSchema>;
export type RawPlatformEvent = Static<typeof rawPlatformEventSchema>;
export type AcceptFactsInput = Static<typeof acceptFactsInputSchema>;
/** Canonical fact payload remains immutable; lifecycle changes have separate event records. */
export const messageFactSchema = Type.Object(
  {
    ...rawMessageFactSchema.properties,
    schemaVersion: Type.Literal(1),
    messageId: id,
    conversationId: id,
    sequence: Type.Integer({ minimum: 1 }),
    lineageContextRef: Type.Object(
      {
        schemaVersion: Type.Literal(1),
        sourceActivityId: id,
        sourceInstanceId: id,
        sourceContinuityEpochId: id,
      },
      object,
    ),
  },
  object,
);
export type MessageFact = Static<typeof messageFactSchema>;
/** Atomic acceptance receipts include durable pending work references. */
export const acceptFactsResultSchema = Type.Object(
  {
    results: Type.Array(
      Type.Object(
        {
          kind: Type.Union([Type.Literal("message"), Type.Literal("event")]),
          status: Type.Union([Type.Literal("created"), Type.Literal("existing")]),
          factId: id,
          conversationId: id,
          sequence: Type.Optional(Type.Integer({ minimum: 1 })),
          pendingRef: id,
        },
        object,
      ),
    ),
  },
  object,
);
export type AcceptFactsResult = Static<typeof acceptFactsResultSchema>;
/** Attachment bytes live in a CAS owner; this owner holds references and acquisition state. */
export const attachmentSchema = Type.Object(
  {
    attachmentId: id,
    messageId: id,
    nodePath: optionalKey,
    referenceId: Type.Optional(id),
    partIndex: Type.Integer({ minimum: 0 }),
    source: attachmentSourceSchema,
    revision: Type.Integer({ minimum: 0 }),
    state: Type.Union([
      Type.Literal("pending"),
      Type.Literal("acquiring"),
      Type.Literal("available"),
      Type.Literal("failed"),
      Type.Literal("expired"),
      Type.Literal("retracted"),
    ]),
    cas: Type.Optional(
      Type.Object(
        {
          reference: key,
          sha256: Type.String({ pattern: "^[a-f0-9]{64}$" }),
          bytes: Type.Integer({ minimum: 0 }),
          mediaType: key,
        },
        object,
      ),
    ),
    failure: Type.Optional(
      Type.Object({ code: key, retryable: Type.Boolean() }, object),
    ),
  },
  object,
);
export type MessageAttachment = Static<typeof attachmentSchema>;
/** Compare-and-swap acquisition updates prevent stale workers from overwriting completed work. */
export const updateAttachmentInputSchema = Type.Object(
  {
    attachmentId: id,
    expectedRevision: Type.Integer({ minimum: 0 }),
    state: attachmentSchema.properties.state,
    cas: attachmentSchema.properties.cas,
    failure: attachmentSchema.properties.failure,
  },
  object,
);
export type UpdateAttachmentInput = Static<typeof updateAttachmentInputSchema>;
/** Forward nodes retain parent paths and claimed authors separately from authenticated envelope author. */
export const forwardNodeSchema = Type.Object(
  {
    path: key,
    parentPath: Type.Union([key, Type.Null()]),
    claimedAuthor: Type.Optional(messageAuthorSchema),
    platformSentAt: Type.Union([timestamp, Type.Null()]),
    parts: Type.Array(messagePartSchema),
  },
  object,
);
/** A durable expansion request can remain partial with explicit continuation and omitted coverage. */
export const messageReferenceSchema = Type.Object(
  {
    referenceId: id,
    messageId: id,
    ordinal: Type.Integer({ minimum: 0 }),
    target: nativeMessageReferenceSchema,
    revision: Type.Integer({ minimum: 0 }),
    state: Type.Union([
      Type.Literal("pending"),
      Type.Literal("available"),
      Type.Literal("partial"),
      Type.Literal("unavailable"),
    ]),
    resolvedMessageRef: Type.Optional(id),
    nodes: Type.Optional(Type.Array(forwardNodeSchema)),
    reason: optionalKey,
    continuation: optionalKey,
  },
  object,
);
export type MessageReference = Static<typeof messageReferenceSchema>;
/** Resolution is performed outside transactions; only its bounded result is committed here. */
export const updateReferenceInputSchema = Type.Object(
  {
    referenceId: id,
    expectedRevision: Type.Integer({ minimum: 0 }),
    state: messageReferenceSchema.properties.state,
    resolvedMessageRef: Type.Optional(id),
    nodes: Type.Optional(Type.Array(forwardNodeSchema, { maxItems: 4096 })),
    reason: optionalKey,
    continuation: optionalKey,
  },
  object,
);
export type UpdateReferenceInput = Static<typeof updateReferenceInputSchema>;
/** Read authorization is supplied by the trusted Host before any relevance selection. */
export const prepareReadInputSchema = Type.Object(
  {
    messageRefs: Type.Optional(Type.Array(id, { maxItems: 512 })),
    window: Type.Optional(
      Type.Object(
        {
          conversationId: id,
          afterSequence: Type.Integer({ minimum: 0 }),
          throughSequence: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        object,
      ),
    ),
    audience: Type.Object(
      { subjectId: key, conversationIds: Type.Array(id, { maxItems: 512 }) },
      object,
    ),
    budget: Type.Object(
      {
        maxMessages: Type.Integer({ minimum: 1, maximum: 512 }),
        maxBytes: Type.Integer({ minimum: 1, maximum: 16777216 }),
      },
      object,
    ),
  },
  object,
);
export type PrepareReadInput = Static<typeof prepareReadInputSchema>;
/** Safe material excludes protected raw/envelope references. It never records an Observation. */
const safePartSchema = Type.Object(
  {
    kind: messagePartSchema.properties.kind,
    text: Type.Optional(Type.String()),
    targetId: optionalKey,
    atAll: Type.Optional(Type.Boolean()),
    data: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  object,
);
export const readMessageMaterialSchema = Type.Object(
  {
    messageId: id,
    conversationId: id,
    sequence: Type.Integer({ minimum: 1 }),
    nativeMessageId: key,
    conversation: nativeConversationSchema,
    direction: rawMessageFactSchema.properties.direction,
    author: messageAuthorSchema,
    platformSentAt: Type.Union([timestamp, Type.Null()]),
    receivedAt: timestamp,
    lineageContextRef: messageFactSchema.properties.lineageContextRef,
    lifecycle: Type.Union([Type.Literal("present"), Type.Literal("retracted")]),
    withheld: Type.Boolean(),
    parts: Type.Array(safePartSchema),
    attachments: Type.Array(
      Type.Object(
        { ...attachmentSchema.properties, source: Type.Optional(Type.Never()) },
        object,
      ),
    ),
    references: Type.Array(
      Type.Object(
        {
          referenceId: id,
          ordinal: Type.Integer({ minimum: 0 }),
          target: nativeMessageReferenceSchema,
          state: messageReferenceSchema.properties.state,
          resolvedMessageRef: Type.Optional(id),
          nodes: Type.Optional(
            Type.Array(
              Type.Object(
                { ...forwardNodeSchema.properties, parts: Type.Array(safePartSchema) },
                object,
              ),
            ),
          ),
          reason: optionalKey,
          continuation: optionalKey,
        },
        object,
      ),
    ),
  },
  object,
);
export const prepareReadResultSchema = Type.Object(
  {
    materials: Type.Array(readMessageMaterialSchema),
    coverage: Type.Object(
      {
        complete: Type.Boolean(),
        returnedMessages: Type.Integer({ minimum: 0 }),
        bytes: Type.Integer({ minimum: 0 }),
      },
      object,
    ),
    omitted: Type.Array(
      Type.Object(
        {
          messageRef: id,
          reason: Type.Union([
            Type.Literal("not_found"),
            Type.Literal("not_authorized"),
            Type.Literal("message_budget"),
            Type.Literal("byte_budget"),
          ]),
        },
        object,
      ),
    ),
    nextSequence: Type.Optional(Type.Integer({ minimum: 0 })),
  },
  object,
);
export type PrepareReadResult = Static<typeof prepareReadResultSchema>;
/** Persist actual contact only after the consumer has really encountered the selected materials. */
export const recordContactInputSchema = Type.Object(
  {
    subjectId: key,
    contactId: key,
    messageRefs: Type.Array(id, { minItems: 1, maxItems: 512 }),
    observedAt: timestamp,
  },
  object,
);
export type RecordContactInput = Static<typeof recordContactInputSchema>;
/** Pending references survive process death until an explicit completion. */
export const pendingFactSchema = Type.Object(
  {
    pendingRef: id,
    kind: Type.Union([Type.Literal("message"), Type.Literal("event")]),
    factId: id,
    conversationId: id,
  },
  object,
);
export const listPendingInputSchema = Type.Object(
  {
    conversationId: Type.Optional(id),
    limit: Type.Integer({ minimum: 1, maximum: 512 }),
  },
  object,
);
export const listPendingResultSchema = Type.Object(
  { pending: Type.Array(pendingFactSchema) },
  object,
);
export const completePendingInputSchema = Type.Object(
  { pendingRefs: Type.Array(id, { minItems: 1, maxItems: 512 }) },
  object,
);
export const pendingAttachmentsInputSchema = Type.Object(
  {
    limit: Type.Integer({ minimum: 1, maximum: 512 }),
    states: Type.Optional(Type.Array(attachmentSchema.properties.state)),
  },
  object,
);
export const pendingAttachmentsResultSchema = Type.Object(
  { attachments: Type.Array(attachmentSchema) },
  object,
);
export const pendingReferencesResultSchema = Type.Object(
  { references: Type.Array(messageReferenceSchema) },
  object,
);
/** Persisted platform events are exposed to trusted Host event consumers, never ordinary message text. */
export const platformEventSchema = Type.Object(
  { ...rawPlatformEventSchema.properties, eventId: id, conversationId: id },
  object,
);
export const readEventsInputSchema = Type.Object(
  { eventRefs: Type.Array(id, { maxItems: 512 }) },
  object,
);
export const readEventsResultSchema = Type.Object(
  { events: Type.Array(platformEventSchema) },
  object,
);
/** Mutations require the caller's current Host Activity; this owner starts no worker or network call. */
export interface MessagingServiceOptions {
  readonly persistence: PersistenceService;
}
/** Canonical fact, material and bounded pending-state owner. */
export interface MessagingService {
  accept(input: AcceptFactsInput): Promise<AcceptFactsResult>;
  prepareRead(input: PrepareReadInput): Promise<PrepareReadResult>;
  recordContact(input: RecordContactInput): Promise<void>;
  listPending(
    input: Static<typeof listPendingInputSchema>,
  ): Promise<Static<typeof listPendingResultSchema>>;
  completePending(input: Static<typeof completePendingInputSchema>): Promise<void>;
  listAttachments(
    input: Static<typeof pendingAttachmentsInputSchema>,
  ): Promise<Static<typeof pendingAttachmentsResultSchema>>;
  updateAttachment(input: UpdateAttachmentInput): Promise<MessageAttachment>;
  listReferences(
    input: Static<typeof listPendingInputSchema>,
  ): Promise<Static<typeof pendingReferencesResultSchema>>;
  updateReference(input: UpdateReferenceInput): Promise<MessageReference>;
  readEvents(
    input: Static<typeof readEventsInputSchema>,
  ): Promise<Static<typeof readEventsResultSchema>>;
}
