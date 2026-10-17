# Canonical Schema Contract

## Scope

This Spec defines the current canonical PostgreSQL schema and validation
boundary used by Foundation packages. It does not define owner-native Extension
schemas.

## Ownership

`canonical-schema` owns the current development baseline and schema initializer.
Domain packages own the meaning of their tables through their repository
contracts; `schema-runtime` owns generic validation mechanics.

## Invariants

- `SCHEMA-001` Current canonical schema is a single versioned baseline for the
  `PRE_PRODUCTION` tree. Development migration history does not create a
  compatibility reader requirement.
- `SCHEMA-002` Canonical tables, constraints, indexes, and functions MUST
  preserve the Authority and ownership defined by the owning Spec; projections
  and indexes do not become canonical truth.
- `SCHEMA-003` Canonical input validation MUST be non-mutating: no silent
  coercion, default insertion, or removal of unknown fields.
- `SCHEMA-004` Unsupported shape, schema version, or unknown required boundary
  MUST be rejected with bounded diagnostics at the owner boundary.
- `SCHEMA-005` Any stable cross-process digest MUST use the repository's
  versioned canonical JSON and domain/purpose-separated digest contract.
- `SCHEMA-006` When a current PRE_PRODUCTION shape changes, update callers/tests
  and the current baseline, then delete the obsolete runtime shape. Disposable
  development fixtures may be reset. Existing Subject data, actual materials and
  retained model results covered by the active Plan use a bounded owner-specific
  one-time migration; they are not discarded to avoid migration work. This does
  not create a historical decoder or dual-write obligation.

## Stored ObservationInput domain-time upgrade

Migration `0011_observation_domain_time` upgrades only canonical SDK envelopes:
`life_native_input.registration.contacts[].observation`, its actual
`firstContact.contacts` snapshot, the exact Registration copies in
`life_native_run` and `life_handoff`, `life_native_contact.response.contacts`, and
`cognition_pending_feedback.observation`. A bare protobuf TemporalExtent becomes
`{timeDomainRef:"time:real",extent:originalExtent}`; already current envelopes and
absent times stay unchanged. Historical contacts receive no invented world
observation mapping.

The migration receives the initializer's existing database/transaction handle.
Only a changed pending observation's `factsDigest` is recomputed, using the same
`host.native-cognition.v1` canonical JSON domain and excluding `observedAt` as the
owning feedback operation does. Prompt/dispatch/contact-request digests, stable
IDs, actual UTC observation time, receipts and source payloads stay intact.
RoleRun results, release payloads, native history, prompts and embedded raw
material are outside this transformation. Normal SDK decoding remains strict.

## Verification Claims

Schema conformance uses current vectors, strict validation, non-mutation checks,
unknown-field diagnostics, and real PostgreSQL where transaction/constraint
behavior is part of the claim.

## References

- [`persistence-transactions.md`](./persistence-transactions.md)
- [`pre-production-evolution.md`](../../project/governance/pre-production-evolution.md)
- [`canonical-schema`](../../packages/data/canonical-schema/README.md)
- [`schema-runtime`](../../packages/foundation/schema-runtime/README.md)
