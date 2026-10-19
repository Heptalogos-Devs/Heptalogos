# @heptalogos/evidence

## Purpose

`evidence` defines and stores retained Evidence records for Foundation
operations. It separates a typed Evidence draft from the persisted record and
provides the service that writes and reads those records through the normal
persistence boundary. Evidence makes qualification and operational claims
traceable without becoming a generic logging or telemetry replacement.

## Owns

- Evidence draft and record contracts.
- Evidence service construction and persistence integration.
- Retained Evidence semantics required by current Foundation flows.

## Does not own

- ExecutionContext or Activity identity and lineage propagation.
- Generic logging, metrics, traces, or telemetry transport.
- Arbitrary application persistence or product policy.
- Qualification closure decisions that belong to current evidence projections.

## Public surface

The package exports `EvidenceDraft`, `EvidenceRecord`, `EvidenceService`, and
`createEvidenceService`. The service uses the caller's persistence and time
contracts and is the package route for reading and writing Evidence tables.

## Dependencies and boundaries

It depends on `foundation-contracts`, `persistence`, `time-service`, and Kysely.
Persistence remains the database mutation owner while this package owns the
Evidence semantic contract. Execution lineage can correlate a record without
becoming a second Evidence store or identity Authority.

## Verification

`integration/foundation/test/execution-foundation.integration.test.ts`
checks canonical state, Activity and required Evidence in one real PostgreSQL
transaction, including rollback after Evidence rejection. Run the affected
scenario and package lint/typecheck for changes.

## Architecture references

- [`Evidence Spec`](../../../specs/execution/evidence.md)
- [`Execution lineage Spec`](../../../specs/execution/execution-lineage.md)
- [`Persistence transaction Spec`](../../../specs/data/persistence-transactions.md)
- [`Verification system`](../../../project/qualification/verification-system.md)
- [`Data, evidence, and persistence Architecture`](../../../docs/architecture/data-evidence-persistence.md)
