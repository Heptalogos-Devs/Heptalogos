# Repository scripts

The scripts tree is the repository control plane:

- `verify/` — permanent, independently runnable leaf gates.
- Aggregate repository orchestration belongs to Nx project targets.
- `maintenance/` — safe repository mutation and cleanup commands.
- `package/` — production closure assembly, Linux installation, and Windows portable packaging; usage starts at the [Product Host](../packages/application/product-host/README.md).
- `tools/repo-kit/` — reusable implementation, tests, and process mechanics.

Phase-specific acceptance scripts are not archives. Their commands and results
belong in completed plans and Git history; they do not remain as dead tools in
the current tree. `release/`, `generate/`, and `i18n/` directories appear only
when current work has a real owner and consumer.

Scripts contain repository control-plane behavior, never product runtime logic.
