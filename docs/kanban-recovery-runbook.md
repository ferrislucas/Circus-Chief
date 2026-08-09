# Kanban hard-cutover recovery runbook

The recovery command is versioned as `kanban-recovery/v1`. It is a preflight and ownership-reconciliation tool for a copied incident database or a stopped production installation.

## Rehearse on a copied database

Stop workers for the copy and point `DB_PATH` at it. The default command opens the database read-only, emits JSON, and makes no schema or ownership changes.

```sh
DB_PATH=/safe/copies/incident.db yarn workspace @circuschief/server kanban:recover
```

Resolve every reported invalid lane configuration before an apply: a completion target requires on-entry automation and targets must remain on the same board.

## Maintenance-window apply

1. Stop application workers and retain the original database until the workflow observation is complete.
2. Run the dry-run command above and save its JSON report.
3. Apply explicitly:

```sh
DB_PATH=/var/lib/circuschief/app.db yarn workspace @circuschief/server kanban:recover --apply
```

`--apply` creates a timestamped SQLite backup (including present WAL/SHM sidecars), compares SHA-256 digests and sizes before opening the database for migration, then migrates, reconciles, and performs a fresh invariant audit. A failed backup check blocks all mutation.

4. Restart workers only when the final report has `blocked: false` and `report.ok: true`.
5. Observe one intended circuit for each recovered workspace, then run the planned restart/duplicate-request/provider-limit/delayed-schedule/manual-move soak.

The command never invents ownership for ambiguous historical workers: reconciliation cancels stale or unowned executable workers and creates no replacement unless normal lane-entry automation establishes an unambiguous owner.
