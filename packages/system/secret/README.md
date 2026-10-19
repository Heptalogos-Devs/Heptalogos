# @heptalogos/secret

## Purpose

secret owns normal Product SecretRef identity, metadata, scope authorization,
replacement, revocation, and callback-scoped resolution through the existing
OS credential adapter.

## Owns

- SecretRef and redacted SecretMetadata.
- Current backend generation and replacement/revocation semantics.
- Consumer, purpose, and resource-scope authorization.
- Fail-closed ephemeral material resolution.

## Does not own

- BootstrapKeyProvider or Machine Operations/OpenClaw credentials.
- Plaintext configuration, reveal/export, fallback storage, or a secret manager.
- Direct keyring mechanics, Product Management authorization, or provider logic.

## Verification

Use the real Product Host integration with the current OS credential profile
for backend and restart changes. `os-credential` retains the native credential
boundary tests.

## Knowledge references

- [Secret Spec](../../../specs/system/secret.md)
- [OS credential boundary](../os-credential/README.md)
- [Persistence Transactions](../../../specs/data/persistence-transactions.md)
