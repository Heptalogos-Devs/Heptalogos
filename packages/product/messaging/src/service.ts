// Copyright 2026 Aravine Zhu
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Owns native facts, pending material work and audience-scoped reading without network work.
 * @module service
 */
import {
  createCanonicalMessageId,
  parseInstant,
} from "@heptalogos/foundation-contracts";
import { compileSchema } from "@heptalogos/schema-runtime";
import {
  executeRepositorySql as sql,
  useRepositoryMutationTransaction,
  useRepositoryReadTransaction,
  type PersistenceInternalTransaction,
} from "@heptalogos/persistence/repository";
import type { PersistenceMutationTransactionContext } from "@heptalogos/persistence";
import {
  messageSourcesInputSchema,
  resolveConversationsInputSchema,
  readHistoryCoverageInputSchema,
  updateHistoryCoverageInputSchema,
  acceptFactsInputSchema,
  prepareReadInputSchema,
  recordContactInputSchema,
  listPendingInputSchema,
  completePendingInputSchema,
  pendingAttachmentsInputSchema,
  updateAttachmentInputSchema,
  updateReferenceInputSchema,
  readEventsInputSchema,
  type AcceptFactsInput,
  type AcceptFactsResult,
  type MessagingService,
  type MessagingServiceOptions,
  type MessageFact,
  type MessageAttachment,
  type MessageReference,
  type PrepareReadResult,
} from "./contracts.js";
import { document, lockConversation, transactionLineage } from "./repository.js";
import { messagingProblem } from "./problems.js";

function invalid(detail: string): never {
  throw messagingProblem(
    "messaging.invalid_input",
    "Messaging input is invalid",
    detail,
  );
}
function conflict(detail: string): never {
  throw messagingProblem(
    "messaging.state_conflict",
    "Messaging state changed",
    detail,
    "conflict",
  );
}
const validators = {
  sources: compileSchema<Parameters<MessagingService["messageSources"]>[0]>(
    messageSourcesInputSchema,
  ),
  conversations: compileSchema<Parameters<MessagingService["resolveConversations"]>[0]>(
    resolveConversationsInputSchema,
  ),
  historyRead: compileSchema<Parameters<MessagingService["readHistoryCoverage"]>[0]>(
    readHistoryCoverageInputSchema,
  ),
  historyUpdate: compileSchema<
    Parameters<MessagingService["updateHistoryCoverage"]>[0]
  >(updateHistoryCoverageInputSchema),
  accept: compileSchema<AcceptFactsInput>(acceptFactsInputSchema),
  read: compileSchema<Parameters<MessagingService["prepareRead"]>[0]>(
    prepareReadInputSchema,
  ),
  contact: compileSchema<Parameters<MessagingService["recordContact"]>[0]>(
    recordContactInputSchema,
  ),
  pending:
    compileSchema<Parameters<MessagingService["listPending"]>[0]>(
      listPendingInputSchema,
    ),
  complete: compileSchema<Parameters<MessagingService["completePending"]>[0]>(
    completePendingInputSchema,
  ),
  attachments: compileSchema<Parameters<MessagingService["listAttachments"]>[0]>(
    pendingAttachmentsInputSchema,
  ),
  attachment: compileSchema<Parameters<MessagingService["updateAttachment"]>[0]>(
    updateAttachmentInputSchema,
  ),
  reference: compileSchema<Parameters<MessagingService["updateReference"]>[0]>(
    updateReferenceInputSchema,
  ),
  events:
    compileSchema<Parameters<MessagingService["readEvents"]>[0]>(readEventsInputSchema),
};
function check<T>(
  validator: { validate(value: unknown): { ok: boolean } },
  value: T,
): T {
  if (!validator.validate(value).ok)
    invalid("The supplied document does not match its owner schema");
  return value;
}
function safePart(part: MessageFact["parts"][number]) {
  const { nativeDataRef: _raw, attachment: _source, ...safe } = part;
  return safe;
}
function safeReference(ref: MessageReference) {
  const {
    revision: _revision,
    messageId: _message,
    continuation: _protectedContinuation,
    ...safe
  } = ref;
  const { sourceRef: _protectedSource, ...safeTarget } = ref.target;
  return {
    ...safe,
    target: safeTarget,
    ...(ref.nodes
      ? {
          nodes: ref.nodes.map((node) => {
            const { sourceRef: _protectedNode, ...safeNode } = node;
            return { ...safeNode, parts: node.parts.map(safePart) };
          }),
        }
      : {}),
  };
}
function safeAttachment(value: MessageAttachment) {
  const { source: _source, ...safe } = value;
  return safe;
}

