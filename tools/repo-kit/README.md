# @heptalogos/repo-kit

## Purpose

`@heptalogos/repo-kit` contains reusable, repository-owned mechanics for
verification scripts and their tests. It keeps process execution, current-tree
hygiene scanning, and related test fixtures out of individual gate entrypoints
while leaving policy decisions visible in the repository scripts and current
knowledge owners.
This is development tooling, not a Heptalogos product or Foundation runtime
dependency.

## Owns

- Thin process-runner mechanics used by repository commands.
- Current-tree hygiene scanning and finding normalization.
- Version Authority readers for the package-manager baseline and workspace catalog.
- Public package declaration-entrypoint and structured TypeDoc reflection checks.
- Small reusable helpers that have a concrete repeated repository need.

## Does not own

- Product semantics, runtime lifecycle, or data/authority contracts.
- Architecture decisions or compatibility obligations.
- A checksum catalog, file manifest, or generic gate bypass.
- Repository task graph or scheduling; Nx owns that mechanic.
- YAML parsing, glob discovery, or generic subprocess orchestration; `yaml`,
  `tinyglobby`, and Execa own those mechanics behind repo-kit policy helpers.
- Direct mutation of product state or developer databases.

## Public surface

The package exports the reusable mechanics from `src/index.mjs`, including the
current-tree scanner, process helper, package-export, and TypeDoc reflection
modules. Verification entrypoints under
`scripts/verify` call these helpers and remain responsible for command-line
exit status and claim-specific policy. The existing repository commands exercise the helpers against the current checkout.

## Dependencies and boundaries

The package uses the adopted `execa`, `yaml`, and `tinyglobby` routes with Node
standard-library mechanics. It may inspect repository files and run bounded
repository commands, but it must not become a second production execution
layer. Nx owns project discovery, task graphs, and scheduling; repo-kit only
composes adopted mechanics with repository policy. API verification consumes
the product package set discovered by the workspace owner and checks TypeDoc's
structured reflection before accepting generated Markdown. Gate findings must
remain actionable and must not silently ignore current identity or compatibility
register failures.

## Verification

Run `pnpm nx run repo-kit:lint` and the repository command that consumes the
changed helper. `pnpm check:hygiene`, `pnpm check:package-layout`,
`pnpm check:knowledge` and the other existing commands own their current
checkout checks.

## Architecture references

Read the repository `AGENTS.md`, the mechanics ownership and library-first
playbook, the repository verification and current-tree hygiene playbooks, and
the relevant current knowledge documents before changing repository mechanics
or finding codes.
