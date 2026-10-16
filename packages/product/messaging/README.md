# @heptalogos/messaging

Messaging owns the existing canonical conversation and MessageFact store. It
accepts native messages from live ingress, self echoes and history through one
stable identity: platform, receiving account, conversation kind/id, and native
message id. Every native identifier stays a string.

## Persistent boundary

`createMessagingService({ persistence })` requires the caller's current Host
Activity for mutations. It creates no Activity, transport, model call or worker.
Its lineage references use the actual fenced transaction's Activity, Instance
and continuity epoch. Host composition retains and completes that Activity.

`accept({ facts })` commits message/event facts, canonical per-conversation
sequences, attachment/reference state and durable pending references in one
short transaction. Unique keys and conversation row locks serialize concurrent
ingress. Duplicate delivery returns the original fact/sequence/pending
reference and never reopens completed pending work. Different received bodies
with the same native identity do not overwrite the first authoritative fact.

Message parts retain their order, author snapshots and protected original
representation references. Platform-sent and Host-received timestamps remain
separate. Retraction is a new source event; it changes a derived lifecycle view
without rewriting the original message document. Unknown notices and requests
retain their concrete event type and protected envelope reference.

Migration `0004_messaging_identity` evolves the existing conversation/message
records in place. Legacy Subject Chat bodies, identifiers, sequence and lineage
remain readable through the new material API; legacy database fields remain
retained. The retired built-in chat runtime API has no compatibility aliases.

## Materials and work

Wire schemas and TypeScript types are exported together from
[`src/contracts.ts`](./src/contracts.ts). Host routes consume these schemas
instead of reproducing DTOs.

- `listPending` and `completePending` expose durable accepted-message/event
  work; network receipt acknowledgement follows successful acceptance.
- `listAttachments` and `updateAttachment` expose revision-CAS acquisition
  state. Bytes live behind another owner's CAS reference. Available requires a
  hash, byte size, media type and CAS reference. Failed work records whether it
  can retry. An acquiring operation can be resumed after process death using
  its persisted revision; this package runs no recovery loop.
- `listReferences` and `updateReference` support reply resolution and bounded
  forward expansion. Nodes have immutable paths/parents and separately claimed
  authors. Updates append nodes, preserve earlier results and create pending
  acquisition records for node attachments. Partial results require a reason
  and continuation. Retraction blocks new expansion.
- `prepareRead` batches ordered facts, references and attachment states under
  the Host-authorized audience and explicit message/byte budgets. Coverage and
  omissions are explicit. A window cursor advances only through its returned
  prefix. Protected raw/envelope/media-source references are excluded.
- `recordContact` records only a consumer-reported actual encounter after
  materials were used. Reading itself creates no Observation or cognition.
  Unencountered retracted messages expose a withdrawn marker and no content;
  encountered material retains its retracted lifecycle and attachment state.
- `readHistoryCoverage` and `updateHistoryCoverage` retain actual native cursor,
  read window and explicit limited/gap/unavailable/complete coverage under revision
  CAS. Empty pages do not imply completeness.
- `readEvents` is for the trusted Host event consumer, including protected
  envelope references. It is not an ordinary conversation read endpoint.

## Verification

The native Messaging/Identity PostgreSQL test reuses the Foundation private
PostgreSQL fixture. It exercises concurrent deduplication and sequence
allocation, pending durability, attachment CAS, partial forward trees, scoped
and budgeted reads, retraction/contact behavior, and an actual upgrade from
legacy message rows:

```sh
HEPTALOGOS_TEST_PG_BIN=/absolute/postgresql/bin \
  pnpm exec vitest run --root integration/foundation \
  test/messaging-identity.integration.test.ts
```

This qualification does not claim actual QQ receipt, protocol history coverage,
media decoding, model reading or message delivery; those belong to the Channel
and Life integration.

`resolveConversations`, `messageSources` and `prepareRead` accept the caller's optional transaction as their final argument. Admission and send guards reuse that transaction for actual canonical source checks; ordinary reads use the same SQL and material parser through the read pool.
