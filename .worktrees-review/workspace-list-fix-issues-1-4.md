# Workspace List Branch — Priority Fixes (Issues 1–4)

**Branch:** `circus-chief/3795-simplify-workspace-list-short-`
**Baseline for comparison:** `origin/main` (merge base `8a963179`; note `origin/main` has 3 commits the branch does not)

Fix these four issues on the current branch. They are ordered by severity. Reproduction
paths, file/line references, and suggested approaches are given for each. Constraints that
apply to all four are at the bottom.

---

## Issue 1 (High) — Realtime refresh silently truncates any list deeper than 500 workspaces

### Where

- `packages/web/src/stores/workspaceList.js` — `refresh()` computes the request limit, and
  `_replace()` overwrites the whole store from the response.
- Server cap: `packages/server/src/api/workspaces.js` — `parseWorkspaceCardOptions()` rejects
  `limit > 500`.
- Client mirror: `WORKSPACE_SERVER_MAX_LIMIT = 500` at the top of `workspaceList.js`.

### What happens

`refresh()` picks its request size as:

```js
const limit = Math.min(Math.max(WORKSPACE_PAGE_SIZE, this.orderedIds.length), WORKSPACE_SERVER_MAX_LIMIT);
```

and then commits the result with `_replace(result)`, which **overwrites** `cardsById` and
`orderedIds` with exactly the rows the server returned.

So: user loads 600 workspaces via "Load more". The first debounced WebSocket event fires
`refresh()`. The client asks for 500, the server returns 500, `_replace()` swaps them in —
**rows 501–600 vanish from the UI**. `hasMore` flips back to true and a "Load more" button
reappears for content the user already had. Because `orderedIds.length` is now 500, every
subsequent refresh also asks for 500: the list never regains its depth without manual
interaction.

This is user-visible, permanent data loss until the user intervenes.

### Why the tests miss it

`packages/web/src/stores/workspaceList.test.js` line ~170,
`caps the refresh extent at the server's max limit once loaded rows exceed it`, asserts the
**request** limit is 500 but never asserts that the previously loaded 600 cards survive. The
test codifies the truncation instead of catching it. It needs to be updated as part of the fix.

### Suggested approaches (pick one, or a better one)

1. **Refresh per loaded page by offset.** Instead of one wide request, issue sequential
   `limit=25&offset=0..N` requests for the loaded extent and merge. Simple, no server change,
   but turns one request into N during realtime activity (interacts with Issue 2 — be careful).
2. **Cap-and-merge instead of cap-and-replace.** Keep `refresh()` fetching the capped 500,
   but change the commit so already-known cards that fall outside the response window are
   retained (aged, not deleted). Requires care: cards that legitimately disappeared
   (archived/deleted) must still be dropped, so a plain merge is wrong — you need a way to
   distinguish "beyond the refresh window" from "removed". A per-request "loaded extent
   snapshot" plus explicit removal paths may be needed.
3. **Keyset/cursor refresh.** Refresh by cursor from the oldest loaded row. This is the
   structural fix and also resolves Issue 3; if you take it on, see Issue 3 first.

Whichever you pick, add a regression test that: loads 600 rows (mock the page responses),
calls `refresh()`, and asserts all 600 IDs are still present and `hasMore` is still false.

---

## Issue 2 (High) — Sustained full-project aggregation on a ~1s cadence; counts query runs twice per request

### Where

- `packages/server/src/api/workspaces.js` — `sendWorkspaceCards()`:
  `sessions.getWorkspaceCards(...)` **and** `sessions.getWorkspaceCardCounts(...)` run back
  to back.
- `packages/server/src/db/workspace-queries.js` — both go through
  `WORKSPACE_AGGREGATES_CTE`, a `WITH RECURSIVE tree` that walks **every session in every
  workspace tree in the project**, regardless of `LIMIT`.
- `packages/web/src/composables/useWorkspaceListRealtime.js` — `REFRESH_EVENTS` includes
  `onSessionMessage`; `WORKSPACE_LIST_REFRESH_DELAY_MS = 1_000`.

### What happens

Each `view=cards` request pays:

1. **Two** executions of the recursive tree aggregation (one for the page, one for the
   facets). The second is avoidable.
2. `commandRuns.getLatestRunsForSessions(memberIds)` — fans out across **all members of all
   loaded cards** (up to 500 workspaces × members each), chunked at 500 IDs per query
   (`SESSION_ID_CHUNK_SIZE` in `packages/server/src/db/CommandRunRepository.js`), each chunk
   with a `ROW_NUMBER()` window plus two `command_run_output_chunks` subqueries per run. The
   legacy list endpoint attached runs for **root sessions only**.
