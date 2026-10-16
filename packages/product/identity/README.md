# @heptalogos/identity

Identity owns opaque Host Entity references in `entity:heptalogos:<uuid>` form and the formal association of
external accounts, authenticated UIDs, groups and a cognitive Subject's own
Host identity. It owns no cognition and makes no network calls.

## Public surface

`createIdentityService({ persistence })` consumes the caller's current
Host-fenced Activity. All wire input/output contracts are exported as TypeBox
schemas and their Static types from [`src/contracts.ts`](./src/contracts.ts).

`resolveAccount` accepts platform plus the exact string account id and optional
authenticated UID. Repeated and concurrent resolution returns one Entity.
Nicknames and group cards are presentation facts and are not identity keys.
Conflicting existing account/UID mappings fail with `identity.link_conflict`;
this package never guesses which person should absorb another's identity.

`resolveGroup` creates an independent Group Entity, even when a native group id
matches a person's account id. `linkAccount` links a new authenticated account
or platform key to an explicitly authorized existing person/Subject Entity;
it does not silently merge two already established Entities.

`ensureSubjectEntity` and `readSubjectEntity` maintain a Subject's own Host
Entity separately from its Nous Subject id. `bindSubjectAccount` attaches an
unassigned QQ account/UID to that Entity. Rebinding another account preserves
the same Host Entity and does not create or replace a cognitive Subject. Bind
the self account through this API before resolving it as an unrelated person;
preexisting contradictory mappings require explicit reconciliation.

Only Identity encodes or decodes EntityRefs; callers pass the returned opaque
reference unchanged. Its private canonical columns retain UUIDs.

The canonical migration owns `identity_entity`, `identity_external_key` and
`identity_subject`. A short transaction-level identity lock serializes formal
linkage and prevents account/UID intersections from producing competing owners.
Persistence supplies the fence; lineage references point to the actual Host
Activity that established each Entity.

## Verification

The existing Foundation PostgreSQL fixture exercises concurrent account/UID
resolution, explicit cross-platform association, conflicting authenticated
keys, Group separation and Subject account changes:

```sh
HEPTALOGOS_TEST_PG_BIN=/absolute/postgresql/bin \
  pnpm exec vitest run --root integration/foundation \
  test/messaging-identity.integration.test.ts
```

This owner does not infer social relationships or authorize platform or Host
management actions.
