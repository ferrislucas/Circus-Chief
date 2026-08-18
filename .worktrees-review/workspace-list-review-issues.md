# Workspace List Branch — Code Review Remediation Plan

**Branch:** `circus-chief/3795-simplify-workspace-list-short-`
**Compared against:** `origin/main` = `be774cc055b7a71746cd83245dec8fab95142601`
**Branch merge-base:** `8a9631790a51076dd78d1ba5d3d734b316ea599d`
**Reviewed:** 2026-08-17. Server tests: 5084 passed. Web tests: 4835 passed.

The branch implements a purpose-built workspace-card list read model (`GET /api/projects/:projectId/workspaces?view=cards`), a denormalized `sessions.last_activity_at` column maintained by SQLite triggers, cursor+offset pagination, local realtime patching of single-card events, and removal of the legacy summary/filtering composables. The overall quality is high — the issues below are ordered by severity. Each phase is self-contained: it can be fixed and verified without reading anything else.

> **Key repo conventions**
> - Monorepo: `packages/server` (Express + better-sqlite3), `packages/web` (Vue 3 + Pinia), `packages/shared` (Zod contracts).
> - Unit tests: `yarn workspace @circuschief/server test src/<path>.test.js` / `yarn workspace @circuschief/web test src/<path>.test.js`.
> - E2E: `./scripts/pw.sh test tests/e2e/<file>.spec.ts` (never port 5000; the wrapper auto-assigns a worktree port).
> - Diff target for all reviews is **origin/main**, not local main.

---

## Phase 1 — (High · merge risk) Branch silently reverts main's automation-banner fix

### Context

This branch forked from merge-base `8a9631790a51076dd78d1ba5d3d734b316ea599d`. **After** that point, main received three commits that are NOT on this branch:

| Commit | Subject | Files |
|---|---|---|
| `28fb4861` | Remove Kanban automation status banner | `KanbanBoard.vue`, `KanbanBoard.css`, `KanbanBoard.test.js` |
| `6cf4c0a1` | Scope automation health to real failures and re-surface preflight | `kanbanRecoveryService.js(+test)`, `KanbanBoard.vue(+test+css)`, `docs/kanban-recovery-runbook.md` |
| `be774cc0` | Merge PR #1088 | same files |

Because the branch still contains the **old** (pre-fix) versions of these files, `git diff origin/main..HEAD` *appears* to show this branch restoring the banner. It did not author that change — but if the branch merges as-is, git will keep the branch's old content (no conflict in some hunks because the branch never touched those regions since fork), reintroducing a bug main explicitly fixed.

### The bug being reverted

Old behavior (what this branch carries):

1. `packages/web/src/components/KanbanBoard.vue` — an `automation-warning` banner rendered at the top of the board, driven by `automationWarning = ref('Checking automation status…')`, refreshed by `setInterval(fetchAutomationStatus, 30_000)` on mount, cleared on unmount. It shows whenever `status?.kanban !== 'operational'`.
2. `packages/server/src/services/kanbanRecoveryService.js` — `getKanbanDeliveryHealth()` counts `failed` / `invalid` kanban_lane_entry_events **for all time**:
   ```js
   exhausted: count("SELECT count(*) count FROM kanban_lane_entry_events WHERE status='failed'"),
   quarantined: count("SELECT count(*) count FROM kanban_lane_entry_events WHERE status='invalid'"),
   ```
   Those statuses are terminal and nothing ever ages them out, so **one historical failure pins board health to "degraded" forever** — and the banner says "Automation unavailable" permanently with a misleading message. This is exactly the incident described in `28fb4861`'s commit message ("Two stale rows from a since-fixed schema mismatch pinned it on permanently").

Main's fix (`6cf4c0a1`):

1. Windowed the terminal counts on a rolling window (default 24 h) keyed off `COALESCE(completed_at, created_at)`, reported as `terminalWindowMs` in the return value.
2. Replaced the always-polling banner with a once-per-mount badge that surfaces **only** `reasonCode === 'KANBAN_PREFLIGHT_FAILED'` (a real boot-time boolean), explicitly *not* the delivery-health heuristic.
3. Updated `docs/kanban-recovery-runbook.md` to document the window and the SQL to investigate older incidents.