3. Because `onSessionMessage` is in `REFRESH_EVENTS`, **every user/assistant message**
   invalidates the list. With a few streaming sessions, the list view sustains roughly one
   full-aggregation scan of the project per second indefinitely while the tab is open.

The branch's own stated purpose is making this list scale. As merged, a large project pays
O(all sessions in project) server CPU on a 1-second cadence. Treat this as an incident
waiting to happen, not a future optimization.

### Required fixes (in priority order)

1. **Remove `onSessionMessage` from `REFRESH_EVENTS`** in
   `packages/web/src/composables/useWorkspaceListRealtime.js`. The card fields a message can
   change — `summaryPreview` and the `lastActivityAt` sort key — are already covered by
   `onSessionUpdated` and `onSessionSummaryUpdated`. Verify this claim against the server's
   broadcast paths before deleting (`broadcastSessionStatus` in
   `packages/server/src/services/streamEventHandler.js` emits `SESSION_UPDATED` on status
   transitions; summary updates have their own event). If you find a message-driven field
   change that nothing else covers, say so in the PR and keep the event with justification.
2. **Fold the facet counts into the page query** so the CTE runs once per request. Options:
   a second windowed `COUNT(*) OVER ()`-style total alongside a conditional running/idle
   count, or one query returning both the page and the counts. Preserve the exact response
   contract (`facets: { running, idle }` ignores the active `status` filter — see
   `getWorkspaceCardCounts`, which passes `includeStatus: false` and must keep that
   semantics). The shared contract `WorkspaceCardListResponse`
   (`packages/shared/src/contracts/workspaces.js`) must not change shape.
3. **Bound or slim the command-runs fan-out.** At minimum measure it; if it is the dominant
   cost, restrict runs to **root sessions** of loaded cards (matching legacy behavior — the
   list UI renders per-root button status) rather than every member. Check
   `packages/web/src/components/SessionCard.vue` (`buttonStatusesToDisplay`) and
   `KanbanBoard.vue` to confirm which session IDs the UI actually needs runs for before
   changing the server payload.

### Testing

- Add a unit test that one `view=cards` request triggers exactly **one** prepared statement
   containing `WITH RECURSIVE tree` (spy on `db.prepare` or use the integration test app in
   `packages/server/src/api/workspaces.test.js`).
