# @heptalogos/persistence

## Purpose

`persistence` is the normal Host-fenced PostgreSQL service used by Foundation
components. It creates the connection pool and exposes read and mutation
transaction contracts carrying execution and ownership context. The package
keeps canonical database access behind a service boundary so callers cannot
silently mutate state after Host ownership is lost.

## Owns

- Normal PostgreSQL connection-pool lifecycle.
- Host-fenced transaction entry and mutation/read transaction contexts.
- Persistence service state and execution metadata propagation.
- The package's restricted repository integration surface.

## Does not own

- Host lease acquisition or token publication.
- Canonical schema materialization or migration policy.
- Bootstrap private PostgreSQL maintenance.
- Runtime scheduling, durable work, or external-effect semantics.

## Public surface

The entry point exports persistence runtime options, transaction and execution
context types, `PersistenceService`, state types, and
createPersistenceService. The ./repository subpath exposes the explicit
repository integration surface. The service is the supported consumer route
and carries the required Host and execution context.

## Dependencies and boundaries

It depends on `foundation-contracts`, `execution-lineage`, `host-ownership`,
`schema-runtime`, `time-service`, Kysely, and `pg`. Host ownership remains the
fence Authority and canonical-schema remains the schema Authority; direct SQL
mutation stays behind this service boundary.

## Verification

Run `pnpm nx run persistence:test:integration` with the prepared PostgreSQL
runtime for mutation fencing, concurrent token publication, READ ONLY,
commit uncertainty and database privileges. Run package lint/typecheck for
interface changes.

## Architecture references

- [`Persistence transaction Spec`](../../../specs/data/persistence-transactions.md)
- [`Host ownership Spec`](../../../specs/runtime/host-ownership.md)
- [`Execution lineage Spec`](../../../specs/execution/execution-lineage.md)
- [`Storage lifecycle Architecture`](../../../docs/architecture/storage-lifecycle.md)
