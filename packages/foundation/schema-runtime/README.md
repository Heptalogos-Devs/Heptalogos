# @heptalogos/schema-runtime

## Purpose

`schema-runtime` provides generic runtime schema compilation and validation
mechanics used by Foundation contracts. It wraps the adopted Ajv and TypeBox
route behind a small typed result interface so callers can validate data without
coupling their public contracts to a validator implementation. It is a generic
mechanics package, not a product schema Authority.

## Owns

- `SchemaValidator` and validation issue/result contracts.
- Runtime compilation and validation through `compileSchema`.
- The `./typebox` integration surface for approved schema construction.

## Does not own

- Product/domain schema definitions or migration policy.
- Compatibility obligations, upcasting, or fallback parsing.
- Persistence, serialization Authority, or runtime lifecycle.
- Transport-specific schema behavior.

## Public surface

The root entry point exports schema validation issue/result/validator types and
`compileSchema`. The `./typebox` subpath exposes the explicitly routed TypeBox
mechanics. Consumers translate results into their own domain contracts without
exposing Ajv internals as product Authority. The repository schema lint keeps
direct Ajv/TypeBox imports inside this package.

## Dependencies and boundaries

It depends on Ajv and TypeBox only. The implementation is deterministic and
side-effect free, with no database, filesystem, framework, or network behavior.
Current PRE_PRODUCTION shapes are defined by their owning package, and
unsupported shapes fail according to that package's contract.

## Verification

Schema acceptance is checked at the current owner consumer: Bootstrap state
recovery, WorkQueue admission and native Host boundaries. Run the affected
consumer and package lint/typecheck for validation changes.

## Architecture references

- [`Engineering principles`](../../../project/governance/engineering-principles.md)
- [`Data, evidence, and persistence Architecture`](../../../docs/architecture/data-evidence-persistence.md)
- [`Canonical schema Spec`](../../../specs/data/canonical-schema.md)
- [`Verification system`](../../../project/qualification/verification-system.md)
- [`Dependency implementation routing`](../../../project/dependencies/implementation-routing.md)
