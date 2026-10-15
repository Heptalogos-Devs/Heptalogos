# Workspace packages

`packages/` contains product and Foundation workspace packages in a uniform
two-level hierarchy:

```text
packages/<group>/<package>/
```

Group directories are documentation and ownership containers. They do not have
`package.json` files. Package npm names and import specifiers remain canonical;
physical grouping follows semantic ownership, dependency edges, and expected
co-change rather than file size.

Current groups:

| Group                                | Role                                                              | Members                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| system                               | Cross-cutting system adapters and Management semantic services    | `os-credential`, `management`                                                                    |
| application                          | Headless Product Host and client projections                      | `product-host`, `management-client`, `cli`                                                       |
| [foundation](./foundation/README.md) | Shared contracts, schema mechanics, and time                      | `foundation-contracts`, `schema-runtime`, `time-service`                                         |
| [bootstrap](./bootstrap/README.md)   | Installation, private PostgreSQL, and Host authority              | `bootstrap-state`, `bootstrap-runtime`, `private-postgres`, `host-ownership`                     |
| [data](./data/README.md)             | Canonical schema and Host-fenced persistence                      | `canonical-schema`, `persistence`                                                                |
| [runtime](./runtime/README.md)       | In-process substrate and semantic runtime reconciliation          | `runtime-substrate`, `runtime-kernel`                                                            |
| [execution](./execution/README.md)   | Lineage, evidence, signals, durable work, DBOS, and effects       | `execution-lineage`, `evidence`, `signal`, `work-queue`, `durable-execution`, `effect-operation` |
| [product](./product/README.md)       | Current Product semantic owners and bounded vertical capabilities | `subject`, `messaging`                                                                           |

Each package README owns its package purpose, semantic boundary, public
surface, verification, and handoffs. Group READMEs own only their local map and
cross-group relationships. The [package INDEX](INDEX.md) is the retrieval index;
exact normative behavior belongs in Specs, persistent package-workspace
behavior belongs in `packages/AGENTS.md`, and human procedures belong in
`project/engineering/`.