### How to fix

1. Merge `origin/main` into the branch (or rebase onto it) **before any further feature work lands**:
   ```bash
   git fetch origin main
   git merge origin/main
   ```
2. Resolve conflicts in favor of **main's** version for:
   - `packages/server/src/services/kanbanRecoveryService.js` (keep the windowed queries + `terminalWindowMs`)
   - `packages/server/src/services/kanbanRecoveryService.test.js` (keep the windowing tests)
   - `packages/web/src/components/KanbanBoard.vue` (keep the single-mount preflight-only badge; drop the branch's `automation-warning` banner, interval, and `AUTOMATION_STATUS_REFRESH_MS`)
   - `packages/web/src/components/KanbanBoard.css` (keep main's `.automation-badge` styling; drop `.automation-warning`)
   - `packages/web/src/components/KanbanBoard.test.js`
   - `docs/kanban-recovery-runbook.md` (keep main's terminal-window documentation)
3. The branch itself made **no** changes to these files (verified: `git log 8a96317..HEAD -- <file>` is empty for all six), so there is no branch-side intent to preserve — take main's side wholesale.

### Verify

```bash
git diff origin/main..HEAD -- packages/server/src/services/kanbanRecoveryService.js \
  packages/web/src/components/KanbanBoard.vue packages/web/src/components/KanbanBoard.css \
  packages/web/src/components/KanbanBoard.test.js docs/kanban-recovery-runbook.md
# Expect: empty (or only trivial context noise)
yarn workspace @circuschief/server test src/services/kanbanRecoveryService.test.js
yarn workspace @circuschief/web test src/components/KanbanBoard.test.js
```

Manual: on the Kanban tab, no warning banner when health is fine; after a genuine preflight failure, the compact "Automation disabled" badge appears once (no 30 s polling network requests in the devtools waterfall).

---

## Phase 2 — (High · scalability) Every list refresh runs the aggregate CTE twice, and refreshes are event-driven

### Context

`packages/server/src/db/workspace-queries.js` defines `WORKSPACE_AGGREGATES_CTE` — a `WITH RECURSIVE` query that walks every workspace tree in a project (with an `instr(tree.path, ...)` cycle guard) and aggregates running/scheduled/waiting counts, member ids, and `MAX(last_activity_at)` per root.

Two functions execute it:

1. `getWorkspaceCardPage(db, projectId, options)` — builds the card page, then **at the bottom of the function** calls:
   ```js
   const facets = getWorkspaceCardCounts(db, projectId, { archived, starred, scheduled });
   ```
2. `getWorkspaceCardCounts(db, projectId, options)` — re-runs the identical CTE just to compute `{ running, idle }`.

So **one HTTP request = two full project-tree scans**. The tree walk is the expensive part (it joins `sessions` to itself recursively and groups per root); LIMIT only bounds what's *returned*, not the scan (the aggregates must be known before the sort/filter/limit can apply — this is documented in the module header comment).

Meanwhile, on the client, `packages/web/src/composables/useWorkspaceListRealtime.js` registers `onSessionUpdated` (and 6 other membership events) to trigger a **debounced 1 s full refresh**, and `workspaceList.refresh()` re-fetches the **entire loaded extent** (`fetchLoadedExtent` — loops pages of up to 500 until the previously-loaded card count is rebuilt).

On the server, `SESSION_UPDATED` is broadcast to project subscribers from **17 call sites** across `services/sessionManager.js`, `services/streamUsageHandler.js` (fires at usage-final, i.e. every model turn end), `services/promptStore.js` (every permission prompt enqueue/settle/expiry), `services/kanbanTriggers.js`, `api/sessions-patch.js`, `api/sessions-archive.js`, `services/sessionStartupRecovery.js`, `services/draftSessionService.js`, `services/schedulerService.js`, `services/templateTriggerService.js`, `services/summaryBroadcast.js`, `api/projects-session-create.js`.

Result: with a handful of active sessions and the list scrolled deep, the client issues back-to-back full-extent refreshes, each costing **two** project-tree scans server-side. Cost scales with both project size *and* scroll depth. SQLite is single-writer; this also competes with trigger-maintained writes on `sessions`.

### How to fix

**Part A — collapse the duplicate scan (mechanical, do first).** Compute page and facets from a single statement. Two acceptable approaches:

- Option 1 (preferred): make `getWorkspaceCardPage` issue one prepared statement whose CTE produces *both* result shapes via a trailing `UNION ALL`: first branch selects the filtered/ordered/limited card rows (tagged e.g. `kind='page'`), second branch selects the facet SUM/CASE aggregates over the un-status-filtered base (tagged `kind='facets'`). Split rows by tag in JS.
- Option 2 (smaller change, still halves cost): run the CTE once into a temp view/CTE and have `getWorkspaceCardCounts` accept a precomputed `base` result set. Less clean; prefer Option 1.

Add a regression test asserting the repository prepares exactly one statement (or instrument a counting db wrapper) — otherwise the second call will creep back.

**Part B — damp the refresh storm.**

- The specific `SESSION_UPDATED` payloads that only touch already-patchable card fields (e.g. `pendingAgentInput` flips from `promptStore.js`, plain status transitions) could be handled as local patches like command runs are, instead of full refreshes. At minimum, the debounce window (currently a flat 1 000 ms in `WORKSPACE_LIST_REFRESH_DELAY_MS`) should back off under sustained events (e.g. double up to ~5 s while events keep arriving) so a busy project doesn't hold a continuous refresh loop.
- Guard: a refresh should be skipped entirely if another refresh completed after the newest triggering event's timestamp (the store's mutation-epoch machinery can be extended: record `lastEventAt`, skip refresh when `lastCompletedRefreshAt > lastEventAt`).

`sendWorkspaceCards` (in `api/workspaces.js`) already returns a `Server-Timing: workspace;dur=` header — use it to confirm the win before/after.

### Verify

```bash
yarn workspace @circuschief/server test src/db/workspace-queries.test.js
yarn workspace @circuschief/server test src/api/workspaces.test.js
```
Add a test that seeds a project with, say, 40 workspaces × 3 descendants, mocks/counting-wraps the db, and asserts one CTE execution per request. Manually: open a project with running sessions, watch the network tab — refresh frequency should fall off under bursty events, and `Server-Timing` should drop ~40–50% after Part A.

---

## Phase 3 — (Medium-high · dead code path + wrong docs) `onSessionStatus` is patch-listed but can never fire

### Context

`packages/web/src/composables/useWorkspaceListRealtime.js` declares:

```js
const PATCH_EVENTS = [
  'onSessionStatus',
  'onCommandRunStarted',
  ...
];
```

with the docstring: *"Single-card events (command runs, summaries) are patched into the owning card via `patchEvent` and issue zero list requests."*

`onSessionStatus` is registered through `packages/web/src/composables/useProjectSubscription.js`:

```js
const onSessionStatus = createProjectMessageHandler(WS_MESSAGE_TYPES.SESSION_STATUS);
// → const handler = (msg) => { if (msg.projectId === projectId) callback(msg); };
```

The handler filters on `msg.projectId`. But on the **server**, every `SESSION_STATUS` broadcast goes through `broadcastToSession` (session subscribers only — see `WebSocketManager.broadcastToSession`, which only iterates `#sessionSubscriptions.get(sessionId)`), with payload `{ sessionId, status }` and **no projectId**:

- `services/streamEventHandler.js:103` — `broadcastSessionStatus()`
- `api/sessions-patch.js:188`
- `services/draftSessionService.js:171`
- `services/schedulerService.js:9,244,253`

Project subscribers never receive `SESSION_STATUS`, and even if they did, the payload lacks `projectId` so the filter would reject it. Actual status changes reach the list as `SESSION_UPDATED` (which `broadcastSessionStatus` also sends to the project), i.e. a **full debounced refresh**. So `workspaceListEvents.rootStatusPatch()` — which exists solely for this event and is unit-tested (`patches root status only; descendant status falls back to refresh`) — is unreachable in production, and the composable's zero-request claim is false for status changes.

### How to fix

Choose one:

- **Option A (better UX): make the event actually flow.** In the server's status-broadcast call sites (or centrally in `broadcastSessionStatus` in `services/streamEventHandler.js`, plus the few direct `broadcastToSession(... SESSION_STATUS ...)` sites), also broadcast to project subscribers with a projectId, e.g. switch them to `broadcastToSessionAndProject(sessionId, projectId, SESSION_STATUS, { sessionId, status })` (that helper injects authoritative `sessionId`/`projectId` into the payload, which also fixes the filter). The client side then works as written. Confirm no other consumer of `SESSION_STATUS` breaks on receiving it twice (it is currently session-scoped; `SessionDetailView`'s handlers listen to `SESSION_CREATED`/`SESSION_UPDATED`, not status).
- **Option B (smaller): remove the dead path.** Drop `onSessionStatus` from `PATCH_EVENTS`, delete the `patchHandlers.onSessionStatus` registration, delete `rootStatusPatch` from `stores/workspaceListEvents.js` and its tests, and correct the composable docstring to say status changes arrive via `SESSION_UPDATED` → debounced refresh.

Do not leave it as-is: an untested-in-production code path whose docs claim it works is exactly what a future refactor will trust and build on.

### Verify

```bash
yarn workspace @circuschief/web test src/composables/useWorkspaceListRealtime.test.js
yarn workspace @circuschief/web test src/stores/workspaceList.test.js
```
For Option A, also add a server test asserting a project subscriber receives `SESSION_STATUS` with `projectId` (mirror the pattern in `packages/web/src/composables/useWebSocket.test.js`, "ignores project events whose projectId does not match"). Manual (Option A): start a run, watch the card's status badge flip without any `/workspaces?view=cards` request in the network tab.

---

## Phase 4 — (Medium · functional regression at scale) Pickers silently truncate at 200 workspaces

### Context

The branch replaced the legacy full-session list with the card endpoint in two pickers:

- `packages/web/src/components/AddSessionToLaneModal.vue:213` —
  ```js
  const result = await api.getWorkspaceCards(props.projectId, { limit: 200 });
  availableSessions.value = result.workspaces || [];
  ```
- `packages/web/src/views/NewSessionView.vue:406` —
  ```js
  const result = await api.getWorkspaceCards(projectId, { limit: 200 });
  parentWorkspaceSessions.value = result.workspaces || [];
  ```

Before the branch, both used `api.getProjectSessions(projectId, ...)`, which returned **every** session in the project. Now:

1. **Hard truncation at 200.** The server caps `limit` at 500 (`parseWorkspaceCardOptions` rejects 501+ with 400). Workspaces 201+ (ordered by `starred, sort_activity DESC, …`) never appear in either picker. There is no pagination follow-up, no `hasMore` check, and no user-visible indication that anything was cut off. In a project with 250 workspaces, a user cannot select the 201st-most-recent workspace as a continue-from parent, or add it to a Kanban lane from the picker — an invisible data-loss regression.
2. **Magic number duplicated** across two files, shadowing the exported constants `WORKSPACE_SERVER_MAX_LIMIT` (500) in `packages/web/src/stores/workspaceList.js` and the server's own cap. When someone raises the server cap, these stay stale.
3. `NewSessionView` then filters client-side to `status === 'completed'`; the modal filters `!kanbanStore.isSessionOnBoard(s.id)` — both fine, but they compound the truncation (200 fetched → fewer eligible).

### How to fix

1. Extract a shared constant, e.g. `WORKSPACE_PICKER_PAGE_SIZE` next to `WORKSPACE_SERVER_MAX_LIMIT` in `packages/web/src/stores/workspaceList.js`.
2. Loop `nextCursor` pages until either the server reports `hasMore: false` or a sane ceiling is reached (pick one deliberately — e.g. 1 000 — and show "showing first N of M" using `pagination.total` when the ceiling is hit). The response already carries `pagination.nextCursor` and `pagination.total`; the loop pattern exists in `fetchLoadedExtent` in `stores/workspaceList.js` — reuse it or extract a small `fetchAllWorkspaceCards(projectId, { max })` helper in `api/resources/ProjectsApi.js`.
3. For `NewSessionView`, consider passing a server-side filter instead of client-side `status === 'completed'` filtering if/when the endpoint grows one — not required for this fix, just avoid multiplying the truncation.

### Verify

```bash
yarn workspace @circuschief/web test src/components/AddSessionToLaneModal.test.js
yarn workspace @circuschief/web test src/views/NewSessionView.integration.test.js
```
Add a test where the mocked API returns a first page of 200 with `hasMore: true` and a second page of 25, and assert the picker's list contains all 225. Manual: seed a project with >200 workspaces (script a few inserts via the API), open "Add to board" and confirm the oldest workspace is selectable.

---

## Phase 5 — (Low-medium · maintainability) Trigger DDL duplicated; the test claimed to verify parity doesn't

### Context

The six `trg_sessions_activity_on_*` triggers exist in two places by design (fresh DBs run `schema.sql`; existing DBs get them from the migration):

- `packages/server/src/schema.sql` (lines ~305–370)
- `packages/server/src/db/migrations/activityTriggers.js` (`ACTIVITY_TRIGGER_CREATE_DDL` / `ACTIVITY_TRIGGER_DROP_DDL`), used by the `workspace-list-activity-column` migration in `miscMigrations.js` and by `recreateSessionsTable` in `sessionTableRecreate.js`.

The comment at the top of `activityTriggers.js` says: *"schema.sql is the corresponding fresh-database definition and is verified against this source in tests."*

**No test verifies this.** The relevant test, `packages/server/src/db/schemaBaseline.test.js` ("direct schema initialization plus baseline seeding plus migrations matches DatabaseManager schema metadata"), queries:

```sql
SELECT type, name, tbl_name, sql FROM sqlite_master
WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%'
```

`type IN ('table','index')` **excludes triggers**. It also executes schema.sql *and then all migrations* on the "direct" side, so both sides would end up with the migration's DDL regardless of what schema.sql said — the comparison is structurally incapable of catching drift between the two copies. I confirmed the bodies currently match by manual inspection only.

Consequence if unaddressed: a future edit to one copy (say, adding a `WHERE` clause to the schema.sql trigger) silently forks fresh installs from upgraded ones — exactly the class of bug the migrations framework exists to prevent.

### How to fix

Add a dedicated parity test in `packages/server/src/db/schemaBaseline.test.js` (or a new `activityTriggers.test.js`):

1. Build DB A: `new Database(':memory:')` + `db.exec(schema.sql)`.
2. Build DB B: an in-memory DB seeded with a **pre-activity-column** sessions schema, then run `allMigrations` over it (or minimally: `addColumnIfMissing` + the `workspace-list-activity-column` migration).
3. From each, `SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name IN (…ACTIVITY_TRIGGER_NAMES…) ORDER BY name`, and assert the arrays are deeply equal (note: `sql` is the normalized DDL text; compare exact strings — that is the point).
4. Also assert both sets contain all six names.

Optionally also tighten the existing metadata test to `type IN ('table','index','trigger')` — but note it would then be comparing post-migration DDL on both sides, so keep the dedicated test above as the real check.

### Verify

```bash
yarn workspace @circuschief/server test src/db/schemaBaseline.test.js
```
Mutation-test it once: change a body byte in `schema.sql`'s `trg_sessions_activity_on_message` and confirm the new test fails; revert.

---

## Phase 6 — (Low-medium · contract hygiene) `memberIds` "root first" documented but unenforced

### Context

`packages/shared/src/contracts/workspaces.js`, on `WorkspaceCardResponse.memberIds`:

```js
// Session ids of this workspace's tree (root first). Lets the client resolve
// a member session's realtime events to the owning card for local patching.
memberIds: z.array(z.string().uuid()),
```

Server side, `packages/server/src/db/workspace-queries.js` builds it with:

```sql
GROUP_CONCAT(s.id) AS member_ids,
```

`GROUP_CONCAT` has **no ordering guarantee** in SQLite (the docs explicitly decline to define order). In practice, with this query plan, it happens to emit root-first (the recursive CTE visits the root first), and tests only assert `arrayContaining` — deliberately, because strict order isn't guaranteed. Nothing in the client depends on the order: `cardForMember`/`cardForSession` do membership checks (`memberIds?.includes(sessionId)`), `workspaceCommandRuns` iterates. So the invariant is (a) undocumented-in-reality and (b) unused.

Risk: someone reads the contract comment and writes `memberIds[0] === sessionId`-style root checks; or a SQLite version/plan change shuffles the order and a future strict test starts failing intermittently.

### How to fix

Pick one:

- **Option A (recommended — align docs with reality):** change the comment to *"Session ids of this workspace's tree, in unspecified order."*
- **Option B (enforce it):** guarantee root-first with an ordered aggregate, e.g. `GROUP_CONCAT(s.id)` over a CTE that carries a depth/path column and an `ORDER BY` — in SQLite that means `group_concat(s.id)` still won't respect ORDER BY reliably; you'd need `json_group_array(json(s.id)) ORDER BY`-style tricks or post-processing in `toWorkspaceCard` (split, then stable-sort by "is this the root id first"). Only do this if a consumer actually needs root-first.

Also make the server test match the chosen contract: today `packages/server/src/api/workspaces.test.js` asserts `memberIds).toEqual(expect.arrayContaining([card.id]))` — fine for Option A; for Option B, tighten to `memberIds[0] === root.id`.

### Verify

```bash
yarn workspace @circuschief/server test src/api/workspaces.test.js
yarn workspace @circuschief/shared test src/contracts/workspaces.test.js
```

---

## Phase 7 — (Low-medium · UX/perf) Tab switches reset the loaded list

### Context

The workspace-list store keys its lifecycle on a query identity. `packages/web/src/stores/workspaceListQuery.js`:

```js
export function queryKey(projectId, query) {
  return `${projectId}:${JSON.stringify(query)}`;
}
```

`SessionListView.workspaceQuery()` includes `archived: activeTab.value === 'archived'` — so switching tabs (sessions ↔ archived, or away to commands/kanban and back) produces a **different key**, and `load()` → `_resetContext()` wipes `cardsById`/`orderedIds`/pagination and refetches page 1:

```js
if (lifecycle.contextKey !== nextKey) this._resetContext(projectId, query);
```

Consequence: a user who scrolled 300 cards deep, glances at the Commands tab, and returns sees a skeleton and is back at page 1. Before the branch, the archived tab had its own persistent store (`sessionsStore.archivedSessions` + `archivedPagination`) so tab toggles were instant.

(Note `useWorkspaceListRealtime` also tears down its project subscription when `listProjectId` becomes null on non-list tabs — that part is fine/intended; it's the *list data* reset that's the regression.)

### How to fix

One of:

- **Option A (small):** stop putting `archived` into the realtime/context identity churn by keeping **two concurrent store contexts** — e.g. change the store to hold a `Map<queryKey, {cardsById, orderedIds, pagination, lifecycle}>` and swap the active pointer on tab change, restoring instantly if the context is warm (with a staleness refresh if older than a few seconds). Keep `WeakMap`-based lifecycles per context.
- **Option B (smaller):** keep the single context but cache the last snapshots per queryKey in the lifecycle (plain object), and on `load()` with a seen key, restore the snapshot before refreshing (`refresh()` already preserves loaded extent, so the refresh is invisible rather than a skeleton flash).

Option B is a ~20-line change inside `workspaceList.js` and doesn't touch callers.

### Verify

```bash
yarn workspace @circuschief/web test src/stores/workspaceList.test.js
```
Add: load + `loadMore()` ×2, switch query (archived), switch back → `cards.length` restores to the previously loaded extent without an intermediate empty state, and the network shows a single extent refresh. Manual: scroll the sessions tab deep, hop to Commands and back — position/list should persist.

---

## Phase 8 — (Low · hygiene) Comment debt in the new code

### Context

Two spots where comments actively mislead:

**(a) Duplicated paragraph.** `packages/server/src/db/workspace-queries.js`, the JSDoc on `getWorkspaceCardPage`:

```
 * Cursor pagination uses the complete descending sort tuple so an
 * activity promotion between pages cannot create an offset gap. A maintained
 * workspace projection with single-card invalidation is the long-term path.
 * Cursor pagination uses the complete descending sort tuple, so an activity
 * promotion between pages cannot create an offset gap.
```

The last two lines are a verbatim repeat of the first two. Leftover from an edit; delete the duplicate pair.

**(b) Docstring says a parameter is vestigial; it is load-bearing.** `packages/web/src/composables/useWorkspaceListRealtime.js`:

```js
* @param {() => boolean} [isRefreshInFlight] - retained for API compatibility;
*   the store's mutation epoch now owns staleness detection
```

But inside `runRefresh()`:

```js
const joinedExistingLoad = isRefreshInFlight();
...
if (joinedExistingLoad) trailingRefresh = true;
```

`joinedExistingLoad` is the *only* thing that decides whether an event that attached to an in-flight request schedules the one-bounded-trailing-read. The mutation epoch covers **direct mutations** (star/archive/board handlers call `markMutation()`); WS events do **not** bump it — this parameter is precisely the WS-event equivalent. If a future reader "cleans up" the vestigial parameter per its docstring, WS events that race an in-flight refresh will silently be dropped until the next unrelated event.

### How to fix

- Delete the duplicated two lines in `getWorkspaceCardPage`'s JSDoc.
- Rewrite the `isRefreshInFlight` param doc, e.g.: *"Used to detect that this refresh joined an existing in-flight request (whose response may predate the triggering event) so one bounded trailing read is scheduled. This is the WS-event analogue of the store's mutation epoch, which covers direct mutations only."* Optionally rename the parameter to `isRefreshInFlightFor`-style clarity only if callers are updated in lockstep (it is positional; `SessionListView` passes `() => workspaceList.isRefreshInFlight()`).

### Verify

Comment-only; `yarn workspace @circuschief/web test src/composables/useWorkspaceListRealtime.test.js` (the "produces at most one trailing refresh for events during an in-flight refresh" test guards the behavior the corrected doc now describes).

---

## Phase 9 — (Low · brittleness) Positional SQL parameter binding spans two functions

### Context

`packages/server/src/db/workspace-queries.js`. The CTE constant holds the first `?`:

```js
const WORKSPACE_AGGREGATES_CTE = `
  WITH RECURSIVE tree(root_id, id, project_id, path) AS (
    SELECT id, id, project_id, '/' || id || '/'
    FROM sessions WHERE project_id = ? AND parent_session_id IS NULL
    ...
```

`workspaceFilters()` (a different function) builds the remaining placeholders (`s.archived = ?`, optional `s.starred = ?`), and callers must interleave in exactly the right order:

```js
const rows = db.prepare(sql).all(
  projectId, projectId, ...baseParams, ...(cursorValues || []), limit + 1,
  ...(cursorValues ? [] : [offset]),
);
```

(first `projectId` binds the CTE's `?`; second binds `s.project_id = ?` from the filter list; then archived/starred; then the five cursor tuple values; then limit; then offset **only** when cursor mode is off). A comment acknowledges the coupling ("base filters contain the project id placeholder from the aggregate CTE plus their own root filter"), and the same pattern repeats in `getWorkspaceCardCounts`.

Failure mode is silent: add one filter out of order, or move a placeholder, and SQLite binds the wrong value — no error, just wrong results (e.g. archived cards shown, or limit bound to a boolean). Phase 2's refactor will touch exactly this code, so harden it first.

### How to fix

Switch to **named parameters**: replace `?` with `@project_tree`, `@project_root`, `@archived`, `@starred`, `@cur_0..@cur_4`, `@limit`, `@offset` and pass a single options object to `.all({...})` / `.get({...})` (better-sqlite3 supports named-parameter objects natively and accepts unused keys). Build the object in one place next to the SQL assembly so the mapping is visually adjacent. Drop the now-obsolete interleaving comment.

If Phase 2 (Option 1 single-statement UNION) lands first, fold this into that rewrite rather than doing it twice.

### Verify

```bash
yarn workspace @circuschief/server test src/db/workspace-queries.test.js
yarn workspace @circuschief/server test src/api/workspaces.test.js
```
Existing tests already cover archived/starred/status/scheduled/cursor/offset permutations — they are the right safety net for this refactor. Add one explicit case: `starred=true` + `archived=true` + `cursor` together, asserting the returned set matches expectations (exercises every binding slot simultaneously).

---

## Phase 10 — (Low · dead code) Unused server wrapper `getWorkspaceCards`

### Context

`packages/server/src/db/workspace-queries.js` exports:

```js
export function getWorkspaceCards(db, projectId, options = {}) {
  return getWorkspaceCardPage(db, projectId, options).cards;
}
```

`packages/server/src/db/SessionRepository.js` wraps it:

```js
getWorkspaceCards(projectId, options = {}) {
  return getWorkspaceCards(this.db, projectId, options);
}
```

No production code calls either — `api/workspaces.js` uses `sessions.getWorkspaceCardPage(...)` only. (Do not confuse with the **web** client's `api.getWorkspaceCards`, which *is* used by the store and pickers — different package, keep that.) The wrapper also discards `facets`/`hasMore`, so anyone who did adopt it would silently lose pagination metadata — it's a trap, not a convenience.

Leftover from an intermediate commit ("fix: page workspace cards by offset") where the page variant was introduced.

### How to fix

Delete `getWorkspaceCards` from `workspace-queries.js`, the `getWorkspaceCards` method from `SessionRepository.js`, and any imports/re-exports/test references (search: `grep -rn "getWorkspaceCards(" packages/server/src`).

### Verify

```bash
yarn workspace @circuschief/server test   # or targeted: src/db/workspace-queries.test.js src/db/SessionRepository.test.js
yarn lint
```

---

## Phase 11 — (Low · coverage gap) No E2E coverage for the new pagination behavior

### Context

The branch's only E2E change is `tests/e2e/ui-ux.spec.ts`: a route-intercept pattern swap from `'**/sessions**'` to `'**/workspaces**'` for the archived-loading skeleton test. None of the feature's genuinely browser-risky surfaces are covered end-to-end:

- **Load more** button (`workspaceList.loadMore()` → append + `nextCursor` continuation).
- **Cursor continuation past the server cap** (client `fetchLoadedExtent` loop requesting 500-chunks — this only triggers with >500 workspaces; E2E can seed and stub).
- **Facet/filter interplay** (status running/idle counts from `facets` driving the `SessionFiltersPanel` counts and filtering).
- **Optimistic star + rollback** (`applyOptimisticStar`/`restoreOptimisticStar` under a failing network).
- **Realtime patching** (command-run indicator updates without a list request — Playwright can assert via response listener that no `/workspaces?view=cards` fetch occurred).

The unit suites (`stores/workspaceList.test.js`, `useWorkspaceListRealtime.test.js`, `api/workspaces.test.js`) are strong on logic, but jsdom does not exercise scroll/intersection-observer-driven visibility (`handleCardVisibility` → `cardVisibilityByRootId` → stream subscription eligibility), nor real network timing races (abort vs. commit) that this design leans on heavily.

### How to fix

Add `tests/e2e/workspace-list.spec.ts` (follow existing patterns in `tests/e2e/`; create a project via API, seed sessions via API, run against `BASE_URL` from `pw.sh`):

1. Seed 60 workspaces via `POST /api/projects/:id/workspaces` (or direct DB seed if an API limit applies). Assert 25 cards render (page size `WORKSPACE_PAGE_SIZE = 25`), click "Load more", assert 50 and no duplicates.
2. Route-intercept `**/workspaces?**` to make the star-toggle endpoint fail once; click a star; assert the star visually reverts (optimistic rollback) and an error toast appears.
3. Register a `page.on('response')` listener; trigger a command run on a visible card's button; assert the indicator flips and **no** `view=cards` request fired (patch path).
4. Filter: click the "running" status filter; assert the counts shown match the number of cards rendered.
5. (Optional, cheap proxy for >500) stub `pagination.hasMore`/`nextCursor` on the first response and assert the client issues a second cursor request.

### Verify

```bash
./scripts/pw.sh test tests/e2e/workspace-list.spec.ts
```
And confirm no interference with the main dev server (pw.sh guarantees port isolation — never run `npx playwright test` directly).

---

## Suggested order of execution

1. **Phase 1** first — every other diff/validation should be against a branch that already contains main.
2. **Phase 2 Part A** (single-statement facets) — small, halves list cost, and naturally precedes Phase 9's named-parameter hardening (fold 9 into 2's rewrite).
3. **Phase 4** (picker truncation) — the only user-visible functional regression in the branch's own code.
4. **Phase 3** (decide Option A vs B for `SESSION_STATUS`) — pairs naturally with Phase 2 Part B's refresh-storm work.
5. Phases 5, 6, 7, 8, 10 — independent, any order, all small.
6. **Phase 11** last — E2E written against the settled behavior.
