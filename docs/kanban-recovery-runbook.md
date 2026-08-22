# Kanban hard-cutover recovery runbook

The recovery command is versioned as `kanban-recovery/v1`. It is a preflight and ownership-reconciliation tool for a copied incident database or a stopped production installation.

## Rehearse on a copied database

Stop workers for the copy and point `DB_PATH` at it. The default command opens the database read-only, emits JSON, and makes no schema or ownership changes.

```sh
DB_PATH=/safe/copies/incident.db yarn workspace @circuschief/server kanban:recover
```

Resolve every reported invalid lane configuration before an apply: a completion target requires on-entry automation and targets must remain on the same board. The hard-cutover migration intentionally preserves legacy target-only routing instead of clearing it; those lanes are recorded in `kanban_migration_notes` and block automation until repaired deliberately.

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

## Runtime availability and API conflicts

`GET /api/server-info` reports HTTP reachability separately from Kanban
automation under `automationStatus`. When preflight is blocked, the server stays
reachable but reports `automation: "degraded"` with `reasonCode:
"KANBAN_PREFLIGHT_FAILED"` and a safe recovery message. Run the recovery command
and restart the server to restore automation.

The board surfaces an "Automation disabled" badge in its header for that
`KANBAN_PREFLIGHT_FAILED` case only, checked once per board mount. Delivery
health is deliberately not surfaced in the UI: it is a heuristic over event
counts, so diagnose it from `GET /api/server-info` rather than expecting a
board indicator.

The same status now includes live `deliveryHealth`: pending, actively claimed,
stalled, ambiguous, exhausted, quarantined, and completed event counts plus
the oldest outstanding age. `ambiguous` means a child was allocated and a
provider dispatch intent was written, but no provider acknowledgement was
persisted. Do not manually retry it: preserve the provider records and
quarantine or reconcile it before creating replacement work. Exhausted,
stalled, and quarantined entries degrade Kanban health even after a clean
startup preflight.

Because `failed` and `invalid` are terminal and nothing ages them out, the
`exhausted` and `quarantined` counts are scoped to a rolling window (default 24
hours, reported as `terminalWindowMs`) measured from each event's terminal
timestamp (`completed_at`, falling back to `created_at`). Without that window a
single historical failure would hold Kanban health at `degraded` permanently.
The other counts are unwindowed.

## Stream watchdog

The in-process stream watchdog handles provider streams that ignore an abort.
An already-aborted stream is reaped after `STREAM_WATCHDOG_ABORT_GRACE_MS`
(default: 5 minutes). It is recorded as `stopped`, rather than `error`, because
the wedge does not prove that the underlying work failed. A second, opt-in
silence tier is controlled by `STREAM_WATCHDOG_SILENCE_MS` (default: `0`,
disabled); enable it only when your provider/tool-call timing is well known.
The worker checks every `STREAM_WATCHDOG_INTERVAL_MS` (default: 15 seconds).

Terminal rows older than the window are still on disk but are reported by
neither `deliveryHealth` nor `kanban-recovery`, whose audit covers only
`pending` and `claimed` events. To investigate an older incident, pass a wider
`terminalWindowMs` threshold or query `kanban_lane_entry_events` directly:

```sql
SELECT id, cause, status, attempt_count, last_error, completed_at
FROM kanban_lane_entry_events WHERE status IN ('failed','invalid')
ORDER BY COALESCE(completed_at, created_at) DESC;
```

Mutating card-add and card-move calls accept an optional `Idempotency-Key`.
Replaying the same key and payload after a completed operation returns the
original operation result. A failed mutation is retained as retryable, so a
same-key retry re-attempts the request rather than replaying a transient 500;
reusing a key with different input returns `409`. Keyed mutation responses
include `operationId` and delivery identity, which can be queried at
`GET /api/projects/:projectId/kanban/operations/:operationId`.

At most five client-initiated attempts are accepted for one key; lease-expiry
recovery does not consume that budget. After the limit, the key returns a stable 500
until it is removed. Use the `Reference ID: <uuid>` in that response to find
the matching `[Kanban operation failure] correlationId=<uuid>` server log.
Once the failure is confirmed, it is safe to clear the poisoned key because a
failed operation commits no partial board mutation:

```sql
DELETE FROM kanban_api_operations WHERE project_id=? AND operation_key=?;
```

Calls that attempt to run or schedule a superseded lane worker receive `409`
with `code: "LANE_RUN_OWNERSHIP_LOST"`. Re-open the board and act on the current
card/run instead of retrying the stale request. Invalid lane configurations
(such as a completion target without on-entry automation) return a 400 with a
stable `KANBAN_LANE_*` code and field name.

Completed and unretried failed keyed API operations are retained for 30 days, then removed in
bounded batches of 500 once per hour. Processing operations are never removed.
Cleanup logs both the number deleted and the remaining eligible backlog; a
non-zero backlog is expected to drain over subsequent hourly batches.
## Kanban recovery and trust boundary

## Move attribution

Kanban's session caller header is **attribution, not authentication**. The
local Circus Chief API currently has no authentication layer and may be exposed
for remote-access workflows; session IDs and the caller header must therefore
not be treated as secrets or as an authorization boundary.

Moves are unconditional and always supersede a running worker. Exit-lane
declarations use the separate non-destructive `PUT .../exit-lane` endpoint and
require no caller identity; the card stays put until the run completes. The
caller header is audit attribution only. Deployments that expose the API to
untrusted networks need a reverse proxy or equivalent access control;
capability-based session authentication is a separate security feature.
