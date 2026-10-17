# Heptalogos repository index

Long-term product design is maintained in [Architecture-Vault](https://github.com/Heptalogos-Devs/Architecture-Vault). This repository owns the implementation of that design.

| Area                                | Primary entry                                                      | Responsibility                                                |
| ----------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| Engineering governance              | [project/governance/README.md](project/governance/README.md)       | Standing repository posture and execution rules               |
| Current implementation architecture | [docs/architecture/README.md](docs/architecture/README.md)         | How the current Heptalogos codebase realizes product concepts |
| Normative implementation contracts  | [specs/README.md](specs/README.md)                                 | Exact operations, state, failure and persistence contracts    |
| Plans and roadmap                   | [project/README.md](project/README.md)                             | Current sequencing and implementation authorization           |
| Qualification                       | [project/qualification/](project/qualification/)                   | Executed evidence and product qualification                   |
| Packages                            | [packages/README.md](packages/README.md)                           | Package ownership and public surfaces                         |
| Integration                         | [integration/README.md](integration/README.md)                     | Cross-package executable composition                          |
| Agent procedures                    | [.agents/skills/AGENTS.md](.agents/skills/AGENTS.md)               | Reusable implementation procedures                            |
| CI workflow                         | [.github/workflows/verify.yml](.github/workflows/verify.yml)       | Repository verification workflow definition                   |
| Verification scripts                | [scripts/README.md](scripts/README.md)                             | Repository and documentation checks                           |
| Cross-project tests                 | [tests/toolchain/ts6-api-lane.ts](tests/toolchain/ts6-api-lane.ts) | Test support outside package ownership                        |
| Repository tooling                  | [tools/repo-kit/README.md](tools/repo-kit/README.md)               | Shared repository validation and maintenance tools            |
| Official SDK inputs                 | [vendor/nous-wave/README.md](vendor/nous-wave/README.md)           | Unchanged sealed Nous archives, provenance and integrity      |

Target design and rationale are not duplicated here. Historical implementation plans remain under `project/plans/completed/` when they are retained as execution evidence.
