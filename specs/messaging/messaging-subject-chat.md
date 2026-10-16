# Messaging and Subject Chat Contract

## Scope

This Spec owns the first canonical Messaging slice and the built-in local
Subject Chat protocol:

```text
logical platform: heptalogos-subject-chat
one direct Administrator ↔ Subject conversation
text-only content
canonical inbound and outbound MessageFact
idempotent send
canonical query and reconnect catch-up
```

The current built-in Subject Chat channel is not an external IM Driver. OneBot, Milky, external
accounts, media breadth, and remote messaging effects remain separate future
Integration work.

## Ownership

MessagingService owns canonical Messaging identities, immutable MessageFact,
conversation membership, inbound admission, idempotency, canonical ordering,
and local message query/catch-up. Subject Core owns Subject state and admission
prerequisites. ConversationMailbox and Reaction organize accepted facts for
cognition but do not re-own MessageFact Authority. WorkItem owns durable
processing obligation. Signal is only a post-commit wakeup hint. EffectOperation
owns consequential external effects, not local Subject Chat outbound.

Subject Chat is a real protocol path:

```text
SubjectChatClient
→ Subject Chat endpoint/Driver
→ MessagingService
→ canonical MessageFact
→ WorkItem
→ ConversationMailbox
→ Subject cognition and commit path
```

It is not a Presentation-to-Reactor shortcut.

## Identities and MessageFact

Reuse existing Foundation identity and canonical encoding mechanics. The
current built-in channel has one stable conversation for the Installation's
Administrator and active logical Subject.

```ts
interface SubjectChatIdentitySet {
  readonly schemaVersion: 1;
  readonly messagingPlatformId: MessagingPlatformId;
  readonly administratorAccountId: MessagingAccountId;
  readonly subjectAccountId: MessagingAccountId;
  readonly conversationId: CanonicalConversationId;
}

interface MessageFact {
  readonly schemaVersion: 1;
  readonly messageId: CanonicalMessageId;
  readonly conversationId: CanonicalConversationId;
  readonly direction: "INBOUND" | "OUTBOUND";
  readonly sender: ParticipantRef;
  readonly recipient: ParticipantRef;
  readonly text: string;
  readonly clientMessageId?: string;
  readonly causedByCommunicationCommitId?: CommunicationCommitId;
  readonly createdAt: Instant;
  readonly lineageContextRef: LineageContextRef;
}
```

MessageFact is immutable canonical Messaging truth. Current Subject Chat text must be non-empty
after protocol canonical input validation. Empty text is not a no-communication
result; a considered cognition opportunity can complete without creating an
outbound MessageFact.

ParticipantRef distinguishes canonical Administrator and Subject participants.
Administrator participation in Subject Chat grants no automatic System
Authority.

## Inbound admission

Built-in Subject Chat accepts input only when Subject ActualState is:

```text
READY
ACTIVE
DEGRADED
```

Input is rejected with a canonical structured Problem when state is:

```text
STOPPED
STARTING
BLOCKED
STOPPING
FAILED
```

Rejected input creates no MessageFact, mailbox revision, or cognition WorkItem.
This admission rule is local Subject Chat policy. A future external Driver may
durably ingest a message while cognition is unavailable, but that is not this
built-in Subject Chat path.

## Inbound transaction

After identity and text validation, one Host-fenced canonical transaction
commits, as applicable:

```text
inbound MessageFact
clientMessageId idempotency binding
ConversationMailbox revision advance/reference
durable WorkItem for mailbox/reaction processing
required Lineage and Evidence
```

Only after commit may the implementation emit a Signal hint or return the
accepted result. The WorkItem is an obligation derived from the committed fact;
it is not Messaging Authority. External network or model I/O does not occur
inside this mutation transaction.

## Idempotent send

clientMessageId is stable within the conversation and sender scope. The
canonical idempotency binding stores enough canonical input identity to make
retries unambiguous.

```text
same key + canonically identical accepted input
→ return existing MessageFact/result
→ create no duplicate MessageFact
→ create no duplicate cognition WorkItem

same key + different canonical content or scope
→ idempotency/identity conflict
```

For the built-in Subject Chat path, Messaging owns the canonical transaction
and invokes one narrow current-consumer Subject obligation port after inserting
the inbound MessageFact. That port advances ConversationMailbox and commits a
prepared WorkItem in the same transaction. This is a concrete atomic
cross-owner seam, not a generic domain-event bus or IdempotencyService.

A client that loses the response may retry the same key and content and obtain
the already committed result. Idempotency does not accept a changed message
under an old key.

## Local outbound

The built-in local outbound path is:

```text
CommunicationCommit
→ exactly one canonical outbound MessageFact
→ query/catch-up/live projection
```

