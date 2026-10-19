# @heptalogos/signal

## Purpose

`signal` provides the fixed PostgreSQL LISTEN/NOTIFY wakeup hint used to
reduce latency between canonical commits and WorkQueue reconciliation.

## Owns

- The fixed `heptalogos_signal_v1` channel and Signal hint V1 codec.
- Dedicated listener connection lifecycle, topic filtering, reconnect, and
  rescan callbacks.
- Transactional publication of bounded wakeup hints through an existing
  Foundation mutation transaction.

## Does not own

- WorkItem state, canonical payload, queue scheduling, or EventBus semantics.
- Durable truth, handler execution, retry, or DBOS mechanics.
- Host ownership or PostgreSQL pool lifecycle.

## Public surface

The entry point exports Signal topic/codec helpers, the PostgreSQL Signal
service factory, the transactional publisher, and framework-free contracts for
the listener, subscription, and Host authority seams. Raw `pg.Client` objects
remain private to the package boundary.

## Dependencies and boundaries

The package uses the existing Host persistence authority for loopback runtime
credentials and lifetime, `PersistenceInternalTransaction` only through the
Foundation repository seam for publication, and SchemaRuntime for strict hint
validation. It owns one dedicated listener client and never reuses a pooled
mutation connection for LISTEN.

## Verification

`integration/foundation/test/durable-work-recovery.integration.test.ts`
checks that canonical work resumes after actual Signal loss and process
recovery. Run that scenario for listener/reconnect changes and package
lint/typecheck for interface changes.

## Architecture references

- [`Signal Spec`](../../../specs/execution/signal.md)
- [`Work Item Spec`](../../../specs/execution/work-item.md)
- [`Persistence transaction Spec`](../../../specs/data/persistence-transactions.md)
- [`Execution lineage Spec`](../../../specs/execution/execution-lineage.md)
- [`Foundation services Architecture`](../../../docs/architecture/foundation-services.md)
