# @heptalogos/effect-operation

## Purpose

`effect-operation` owns the canonical truth for one consequential external
effect. It records an immutable request, Host-fenced dispatch admission, the
known or uncertain outcome, and read-only reconciliation without becoming a
network client, provider registry, scheduler, or retry engine.

## Owns

- `EffectOperation` V1 contract and state transitions.
- `EffectOperationId`/`EffectKindId` use at the domain boundary.
- Strict request and persisted-row normalization.
- Host-fenced repository transitions and dispatch/reconciliation orchestration.
- Effect-specific Problems and required Activity/Evidence calls.

## Does not own

- External protocol, provider discovery, credentials, or network mechanics.
- WorkItem state, WorkQueue retry policy, DBOS workflow state, or Host lease
  acquisition.
- A second scheduler, generic retry engine, provider registry, broker, or
  compensation/saga framework.

## Public surface

The package root exports the immutable EffectOperation contracts, the narrow
dispatch/reconciliation port, and `EffectOperationService` with explicit
dispatch recovery. Repository details and persistence transaction handles stay
package-private.

## Dependencies and handoffs

The owner composes `foundation-contracts`, `persistence`,
`execution-lineage`, `evidence`, and `time-service`. Persistence supplies the
Host-fenced mutation boundary; Lineage and Evidence supply retained causal
facts; the caller supplies the exact effect-specific port. WorkQueue remains
the owner of durable WorkItem truth and can report the current effect state as
its own outcome.

## Verification

Run the real PostgreSQL `effect-uncertainty` and OS-process
`effect-uncertainty-process` scenarios under `integration/foundation/test`.
They cover concurrent dispatch, ambiguous external effects, canonical replay
and Host fencing. Run package lint/typecheck for interface changes.

## References

- [`Effect Operation Spec`](../../../specs/execution/effect-operation.md)
- [`Persistence Transactions`](../../../specs/data/persistence-transactions.md)
- [`Execution Lineage`](../../../specs/execution/execution-lineage.md)
- [`Evidence`](../../../specs/execution/evidence.md)
- [`Package index`](../../INDEX.md)
