# @heptalogos/durable-execution

## Purpose

`durable-execution` is the bounded DBOS adapter boundary for Heptalogos
durable execution. It resolves the installed DBOS 4.27.6 package, provisions
its vendor schema through migration Authority, and owns the Host-bound DBOS
pool, process-global binding, and terminal lifecycle boundary.

## Owns

- Exact installed DBOS package and CLI resolution.
- DBOS-specific child-process invocation, environment sanitization, timeout,
  output bounds, and diagnostic redaction.
- DBOS vendor-schema provisioning through the canonical migration Authority.
- The caller-owned DBOS system pool, process-global static workflow binding,
  and bounded Host lifecycle coordination.
- Heptalogos-owned contracts that keep DBOS implementation objects private.

## Does not own

- Canonical WorkItem state or WorkQueue mutation Authority.
- Host ownership, Bootstrap orchestration, private PostgreSQL lifecycle, or
  normal persistence.
- Product schema migration or canonical WorkItem persistence.
- DBOS classes, workflow handles, queue objects, or PostgreSQL pools as public
  Heptalogos contracts.

## Public surface

The entry point exposes normalized package-resolution, schema-provisioning, and
Host-bound runtime contracts. Process and vendor details remain package-
private; callers do not receive DBOS SDK, Execa, or `pg` objects. A started
runtime is closed for retirement; it has no public reversible quiesce/resume
lifecycle.

The runtime uses the Host `InstanceId` as DBOS `executorID`, while each BootId
only scopes the surrounding Host lifecycle. `DurableCodeVersion` is passed as
DBOS `applicationVersion`; it is an execution-version fence and is not a
replacement for the canonical WorkItem generation or revision fences.

Queue-profile preflight uses a callback-scoped DBOS client. The client and its
password-bearing connection URL are created and destroyed inside the Host
durable-database credential callback; only the normalized queue-registration
contract is visible to the preflight operation, and the caller-owned pool is
never destroyed by that client.

## Dependencies and boundaries

The package uses the adopted DBOS 4.27.6, Execa, and PostgreSQL driver routes.
It may consume Foundation, Host ownership, and WorkQueue contracts.
The dependency graph keeps `bootstrap-runtime`, `private-postgres`,
`persistence`, `runtime-kernel`, and `signal` outside this adapter; those owners
remain at the surrounding composition boundary.

## Verification

The retained `durable-work-recovery.integration.test.ts` executes actual OS
process crashes and replays canonical results. `durable-work-retry-cancel`,
`durable-work-integrity-lineage` and `durable-work-privileges` retain cancellation,
transaction rollback, Host fencing and database-role checks in
`integration/foundation/test`. Use the affected scenario and package
lint/typecheck when this adapter changes.

## Architecture references

- [`Durable dispatch Spec`](../../../specs/execution/durable-dispatch.md)
- [`Work Item Spec`](../../../specs/execution/work-item.md)
- [`Persistence transaction Spec`](../../../specs/data/persistence-transactions.md)
- [`Bootstrap closure Spec`](../../../specs/runtime/bootstrap-closure.md)
- [`Execution model Architecture`](../../../docs/architecture/execution-model.md)