/** Creates one persistence-backed owner; caller provides a current Host Activity for mutations. */
export function createMessagingService(
  options: MessagingServiceOptions,
): MessagingService {
  const mutate = <T>(
    fn: (
      tx: PersistenceInternalTransaction,
      context: PersistenceMutationTransactionContext,
    ) => Promise<T>,
  ) =>
    options.persistence.mutate((context) =>
      useRepositoryMutationTransaction(context, (tx) => fn(tx, context)),
    );
  const read = <T>(fn: (tx: PersistenceInternalTransaction) => Promise<T>) =>
    options.persistence.read((context) => useRepositoryReadTransaction(context, fn));

  const accept: MessagingService["accept"] = async (input) => {
    check(validators.accept, input);
    for (const fact of input.facts)
      if (
        !parseInstant(fact.receivedAt) ||
        (fact.platformSentAt !== null && !parseInstant(fact.platformSentAt))
      )
        invalid("Fact timestamps must be canonical UTC millisecond instants");
    if (Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024)
      invalid("The ingress batch exceeds 8 MiB");
    // A stable lock ordering avoids cross-conversation deadlocks in concurrent batches.
    const ordered = [...input.facts].sort((a, b) =>
      JSON.stringify([
        a.conversation.platform,
        a.conversation.accountId,
        a.conversation.kind,
        a.conversation.conversationId,
      ]).localeCompare(
        JSON.stringify([
          b.conversation.platform,
          b.conversation.accountId,
          b.conversation.kind,
          b.conversation.conversationId,
        ]),
      ),
    );
    return mutate(async (tx, context) => {
      const outcomes = new Map<
        AcceptFactsInput["facts"][number],
        AcceptFactsResult["results"][number]
      >();
      for (const fact of ordered) {
        const conversation = await lockConversation(tx, context, fact.conversation);
        const candidateId = createCanonicalMessageId();
        const lineage = transactionLineage(context);
        let factId: string,
          status: "created" | "existing",
          sequence: number | undefined;
        if (fact.kind === "message") {
          const value: MessageFact = {
            ...fact,
            schemaVersion: 1,
            messageId: candidateId,
            conversationId: conversation.conversationId,
            sequence: conversation.lastSequence + 1,
            lineageContextRef: lineage,
          };
          const rows = await sql<{ message_id: string; sequence: string | number }>(
            tx,
            `INSERT INTO heptalogos.message_fact
            (message_id,conversation_id,sequence,direction,native_message_id,document,created_at,lineage_context_ref,lifecycle)
            VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,CASE WHEN EXISTS(SELECT 1 FROM heptalogos.messaging_platform_event WHERE conversation_id=$2 AND target_native_message_id=$5 AND effect='retract') THEN 'retracted' ELSE 'present' END)
            ON CONFLICT(conversation_id,native_message_id) DO NOTHING RETURNING message_id,sequence`,
            [
              candidateId,
              conversation.conversationId,
              value.sequence,
              fact.direction,
              fact.nativeMessageId,
              JSON.stringify(value),
              fact.receivedAt,
              JSON.stringify(lineage),
            ],
          );
          status = rows.length ? "created" : "existing";
          const row =
            rows[0] ??
            (
              await sql<{ message_id: string; sequence: string | number }>(
                tx,
                `SELECT message_id,sequence FROM heptalogos.message_fact WHERE conversation_id=$1 AND native_message_id=$2`,
                [conversation.conversationId, fact.nativeMessageId],
              )
            )[0]!;
          factId = row.message_id;
          sequence = Number(row.sequence);
          if (status === "created") {
            await sql(
              tx,
              `UPDATE heptalogos.messaging_conversation SET last_sequence=$2 WHERE conversation_id=$1`,
              [conversation.conversationId, sequence],
            );
            for (const [partIndex, part] of fact.parts.entries())
              if (part.attachment) {
                const attachmentId = createCanonicalMessageId();
                const attachment: MessageAttachment = {
                  attachmentId,
                  messageId: factId,
                  partIndex,
                  source: part.attachment,
                  revision: 0,
                  state: "pending",
                };
                await sql(
                  tx,
                  `INSERT INTO heptalogos.message_attachment(attachment_id,message_id,part_index,state,document) VALUES($1,$2,$3,'pending',$4::jsonb)`,
                  [attachmentId, factId, partIndex, JSON.stringify(attachment)],
                );
              }
            for (const [ordinal, target] of fact.references.entries()) {
              const referenceId = createCanonicalMessageId();
              const reference: MessageReference = {
                referenceId,
                messageId: factId,
                ordinal,
                target,
                revision: 0,
                state: "pending",
              };
              await sql(
                tx,
                `INSERT INTO heptalogos.message_reference(reference_id,message_id,ordinal,state,document) VALUES($1,$2,$3,'pending',$4::jsonb)`,
                [referenceId, factId, ordinal, JSON.stringify(reference)],
              );
            }
            // A retract received before history still suppresses later-acquired original material.
            await sql(
              tx,
              `UPDATE heptalogos.message_attachment SET state='retracted',document=jsonb_set(document,'{state}','"retracted"'::jsonb) WHERE message_id=$1 AND EXISTS(SELECT 1 FROM heptalogos.message_fact WHERE message_id=$1 AND lifecycle='retracted')`,
              [factId],
            );
          }
        } else {
          const value = {
            ...fact,
            eventId: candidateId,
            conversationId: conversation.conversationId,
          };
          const rows = await sql<{ event_id: string }>(
            tx,
            `INSERT INTO heptalogos.messaging_platform_event(event_id,conversation_id,event_key,event_type,target_native_message_id,effect,document,lineage_context_ref,received_at)
            VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) ON CONFLICT(conversation_id,event_key) DO NOTHING RETURNING event_id`,
            [
              candidateId,
              conversation.conversationId,
              fact.eventKey,
              fact.eventType,
              fact.targetNativeMessageId ?? null,
              fact.effect ?? "none",
              JSON.stringify(value),
              JSON.stringify(lineage),
              fact.receivedAt,
            ],
          );
          status = rows.length ? "created" : "existing";
          factId =
            rows[0]?.event_id ??
            (
              await sql<{ event_id: string }>(
                tx,
                `SELECT event_id FROM heptalogos.messaging_platform_event WHERE conversation_id=$1 AND event_key=$2`,
                [conversation.conversationId, fact.eventKey],
              )
            )[0]!.event_id;
          if (
            status === "created" &&
            fact.effect === "retract" &&
            fact.targetNativeMessageId
          ) {
            await sql(
              tx,
              `UPDATE heptalogos.message_fact SET lifecycle='retracted' WHERE conversation_id=$1 AND native_message_id=$2`,
              [conversation.conversationId, fact.targetNativeMessageId],
            );
            await sql(
              tx,
              `UPDATE heptalogos.message_attachment a SET state='retracted',revision=revision+1,document=jsonb_set(jsonb_set(a.document,'{state}','"retracted"'::jsonb),'{revision}',to_jsonb(revision+1)) FROM heptalogos.message_fact m WHERE a.message_id=m.message_id AND m.conversation_id=$1 AND m.native_message_id=$2`,
              [conversation.conversationId, fact.targetNativeMessageId],
            );
          }
        }
        const pendingCandidate = createCanonicalMessageId();
        await sql(
          tx,
          `INSERT INTO heptalogos.messaging_pending(pending_id,kind,fact_id,conversation_id) VALUES($1,$2,$3,$4) ON CONFLICT(kind,fact_id) DO NOTHING`,
          [pendingCandidate, fact.kind, factId, conversation.conversationId],
        );
        const pending = (
          await sql<{ pending_id: string }>(
            tx,
            `SELECT pending_id FROM heptalogos.messaging_pending WHERE kind=$1 AND fact_id=$2`,
            [fact.kind, factId],
          )
        )[0]!;
        outcomes.set(fact, {
          kind: fact.kind,
          status,
          factId,
          conversationId: conversation.conversationId,
          ...(sequence === undefined ? {} : { sequence }),
          pendingRef: pending.pending_id,
        });
      }
      return { results: input.facts.map((fact) => outcomes.get(fact)!) };
    });
  };

  const prepareRead: MessagingService["prepareRead"] = async (input) => {
    check(validators.read, input);
    if ((input.messageRefs === undefined) === (input.window === undefined))
      invalid("Choose exactly one of messageRefs or window");
    return read(async (tx) => {
      const allowed = input.audience.conversationIds;
      if (input.window && !allowed.includes(input.window.conversationId))
        throw messagingProblem(
          "messaging.read_forbidden",
          "Conversation is outside audience scope",
          "The Host must authorize this source before reading",
          "permission",
        );
      const rows = await sql<{
        document: unknown;
        lifecycle: "present" | "retracted";
        contacted: boolean;
      }>(
        tx,
        `SELECT m.document,m.lifecycle,EXISTS(SELECT 1 FROM heptalogos.message_contact c WHERE c.message_id=m.message_id AND c.subject_id=$1) AS contacted
         FROM heptalogos.message_fact m WHERE m.conversation_id=ANY($2::uuid[]) AND ${input.window ? "m.conversation_id=$3 AND m.sequence>$4 AND ($5::bigint IS NULL OR m.sequence<=$5)" : "m.message_id=ANY($3::uuid[])"}
         ORDER BY m.conversation_id,m.sequence LIMIT 513`,
        input.window
          ? [
              input.audience.subjectId,
              allowed,
              input.window.conversationId,
              input.window.afterSequence,
              input.window.throughSequence ?? null,
            ]
          : [input.audience.subjectId, allowed, input.messageRefs],
      );
      const facts = rows.map((row) => ({
        ...row,
        fact: document<MessageFact>(row.document),
      }));
      const ids = facts.map((row) => row.fact.messageId);
      const attachments = await sql<{ document: unknown }>(
        tx,
        `SELECT document FROM heptalogos.message_attachment WHERE message_id=ANY($1::uuid[]) ORDER BY part_index`,
        [ids],
      );
      const references = await sql<{ document: unknown }>(
        tx,
        `SELECT document FROM heptalogos.message_reference WHERE message_id=ANY($1::uuid[]) ORDER BY ordinal`,
        [ids],
      );
      const material: PrepareReadResult["materials"] = [];
      const omitted: PrepareReadResult["omitted"] = [];
      const found = new Set(ids);
      for (const messageRef of input.messageRefs ?? [])
        if (!found.has(messageRef)) omitted.push({ messageRef, reason: "not_found" });
      let bytes = 0;
      let nextSequence = input.window?.afterSequence;
      for (const row of facts) {
        const f = row.fact;
        const withheld = row.lifecycle === "retracted" && !row.contacted;
        const item = {
          messageId: f.messageId,
          conversationId: f.conversationId,
          sequence: f.sequence,
          nativeMessageId: f.nativeMessageId,
          conversation: f.conversation,
          direction: f.direction,
          author: f.author,
          platformSentAt: f.platformSentAt,
          receivedAt: f.receivedAt,
          lineageContextRef: f.lineageContextRef,
          lifecycle: row.lifecycle,
          withheld,
          parts: withheld ? [] : f.parts.map(safePart),
          attachments: withheld
            ? []
            : attachments
                .map((a) => document<MessageAttachment>(a.document))
                .filter((a) => a.messageId === f.messageId)
                .map(safeAttachment),
          references: withheld
            ? []
            : references
                .map((r) => document<MessageReference>(r.document))
                .filter((r) => r.messageId === f.messageId)
                .map(safeReference),
        };
        const size = Buffer.byteLength(JSON.stringify(item));
        if (material.length >= input.budget.maxMessages) {
          omitted.push({ messageRef: f.messageId, reason: "message_budget" });
          continue;
        }
        if (bytes + size > input.budget.maxBytes) {
          omitted.push({ messageRef: f.messageId, reason: "byte_budget" });
          continue;
        }
        material.push(item);
        bytes += size;
        nextSequence = f.sequence;
      }
      // A cursor must not skip an omitted earlier message. Only advance through the contiguous returned prefix.
      if (input.window) {
        nextSequence = input.window.afterSequence;
        for (const row of facts) {
          if (!material.some((m) => m.messageId === row.fact.messageId)) break;
          nextSequence = row.fact.sequence;
        }
      }
      return {
        materials: material,
        coverage: {
          complete: omitted.length === 0 && rows.length < 513,
          returnedMessages: material.length,
          bytes,
        },
        omitted,
        ...(input.window ? { nextSequence } : {}),
      };
    });
  };

  return {
    async messageSources(input) {
      check(validators.sources, input);
      return read(async (tx) => ({
        sources: (
          await sql<{
            message_id: string;
            conversation_id: string;
            lifecycle: "present" | "retracted";
          }>(
            tx,
            `SELECT message_id,conversation_id,lifecycle FROM heptalogos.message_fact WHERE message_id=ANY($1::uuid[]) AND conversation_id=ANY($2::uuid[]) ORDER BY conversation_id,sequence`,
            [input.messageRefs, input.conversationIds],
          )
        ).map((row) => ({
          messageRef: row.message_id,
          conversationId: row.conversation_id,
          lifecycle: row.lifecycle,
        })),
      }));
    },
    async resolveConversations(input) {
      check(validators.conversations, input);
      return read(async (tx) => ({
        conversationIds: (
          await sql<{ conversation_id: string }>(
            tx,
            `SELECT DISTINCT c.conversation_id FROM heptalogos.messaging_conversation c JOIN jsonb_to_recordset($1::jsonb) AS requested(platform text,"accountId" text,"conversationId" text,kind text) ON c.platform_id=requested.platform AND c.native_account_id=requested."accountId" AND c.native_conversation_id=requested."conversationId" AND c.conversation_kind=requested.kind ORDER BY c.conversation_id`,
            [JSON.stringify(input.conversations)],
          )
        ).map((row) => row.conversation_id),
      }));
    },
    async readHistoryCoverage(input) {
      check(validators.historyRead, input);
      return read(async (tx) => {
        const rows = await sql<{ document: unknown }>(
          tx,
          `SELECT h.document FROM heptalogos.messaging_history_coverage h JOIN heptalogos.messaging_conversation c USING(conversation_id) WHERE c.platform_id=$1 AND c.native_account_id=$2 AND c.native_conversation_id=$3 AND c.conversation_kind=$4`,
          [
            input.conversation.platform,
            input.conversation.accountId,
            input.conversation.conversationId,
            input.conversation.kind,
          ],
        );
        return {
          history: rows[0]
            ? document<Awaited<ReturnType<MessagingService["updateHistoryCoverage"]>>>(
                rows[0].document,
              )
            : null,
        };
      });
    },
    async updateHistoryCoverage(input) {
      check(validators.historyUpdate, input);
      if (!parseInstant(input.updatedAt))
        invalid("History update time must be canonical");
      return mutate(async (tx, context) => {
        const conversation = await lockConversation(tx, context, input.conversation);
        const [previous] = await sql<{ revision: number }>(
          tx,
          "SELECT revision FROM heptalogos.messaging_history_coverage WHERE conversation_id=$1 FOR UPDATE",
          [conversation.conversationId],
        );
        if ((previous?.revision ?? null) !== input.expectedRevision)
          conflict("History coverage revision changed");
        const { expectedRevision: _expected, ...fields } = input;
        const history = { ...fields, revision: (previous?.revision ?? 0) + 1 };
        await sql(
          tx,
          `INSERT INTO heptalogos.messaging_history_coverage(conversation_id,revision,document,lineage_context_ref) VALUES($1,$2,$3::jsonb,$4::jsonb) ON CONFLICT(conversation_id) DO UPDATE SET revision=EXCLUDED.revision,document=EXCLUDED.document,lineage_context_ref=EXCLUDED.lineage_context_ref`,
          [
            conversation.conversationId,
            history.revision,
            JSON.stringify(history),
            JSON.stringify(transactionLineage(context)),
          ],
        );
        return history;
      });
    },
    accept,
    prepareRead,
    async recordContact(input) {
      check(validators.contact, input);
      if (!parseInstant(input.observedAt))
        invalid("Contact time must be a canonical UTC millisecond instant");
      await mutate(async (tx, context) => {
        for (const messageId of input.messageRefs)
          await sql(
            tx,
            `INSERT INTO heptalogos.message_contact(subject_id,message_id,contact_id,observed_at,lineage_context_ref) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING`,
            [
              input.subjectId,
              messageId,
              input.contactId,
              input.observedAt,
              JSON.stringify(transactionLineage(context)),
            ],
          );
      });
    },
    async listPending(input) {
      check(validators.pending, input);
      return read(async (tx) => ({
        pending: (
          await sql<{
            pending_id: string;
            kind: "message" | "event";
            fact_id: string;
            conversation_id: string;
          }>(
            tx,
            `SELECT * FROM heptalogos.messaging_pending WHERE NOT completed AND ($1::uuid IS NULL OR conversation_id=$1) AND ($3::uuid[] IS NULL OR conversation_id=ANY($3::uuid[])) ORDER BY created_at,pending_id LIMIT $2`,
            [input.conversationId ?? null, input.limit, input.conversationIds ?? null],
          )
        ).map((r) => ({
          pendingRef: r.pending_id,
          kind: r.kind,
          factId: r.fact_id,
          conversationId: r.conversation_id,
        })),
      }));
    },
    async completePending(input) {
      check(validators.complete, input);
      await mutate(async (tx) => {
        await sql(
          tx,
          `UPDATE heptalogos.messaging_pending SET completed=true WHERE pending_id=ANY($1::uuid[])`,
          [input.pendingRefs],
        );
      });
    },
    async listAttachments(input) {
      check(validators.attachments, input);
      return read(async (tx) => ({
        attachments: (
          await sql<{ document: unknown }>(
            tx,
            `SELECT a.document FROM heptalogos.message_attachment a JOIN heptalogos.message_fact m USING(message_id) WHERE a.state=ANY($1::text[]) AND ($3::uuid[] IS NULL OR m.conversation_id=ANY($3::uuid[])) ORDER BY a.attachment_id LIMIT $2`,
            [
              input.states ?? ["pending", "failed"],
              input.limit,
              input.conversationIds ?? null,
            ],
          )
        ).map((r) => document<MessageAttachment>(r.document)),
      }));
    },
    async updateAttachment(input) {
      check(validators.attachment, input);
      if (input.state === "available" && !input.cas)
        invalid("Available attachment requires its CAS reference");
      if (input.state === "failed" && !input.failure)
        invalid("Failed attachment requires its retry classification");
      return mutate(async (tx) => {
        const row = (
          await sql<{ document: unknown }>(
            tx,
            `SELECT document FROM heptalogos.message_attachment WHERE attachment_id=$1 FOR UPDATE`,
            [input.attachmentId],
          )
        )[0];
        if (!row) conflict("Attachment does not exist");
        const previous = document<MessageAttachment>(row.document);
        if (previous.revision !== input.expectedRevision)
          conflict("Attachment revision changed");
        const allowed: Record<string, string[]> = {
          pending: ["acquiring", "expired", "retracted"],
          acquiring: ["available", "failed", "expired", "retracted"],
          failed: ["acquiring", "expired", "retracted"],
          available: ["expired", "retracted"],
          expired: ["acquiring", "retracted"],
          retracted: [],
        };
        if (!allowed[previous.state]?.includes(input.state))
          conflict("Attachment transition is not permitted");
        if (
          previous.state === "failed" &&
          input.state === "acquiring" &&
          !previous.failure?.retryable
        )
          conflict("Attachment failure is terminal");
        const next: MessageAttachment = {
          attachmentId: previous.attachmentId,
          messageId: previous.messageId,
          partIndex: previous.partIndex,
          source: previous.source,
          ...(previous.nodePath ? { nodePath: previous.nodePath } : {}),
          ...(previous.referenceId ? { referenceId: previous.referenceId } : {}),
          revision: previous.revision + 1,
          state: input.state,
          ...(input.cas
            ? { cas: input.cas }
            : previous.cas
              ? { cas: previous.cas }
              : {}),
          ...(input.failure ? { failure: input.failure } : {}),
        };
        await sql(
          tx,
          `UPDATE heptalogos.message_attachment SET state=$2,revision=$3,document=$4::jsonb WHERE attachment_id=$1 AND revision=$5`,
          [
            input.attachmentId,
            next.state,
            next.revision,
            JSON.stringify(next),
            input.expectedRevision,
          ],
        );
        return next;
      });
    },
    async listReferences(input) {
      check(validators.pending, input);
      return read(async (tx) => ({
        references: (
          await sql<{ document: unknown }>(
            tx,
            `SELECT r.document FROM heptalogos.message_reference r JOIN heptalogos.message_fact m USING(message_id) WHERE r.state IN ('pending','partial') AND m.lifecycle='present' AND ($1::uuid IS NULL OR m.conversation_id=$1) AND ($3::uuid[] IS NULL OR m.conversation_id=ANY($3::uuid[])) ORDER BY r.reference_id LIMIT $2`,
            [input.conversationId ?? null, input.limit, input.conversationIds ?? null],
          )
        ).map((r) => document<MessageReference>(r.document)),
      }));
    },
    async updateReference(input) {
      check(validators.reference, input);
      if (
        input.nodes &&
        Buffer.byteLength(JSON.stringify(input.nodes)) > 4 * 1024 * 1024
      )
        invalid("Forward expansion exceeds 4 MiB");
      if (input.state === "partial" && (!input.reason || !input.continuation))
        invalid("Partial expansion requires reason and continuation");
      if (input.state === "unavailable" && !input.reason)
        invalid("Unavailable reference requires reason");
      return mutate(async (tx) => {
        const row = (
          await sql<{ document: unknown }>(
            tx,
            `SELECT document FROM heptalogos.message_reference WHERE reference_id=$1 FOR UPDATE`,
            [input.referenceId],
          )
        )[0];
        if (!row) conflict("Reference does not exist");
        const previous = document<MessageReference>(row.document);
        const [parentMessage] = await sql<{ lifecycle: string }>(
          tx,
          "SELECT lifecycle FROM heptalogos.message_fact WHERE message_id=$1 FOR UPDATE",
          [previous.messageId],
        );
        if (parentMessage?.lifecycle !== "present")
          conflict("Retracted source cannot acquire new forward material");
        if (previous.revision !== input.expectedRevision)
          conflict("Reference revision changed");
        if (previous.state === "available") conflict("Resolved reference is immutable");
        if (input.resolvedMessageRef) {
          const [target] = await sql<{ message_id: string }>(
            tx,
            `SELECT child.message_id FROM heptalogos.message_fact child
             JOIN heptalogos.message_fact parent ON parent.message_id=$2
             WHERE child.message_id=$1 AND child.conversation_id=parent.conversation_id
               AND child.native_message_id=$3`,
            [input.resolvedMessageRef, previous.messageId, previous.target.nativeId],
          );
          if (previous.target.kind !== "reply" || !target)
            conflict(
              "Reply resolution must identify its native target in the same conversation",
            );
        }
        const nodes = [...(previous.nodes ?? [])];
        for (const node of input.nodes ?? []) {
          const existing = nodes.find((n) => n.path === node.path);
          if (existing && JSON.stringify(existing) !== JSON.stringify(node))
            conflict("An existing forward node cannot be silently rewritten");
          if (!existing) nodes.push(node);
        }
        if (
          nodes.length > 4096 ||
          Buffer.byteLength(JSON.stringify(nodes)) > 4 * 1024 * 1024
        )
          invalid("Accumulated forward expansion exceeds its material budget");
        const paths = new Set<string>();
        for (const node of nodes) {
          if (paths.has(node.path)) invalid("Forward node paths must be unique");
          paths.add(node.path);
        }
        for (const node of nodes) {
          if (node.parentPath !== null && !paths.has(node.parentPath))
            invalid("Forward parent is absent");
          let parent = node.parentPath;
          const visited = new Set([node.path]);
          while (parent !== null) {
            if (visited.has(parent)) invalid("Forward tree contains a cycle");
            visited.add(parent);
            parent = nodes.find((n) => n.path === parent)?.parentPath ?? null;
          }
        }
        for (const node of input.nodes ?? [])
          for (const [partIndex, part] of node.parts.entries())
            if (part.attachment) {
              const attachmentId = createCanonicalMessageId();
              const nodePath = previous.referenceId + ":" + node.path;
              const attachment: MessageAttachment = {
                attachmentId,
                messageId: previous.messageId,
                referenceId: previous.referenceId,
                nodePath,
                partIndex,
                source: part.attachment,
                state: "pending",
                revision: 0,
              };
              await sql(
                tx,
                `INSERT INTO heptalogos.message_attachment(attachment_id,message_id,part_index,node_path,state,document) VALUES($1,$2,$3,$4,'pending',$5::jsonb) ON CONFLICT(message_id,node_path,part_index) DO NOTHING`,
                [
                  attachmentId,
                  previous.messageId,
                  partIndex,
                  nodePath,
                  JSON.stringify(attachment),
                ],
              );
            }
        const next: MessageReference = {
          referenceId: previous.referenceId,
          messageId: previous.messageId,
          ordinal: previous.ordinal,
          target: previous.target,
          revision: previous.revision + 1,
          state: input.state,
          ...(input.resolvedMessageRef
            ? { resolvedMessageRef: input.resolvedMessageRef }
            : {}),
          ...(nodes.length ? { nodes } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.continuation ? { continuation: input.continuation } : {}),
        };
        await sql(
          tx,
          `UPDATE heptalogos.message_reference SET state=$2,revision=$3,document=$4::jsonb WHERE reference_id=$1 AND revision=$5`,
          [
            next.referenceId,
            next.state,
            next.revision,
            JSON.stringify(next),
            input.expectedRevision,
          ],
        );
        return next;
      });
    },
    async readEvents(input) {
      check(validators.events, input);
      return read(async (tx) => ({
        events: (
          await sql<{ document: unknown }>(
            tx,
            `SELECT document FROM heptalogos.messaging_platform_event WHERE event_id=ANY($1::uuid[]) AND ($2::uuid[] IS NULL OR conversation_id=ANY($2::uuid[])) ORDER BY received_at,event_id`,
            [input.eventRefs, input.conversationIds ?? null],
          )
        ).map((r) =>
          document<
            Awaited<ReturnType<MessagingService["readEvents"]>>["events"][number]
          >(r.document),
        ),
      }));
    },
  };
}