It creates no EffectOperation. A local Presentation disconnect, missed live
event, or closed browser/Desktop client does not create external-effect
uncertainty. The MessageFact remains queryable and is recovered by catch-up.

A CommunicationCommit with `purpose = "reply"` is the semantic cause of the outbound MessageFact.
A `NO_COMMUNICATION` Reaction creates neither CommunicationCommit nor outbound
MessageFact. The accepted CommunicationCommit is the direct semantic cause of
the outbound MessageFact; no separate generic decision record is required in
this current slice.

## Query and reconnect catch-up

Message query uses an opaque versioned cursor derived from canonical ordering.
The order is the canonical per-conversation sequence, with createdAt and
CanonicalMessageId retained only as deterministic tie-break data when required
by a projection. A query
returns messages after the cursor in that order and a next cursor based on the
last returned fact. Reconnect always re-queries canonical MessageFact state;
live projection is optional and never replaces catch-up.

A query projection may redact fields according to the authenticated consumer
and sensitivity policy, but it cannot reorder facts in a way that changes their
canonical sequence or turn a projection into mutation Authority.

## External messaging boundary

Future external Messaging remains outside the current built-in Subject Chat implementation:

```text
CommunicationCommit
→ EffectOperation
→ external Driver
→ remote platform
→ SUCCEEDED | FAILED | UNCERTAIN
```

Transport success does not by itself prove remote effect truth, and a
Presentation disconnect is not an external dispatch attempt. The existing
EffectOperation contract owns preparation, dispatch admission, uncertainty,
and reconciliation when an external Driver is later authorized.

## Failure semantics and Management projection

The canonical Problem projection distinguishes at least:

```text
messaging.invalid_input
messaging.subject_not_accepting
messaging.conversation_not_found
messaging.idempotency_conflict
messaging.duplicate_request
messaging.cursor_invalid
messaging.unauthorized_participant
messaging.canonical_commit_failed
```

Management and Subject Chat clients can inspect conversation and MessageFact
query/catch-up state. They cannot create cognition by bypassing MessagingService,
write mailbox state directly, or submit an outbound MessageFact without the
CommunicationCommit path.

## Invariants

- MSG-001 MessageFact is immutable canonical Messaging truth.
- MSG-002 Successful inbound input commits MessageFact before cognition can claim it.
- MSG-003 WorkItem is an obligation derived from MessageFact, not Messaging Authority.
- MSG-004 Built-in Subject Chat admission is Subject-state-aware.
- MSG-005 clientMessageId retries are idempotent for identical input and conflict for changed input.
- MSG-006 Subject Chat is a real Messaging protocol path, not a Presentation-to-Reactor shortcut.
- MSG-007 Administrator participation in Subject Chat does not automatically grant System Authority.
- MSG-008 Local outbound MessageFact does not use EffectOperation.
- MSG-009 Presentation disconnect does not make local outbound UNCERTAIN.
- MSG-010 Reconnect catches up from canonical MessageFact truth.
- MSG-011 No-communication is not an empty outbound MessageFact; it is a local
  Reaction outcome owned by the Subject/Reaction boundary.
- MSG-012 External Driver uncertainty remains EffectOperation-owned when external Messaging later enters.
- MSG-013 The current built-in Subject Chat is text-only; broader segments and media are not implemented by implication.

## Persistence and current-slice exclusions

MessageFact, idempotency binding, mailbox revision reference, WorkItem, and
required causal records are committed through the owning Host-fenced
transaction. Physical SQL tables and migrations are not defined here.

This Spec does not define:

```text
OneBot or Milky implementation
external IM accounts or drivers
media, voice, files, or rich segments
group conversations
proactive messaging
local outbound EffectOperation
MCP or AI tools
Presentation renderer or GUI
generic messaging broker
```

## References

- [Messaging architecture](../../docs/architecture/messaging.md)
- [Subject Base Spec](../subject/subject-base.md)
- [Reaction and Communication Authority](../subject/reaction-behavior.md)
- [System Authority Spec](../management/system-authority.md)
- [Work Item](../execution/work-item.md)
- [Effect Operation](../execution/effect-operation.md)
- [Signal](../execution/signal.md)
- [Persistence Transactions](../data/persistence-transactions.md)
- [Execution Lineage](../execution/execution-lineage.md)
- [Evidence](../execution/evidence.md)
- [Contract Versioning](../core/contract-versioning.md)

当前channel/account机会消费者按活动计划迁移到唯一Subject Reactor；接收只通知稳定pending，跨来源全局选择不提前读取正文。preview/full/media各按实际provider admission/receipt完成所见范围，skipped与observed分开。世界或内部任务不伪造QQ会话，听众私密边界与既有actual-contact完成pending、转发文件父会话语义保留。
