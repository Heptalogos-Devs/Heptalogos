# @heptalogos/bootstrap-runtime

## Purpose

`bootstrap-runtime` is the installation and recovery orchestration boundary that
exists before and around the normal product Runtime. It prepares Bootstrap
state, starts and maintains private PostgreSQL through the authorized
controller, and coordinates forward and reverse Host handoff. Its managed Host
contracts let higher-level integration compose Bootstrap, Host ownership, and
Runtime lifecycle without giving Bootstrap product Runtime semantics.

## Owns

- Bootstrap ownership and prelude orchestration.
- Private PostgreSQL startup and authorized maintenance handoff.
- Bootstrap recovery inspection and command execution.
- Managed Host lifecycle, terminal runtime retirement, and handoff contracts.
- The managed Host's fenced durable-execution database authority and
  callback-scoped credential handoff.
- Bootstrap key-provider and installation-owner projections.

Durable execution is composed at the integration/Host lifecycle boundary. The
production Bootstrap surface does not import DBOS or own WorkQueue semantics;
planned reverse handoff retires the durable runtime before Host ownership and
private PostgreSQL cleanup are released.

## Does not own

- Runtime Kernel or Cordis mechanics in production source.
- Normal persistence/schema mutation authority.
- DBOS lifecycle or workflow mechanics; those belong to the durable-execution
  package composed by the Host boundary.
- A second Host lease or private PostgreSQL controller.
- Later-stage durable work, external effects, or product cognition.

## Public surface

The entry point exports Bootstrap locator/path and ownership types, recovery
inspection/commands, Bootstrap Prelude preparation, private PostgreSQL handoff
types, key-provider contracts, and managed Host lifecycle contracts. Production
callers use these interfaces; tests may compose Runtime packages at the
integration boundary.

## Dependencies and boundaries

The production dependency graph keeps RuntimeKernel, RuntimeSubstrate, Cordis,
DBOS, and WorkQueue composition at the `integration/foundation` boundary;
`bootstrap-runtime` does not carry those cross-package dependencies or expose
test-only composition seams. Authorized PostgreSQL control follows the single
Bootstrap-owned Host handoff owner, and post-Host cleanup reacquires Bootstrap
authority before the maintenance witness is finalized.

## Verification

Run `pnpm nx run bootstrap-runtime:test` for filesystem ownership, lock races,
process identity, roots and credential boundaries. The two recovery-process
targets retain actual owner-process races and killed PostgreSQL maintenance
recovery. Normal installation, start and stop use the installed Product Host
consumer path; Runtime/Host composition remains in `integration/foundation`.

## Architecture references

- [`Bootstrap closure Spec`](../../../specs/runtime/bootstrap-closure.md)
- [`Persistence transaction Spec`](../../../specs/data/persistence-transactions.md)
- [`Service, capability, and readiness Spec`](../../../specs/core/service-capability-readiness.md)
- [`Maintenance handoff Spec`](../../../specs/runtime/maintenance-handoff.md)
- [`Storage lifecycle Architecture`](../../../docs/architecture/storage-lifecycle.md)
