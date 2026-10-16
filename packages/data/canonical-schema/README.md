# @heptalogos/canonical-schema

## Purpose

`canonical-schema` materializes the current canonical PostgreSQL schema used by
the Foundation persistence layer. It provides the initializer and current
development baseline that creates the tables, functions, and constraints needed
by Host ownership, persistence, lineage, and evidence. During
`PRE_PRODUCTION`, this is the rewriteable canonical baseline rather than a
chronology-preserving migration archive.

## Owns

- Canonical schema definition and initialization.
- Current migration/baseline mechanics required to materialize that schema.
- Canonical `WorkItem` obligation state and immutable execution-origin fields.
- Schema initialization contract and its runtime options.

## Does not own

- Connection pools or normal transaction APIs.
- Host lease acquisition or ownership fencing.
- Bootstrap maintenance control.
- Compatibility readers or migrations for project-owned development history.
- DBOS vendor schema or durable-engine state.

## Public surface

The package exports `CanonicalSchemaRuntimeOptions`,
`CanonicalSchemaInitializer`, and `createCanonicalSchemaInitializer`. The
initializer is consumed by the owning bootstrap/persistence composition rather
than used as a general SQL execution surface.

## Dependencies and boundaries

It depends on `foundation-contracts`, `host-ownership`, Kysely, and `pg`.
Database connection and Host context come from the caller's owning layer.
Schema ownership remains separate from transaction and lifecycle ownership;
persistence and Bootstrap consume this schema boundary rather than becoming
parallel schema authorities.

## Verification

Run `pnpm nx run canonical-schema:test`, lint, typecheck, and the relevant real
PostgreSQL initialization/integration scenarios. The incremental `0004_messaging_identity` migration preserves existing message
records while extending their canonical material and identity ownership.

Any baseline rewrite also
requires the PRE_PRODUCTION reset/recreate procedure and full repository gates.

## Architecture references

- [`Canonical schema Spec`](../../../specs/data/canonical-schema.md)
- [`Persistence transaction Spec`](../../../specs/data/persistence-transactions.md)
- [`Verification system`](../../../project/qualification/verification-system.md)
- [`Storage lifecycle Architecture`](../../../docs/architecture/storage-lifecycle.md)