- Keep `workspaces.test.js`'s `returns honest cold-entry status facets independent of page
  size` passing — it is the guard that facets do not become page-derived counts.

---

## Issue 3 (Medium-High) — Offset pagination over a volatile sort key skips rows during loadMore

### Where

- `packages/server/src/db/workspace-queries.js` — `getWorkspaceCards()` ORDER BY:
  `s.starred DESC, COALESCE(a.last_activity_at, s.updated_at, s.created_at) DESC,
  s.updated_at DESC, s.created_at DESC, s.id DESC` with `LIMIT ? OFFSET ?`.
- `packages/web/src/stores/workspaceList.js` — `loadMore()` fetches
  `offset: this.nextOffset`.

### What happens

The sort key is activity-recency. Any new activity promotes a workspace to the top and
shifts every later row down by one. An in-flight `loadMore` at `offset: N` then starts one
row later than intended and **silently skips** the row that moved from page N+1 into page N.
The user never sees that workspace until some later full refresh happens to include it.

There is a test (`deduplicates a card that moves into the next offset page`, in
`workspaceList.test.js`) that covers the **duplicate** half of the race — append-side dedup
in `_append()`. Nothing covers the **skip** half.

Note the interaction with Issue 1: refresh-everything currently masks this below 500 loaded
rows and is unfixable above it (refresh is capped). Fixing #1 without addressing #3 leaves
the skip in place at depth.

### Suggested approaches

1. **Keyset/cursor pagination (preferred, structural).** Cursor =
   `(starred, last_activity_at, id)` — the exact ORDER BY tuple, with `id DESC` as the
   tiebreaker. `loadMore` sends the cursor of the last loaded row instead of an offset; the
   WHERE clause becomes `(s.starred, COALESCE(...), s.id) < (?, ?, ?)` under SQLite's
   row-value comparison semantics. This eliminates the skip **and** removes the need for the
   "refresh the loaded extent" behavior that causes Issue 1, because a cursor re-read can
   never shift. It changes the API surface (`pagination.nextCursor` instead of / in addition
   to `offset`), so:
   - extend `WorkspaceCardListResponse` in `packages/shared/src/contracts/workspaces.js`,
   - update `parseWorkspaceCardOptions` validation,
   - keep the legacy offset behavior for the non-`view=cards` shape,
   - keep the existing offset tests passing or explicitly update them.
2. **Stable-snapshot trick (smaller).** Client sends the sort tuple of its last loaded row
   as an "anchor" and the server pages strictly below that anchor — effectively a cursor
   without the API rename. Same mechanics, less contract churn.
3. **Accept-and-document (last resort).** If pagination must stay offset-based, add an
   explicit client-side reconciliation: on `loadMore` response, detect a gap (an ID from the
   previous page boundary missing) and re-fetch the boundary page. This is the worst option —
   it is complex and still eventually lossy.

If you do (1), please also revisit Issue 1's fix choice so the two land coherently.

### Testing

Add a regression test at the store level: page 1 of 2 loaded, a mutation promotes a row
from page 2 to page 1, `loadMore()` runs, and **every** row is present exactly once
(no duplicates AND no gaps — assert the union of IDs equals the full expected set).

---

## Issue 4 (Medium) — Regression: the "continue under a completed session" parent picker in NewSessionView is now mostly empty

### Where

- `packages/web/src/views/NewSessionView.vue` line ~328:
  `const availableSessions = computed(() => sessionsStore.sessions.filter(s => s.status === 'completed') ...)`
- Population paths for `sessionsStore.sessions`, post-branch:
  - `fetchSession(id)` (`packages/web/src/stores/sessions/sessionActions.js`) — loads **one** row
  - `fetchWorkspaceTree(sessionId)` — loads only workspaces the user has **visited** this
    app session
  - `addSessionToList` via the `SESSION_CREATED` WebSocket handler in
    `useSessionTree.js` — only children of the currently-open tree
- Removed populator: `useProjectSessionSubscription.js` (deleted, −320 lines) used to call
  `sessionsStore.fetchSessions(projectId)` project-wide from the list view.

`fetchSessions` still exists in `sessionActions.js` (line ~73) but now has **zero non-test
callers** (verified by grep). It is the only thing that ever populated the store project-wide.

### What happens

The advanced-options parent picker ("continue under a completed session") shows a list built
from `sessionsStore.sessions`. Since nothing populates the store project-wide anymore, the
picker only ever shows completed sessions from workspaces the user happened to open in this
app session. On a fresh page load it is empty. This is a functional regression shipped in
the feature branch, not a degraded edge case.

### How to fix

Pick one (1 is probably right):

1. **Hydrate the picker explicitly.** In `NewSessionView.vue`, on mount, fetch what the
   picker needs directly — e.g. `api.getProjectSessions(projectId, false, null)` filtered to
   `status === 'completed'` — and hold it in local component state. Do **not** reintroduce a
   project-wide write into the shared `sessions` store just for this; the branch deliberately
   stopped over-fetching there, and the picker is a secondary interaction. Note
   `getProjectSessions` returns root sessions only for the bare-array shape; confirm whether
   the picker is meant to offer **any** completed session or only **workspace roots** —
   parent-child semantics here matter (`CreateWorkspaceSessionRequest` validates the parent
   belongs to the workspace), so check what the server accepts before deciding.
2. **Drop the feature.** If product intent is that you can only continue a session from the
   session-detail view now, remove the picker (`availableSessions`, the
   `showAdvancedOptions` contribution at line ~333, and the template block at ~188–204)
   rather than ship a broken version. Get a decision if unclear — do not silently delete a
   user-facing affordance without saying so in the PR.

### Testing

Add/extend a test that mounts `NewSessionView` with an empty `sessions` store and asserts
the picker still lists completed workspaces after whatever load path you implement (and that
it does not render when there are none, preserving `showAdvancedOptions` semantics).

---

## Constraints for all four fixes

- **Test suite must stay green**: `yarn test` (currently 5,080 server + 4,851 web + 386
  shared passing) and `yarn lint`. Add regression tests for each issue as described.
- **Shared contracts** (`packages/shared/src/contracts/workspaces.js`) may be extended
  backwards-compatibly; do not break the existing `WorkspaceCardListResponse` shape or the
  legacy (non-`view=cards`) endpoint contract, which external API consumers rely on (see the
  comment on the `GET /api/workspaces/:workspaceId` route).
- **E2E**: use `./scripts/pw.sh` only, never port 5000 (see CLAUDE.md).
- **Do not `cd` to hardcoded paths** — this session runs in a git worktree; working
  directory is already correct.
- Issue 1 and Issue 3 interact: choose approaches that land coherently together (a cursor
  fix for #3 largely dissolves #1). Decide the combined design before editing code.
- Scope discipline: fix these four. Other review findings (issues 5–18: kanban contract
  drift, board hot-path fan-out, the stale `/members` comment, the committed
  `.worktrees-review/workspace-list-review.md` artifact, etc.) are tracked separately — do
  not bundle them in.
