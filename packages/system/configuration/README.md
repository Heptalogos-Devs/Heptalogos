# @heptalogos/configuration

## Purpose

configuration owns the current Product ConfigurationDefinition,
ConfigurationRevision, ConfigurationActivation, and effective-value semantics.
The Product composition supplies the current owner definitions; this package
provides the generic bounded managed-revision route consumed by their real
runtime owners.

## Owns

- Composition-provided code-owned definitions and their JSON Schema contracts.
- Immutable PostgreSQL-backed managed revisions.
- Explicit Host-fenced activation CAS and effective-value resolution.
- Configuration metadata and redacted read projections.

## Does not own

- Secret plaintext or OS credential storage.
- Configuration files, watchers, import/export, or a source registry.
- Provider SDK objects, runtime reconciliation, or Management authorization.
- A second persistence or transaction boundary.

The current Product Host registers its product settings definition. Independent
packages may supply their own definitions; the service contains no model or
gateway-specific validation. Concurrent initial activation uses the same CAS
conflict semantics as replacement of an existing revision.

## Verification

Use the real PostgreSQL Product Host integration for activation persistence
and restart changes, and package lint/typecheck for interface changes.

## Knowledge references

- [Configuration Spec](../../../specs/system/configuration.md)
- [Persistence Transactions](../../../specs/data/persistence-transactions.md)
- [System Authority Spec](../../../specs/management/system-authority.md)

`getEffectiveRevision`, `getActivation` and `getRevision` accept an optional caller transaction as the final argument. An in-transaction effective read holds a shared lock on the current activation through the caller's commit, while reusing the ordinary canonical revision parser.
