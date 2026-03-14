# Fix: Server CPU Pegged at 98% by `getLatestRunsForProject` Query

## Root Cause

`CommandRunRepository.getLatestRunsForProject()` uses `SELECT cr.*` inside a window function query. The `command_runs` table contains **147 MB of command output text** across 1,736 rows (avg 85KB, max 1.4MB per row). The `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)` forces SQLite to sort all rows — including the massive `output` column — causing it to spill to disk via `vdbeSorterFlushPMA`. This blocks the main thread synchronously for seconds per call, and the frontend polls this endpoint every ~5 seconds, creating a permanent CPU spin.

## Evidence

- **macOS `sample`**: 100% of main thread samples in `Statement::JS_all` → `sqlite3_step` → `vdbeSorterFlushPMA` → `pwrite`
- **V8 CPU profile**: `getLatestRunsForProject` at `CommandRunRepository.js:142` is the only hot JS function
- **Data**: 147MB total in `output` column, SQLite can't sort in-memory so it writes temp files to disk

## Fix Plan

### Step 1: Exclude `output` from the window function query
**File:** `packages/server/src/db/CommandRunRepository.js` (~line 146)

Change the inner SELECT from `cr.*` to only the columns needed:
```sql
SELECT cr.id, cr.session_id, cr.button_id, cr.label, cr.command,
       cr.status, cr.exit_code, cr.started_at, cr.completed_at,
       ROW_NUMBER() OVER (...) as rn
FROM command_runs cr
```

This reduces the sort payload from ~147MB to a few KB — the query will go from seconds to milliseconds.

### Step 2: Verify the API consumer doesn't need `output`
**File:** `packages/server/src/api/projects.js` (~line 140-176)

The endpoint builds `latestCommandRuns` for each session using only:
- `buttonId`, `status`, `exitCode`, `id`, `completedAt`

The `output` field is never used here — it's only needed when viewing a specific run's output. Confirm and document this.

### Step 3: Add an index to speed up the JOIN + filter
**File:** `packages/server/src/db/CommandRunRepository.js` or migration

Check if an index on `command_runs(session_id, button_id, completed_at DESC)` exists. If not, add one to make the window function's partition/sort use an index scan instead of a full table sort.

### Step 4: Verify the fix
- Restart the server after the change
- Monitor CPU with `ps aux | grep node` — should drop from ~95% to <5% idle
- Confirm the session list endpoint responds in <50ms

## Risk Assessment

**Low risk.** We're only changing which columns are selected in a read-only query. The `output` column is not used by the consuming code in `projects.js`. No schema changes, no behavioral changes — sessions list will load the same data, just without carrying 147MB of unused text through the sort.
