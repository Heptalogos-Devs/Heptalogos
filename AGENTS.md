# AGENTS.md

Repository-wide execution contract for Heptalogos.

## Work authorization

Implement only the explicitly designated active Plan. A Plan authorizes bounded work; it does not create permanent product semantics. If execution requires a new product owner, durable state distinction, authority rule, failure model or provider role that the Plan does not decide, report `PLAN_GAP`.

## Design authority

Long-term Heptalogos and Nous Wave target design lives in `Heptalogos-Devs/Architecture-Vault`.

For architecture work, read the relevant Vault target design, accepted decisions and cross-system contract. For normal coding, read only the design material named by the active Plan; broad architecture research is not default implementation context.

Repository authority for implementation work is:

1. root and scoped `AGENTS.md`;
2. `project/governance/project-charter.md` and `project/governance/constitution.md`;
3. the designated active Plan;
4. current repository Specs and dependency decisions required by that Plan;
5. current implementation-facing architecture and package documentation;
6. code, tests and focused verification.

A repository Spec must implement the accepted target design. Existing code or an older Spec does not override Vault target semantics.

## Product split

Heptalogos owns product runtime and agency: interaction, Reaction, Pursuit, behavior review and commit, commitments, messaging effects, system management and runtime reliability.

Nous Wave owns long-term cognition: Memory, Self, Social Cognition, Motivation and cognitive runtime. Cognition reaches Heptalogos through typed queries, context and proposals. Heptalogos does not duplicate the cognition ontology.

## Rapid PRE_PRODUCTION

`DevelopmentMode = RAPID_EVOLUTION` and `CompatibilityEpoch = PRE_PRODUCTION`.

Existing code, tests and documents have no preservation privilege. Remove or rewrite obsolete development shapes directly. Add compatibility only when a current obligation declares it.

## Ownership and mechanics

Canonical mutations stay behind their semantic owner. Use mature libraries and platform facilities for generic mechanics when suitable. Framework objects remain behind owned adapters and do not become product Authority.

Read `project/dependencies/README.md` before changing generic mechanics or Provider routes. The decision ledger records `ADOPTED` roles; `dependency-routing.json` records their machine-readable routes and `USE` directives. Implement the selected route behind its declared adapter; an unresolved foundational Provider choice is `PLAN_GAP`.

Do not let Provider or queue-private pressure thresholds silently decide product admission or degradation. Resource-pressure state and its Authority/Readiness effects belong to the owning product contract.

Do not add speculative state, background workers, rollback paths, recovery machinery, generic abstractions or test seams without a current consumer, invariant, accepted failure model or explicit Plan requirement.

## Evidence

Claims use PASS, FAIL, NOT_RUN or BLOCKED and stay within the boundary actually exercised. Current documents describe current truth. Git history, completed Plans and retained qualification evidence preserve chronology.

## Current execution policy

Ordinary GitHub Actions are not a required execution route. Keep `pnpm verify` runnable and use the verification required by the active Plan.

## Verification and process cost

TDD is optional. Tests must protect a current contract, observed risk, or meaningful uncertainty; do not add tests merely to show that unimplemented behavior is absent. During iteration, use the affected check that can falsify the change; do not require the full repository suite for every edit. Honor the active Plan's independent per-repository test-count and support-code budgets. New installations do not enable autostart or paid work by default. Do not add speculative validators, recovery layers, or process gates for hypothetical future work.

## Completion

When the Plan's acceptance conditions and required executable proof are complete, stop. Further cleanup or hardening requires new authorization.
