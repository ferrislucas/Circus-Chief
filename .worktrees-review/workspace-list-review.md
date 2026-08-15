# Code Review: Workspace List Read Model

**Branch:** `circus-chief/3795-simplify-workspace-list-short-`
**Compared against:** `origin/main`
**Scope:** 10 commits, 34 files, +2,420 / −776 lines
**Build status:** `yarn lint` clean · unit suite green (5,073 server + 4,886 web + 384 shared passing)

---

## Goals of the Feature

Derived from reading the diff, not from the commit messages.

1. **Replace the client-side workspace list with a server-computed read model.**
   New `GET /api/projects/:id/workspaces?view=cards` returns a compact, allowlisted
   "workspace card" DTO (`packages/server/src/db/workspace-queries.js`) carrying workflow
   aggregates (`runningCount`, `scheduledCount`, `memberCount`, `nearestScheduledAt`),
   summary preview, PR/CI state, kanban lane, and latest command runs — computed in one
   set-based SQL query instead of by hydrating every session into the Pinia store and
   grouping in the browser.

2. **Stop over-fetching on the list page.**
   Eliminates `fetchProjectSessions`, per-session `fetchSummariesBatch`, and the eager
   `kanbanStore.fetchBoard` on mount. The board is deferred until the lane picker opens.

3. **Make filters and counts authoritative.**
   Server-side `archived` / `starred` / `status` / `scheduled` filters plus a `facets`
   block so the filter chips display real counts rather than counts of the loaded page.

4. **Slim the workspace detail path.**
   `GET /api/workspaces/:id` now returns a compact member tree. `fetchSession` replaces the
   serial ancestor-walk plus project-wide child fetch with one parallel call, and gains
   abort/lifecycle handling.

5. **Simplify realtime.**
   Replaces the 320-line `useProjectSessionSubscription` patching machinery with debounced
   invalidation (`useWorkspaceListRealtime`) plus a separate board applier
   (`useKanbanRealtime`); extracts kanban WS handlers into `kanbanWebSocketActions.js`.

6. **Add observability** via `Server-Timing` and `X-Response-Bytes` response headers.

The direction is right and the SQL projection work is genuinely good. The issues below are
real bugs plus a set of scalability claims the implementation does not currently support.

---

## Summary

| Severity | Issues |
|---|---|
| Critical | 1 |
| High | 2, 3, 4, 5, 6 |
| Medium | 7, 8, 9, 10, 11, 12 |
| Low | 13, 14, 15, 16, 17, 18, 19, 20 |

**Blocking:** 1, 2, 3, 6
**Should fix before merge:** 4, 5, 7, 8, 9

---

# Critical

## Issue 1 — Two composables subscribe to the same project channel with no refcounting; the Kanban tab loses all realtime updates

**Files:** `packages/web/src/composables/useWorkspaceListRealtime.js:92`,
`packages/web/src/composables/useKanbanRealtime.js:32`,
`packages/web/src/composables/useProjectSubscription.js:22-25`,
`packages/server/src/ws/WebSocketManager.js:134-138`,
`packages/web/src/views/SessionListView.vue`

`SessionListView` mounts both composables against the *same* `projectId`, and each creates
its own subscription:

```js
// useWorkspaceListRealtime.js:92  and  useKanbanRealtime.js:32
const subscription = useProjectSubscription(id, { autoCleanup: false });
```

`unsubscribe()` is unconditional — there is no refcount:

```js
// useProjectSubscription.js:22-25
const unsubscribe = () => {
  projectSubscriptionIds.delete(projectId);
  send(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT, { projectId });
};
```

The server drops the socket from the project room entirely:

```js
// WebSocketManager.js:134-138
#handleUnsubscribeProject(ws, message) {
  const { projectId } = message;
  if (!projectId) return;
  this.#projectSubscriptions.get(projectId)?.delete(ws);
}
```

The trigger is the tab-scoped project id:

```js
const listProjectId = computed(() => ['sessions', 'archived'].includes(activeTab.value)
  ? projectId.value
  : null);
```

`SessionListView` hosts the Kanban tab (`activeTab === 'kanban'`, line 277-278). Switching to
it sets `listProjectId` to `null`, which runs `installProjectSubscription(null)` →
`cleanupCurrentProject()` → `subscription.unsubscribe()` → **the shared project channel is
torn down**, so `useKanbanRealtime`'s handlers stop receiving board broadcasts on the exact
tab where they matter most. Deleting the id from `projectSubscriptionIds` also means the
reconnect path will not restore it.

Before this change only `useProjectSessionSubscription` subscribed, so the collision did not
exist. This is introduced by splitting into two composables.

**Fix:** refcount subscriptions inside `useProjectSubscription`, or have a single owner hold
the project subscription while both composables register handlers only.

---

# High

## Issue 2 — Session picker loses model and token labels for ancestors and children

**Files:** `packages/server/src/db/workspace-queries.js:150-185`,
`packages/web/src/stores/sessions/sessionActions.js:117-160`,
`packages/web/src/components/SessionChatContent.vue:336-344`

`fetchSession` now hydrates the store from the workspace-members projection:

```js
if (workspaceDetail?.members) upsertSessionListMembers(this.sessions, workspaceDetail.members);
```

`getWorkspaceMembers` returns only 13 allowlisted fields — `id`, `projectId`,
`parentSessionId`, `name`, `status`, `starred`, `archived`, `scheduledAt`, `createdAt`,
`updatedAt`, `depth`, `lastActivityAt`, `lastMessageAt`, `summaryPreview`. There is **no
`model`, no `pendingModel`, and no usage/token columns**.

The session picker renders exactly those fields:

```js
// SessionChatContent.vue:336-344
function getPickerModelLabel(session) {
  return session?.model || session?.pendingModel || 'Default model';
}
function getPickerTokenLabel(session) {
  const total = calculateTokenTotal(session);
  if (!total) return '-';
  return formatTokenCount(total);
}
```

The removed `fetchAncestorSessions` / `fetchChildSessions` fetched full session rows. Every
chain entry the user has not individually opened will now render "Default model" and "-"
tokens.

No test covers this — `SessionDetailView.test.js` changed by only 15 lines.

---

## Issue 3 — Hard 500-workspace ceiling with no UI signal; older workspaces become unreachable

**File:** `packages/web/src/stores/workspaceList.js`

```js
export const WORKSPACE_MAX_EXTENT = 500;
// ...
this.hasMore = Boolean(result.pagination?.hasMore)
  && this.requestedExtent < WORKSPACE_MAX_EXTENT;
```

Once `requestedExtent` reaches 500 the "Load more" button disappears while
`pagination.total` still reports more rows exist. The user has no indication that results
were truncated.

The old archived tab paged indefinitely via `fetchArchivedSessions` /
`loadMoreArchivedSessions`. Archived lists grow monotonically, so this is a functional
regression that worsens over time — and it fails silently, which is the bad kind.

Note this cap is only necessary *because* of the offset strategy in Issue 4.

---

## Issue 4 — Pagination re-fetches the entire extent on every load-more and every realtime refresh

**File:** `packages/web/src/stores/workspaceList.js`

```js
const fetchExtent = (projectId, query, extent, signal) => api.getWorkspaceCards(projectId, {
  ...query,
  limit: Math.min(extent, WORKSPACE_MAX_EXTENT),
  offset: 0,
  signal,
});
```

Every request uses `offset: 0` with a growing `limit`. Consequences:

- "Load more" #19 downloads 500 cards to append 25.
- Every debounced WebSocket invalidation re-runs the full aggregate query for the entire
  loaded extent, not just changed rows.
- Total bytes transferred across a paging session is O(n²).

This directly undercuts goal #2 (stop over-fetching). Combined with Issue 5 it is the
primary scalability concern in the change.

---

## Issue 5 — List query cost is proportional to all messages in the project, re-run on every invalidation

**Files:** `packages/server/src/db/workspace-queries.js`,
`packages/web/src/composables/useWorkspaceListRealtime.js`,
`packages/server/src/services/streamEventHandler.js:105-112`,
`packages/server/src/services/streamUsageHandler.js:216`

`WORKSPACE_LAST_ACTIVITY_SQL` is a correlated `MAX` over `conversation_messages ⋈ tree`,
unioned with `session_summaries` and `command_runs`. Because it appears in the `ORDER BY`:

```sql
ORDER BY s.starred DESC,
  COALESCE(last_activity_at, s.updated_at, s.created_at) DESC,
  s.updated_at DESC, s.created_at DESC, s.id DESC
LIMIT ? OFFSET ?
```

…it must be evaluated for **every** workspace matching the `WHERE` clause, not just the
requested page. The recursive `tree` CTE also walks the project's entire session forest
regardless of `limit`.

There is no supporting composite index — only
`idx_messages_session ON conversation_messages(session_id)` — so each evaluation scans all
message rows for that session rather than seeking a max.

The invalidation cadence makes this expensive. `REFRESH_EVENTS` includes `onSessionStatus`,
`onSessionMessage`, and `onSessionUpdated`, and the server broadcasts `SESSION_UPDATED` to
project subscribers on **every status transition**:

```js
// streamEventHandler.js:105-112
broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
  projectId: session.projectId, sessionId, session: { ...session, status },
});
```

…and on **every turn's usage update** (`streamUsageHandler.js:216`). With several sessions
running that is a full-project aggregate re-query per 150 ms debounce window
(`WORKSPACE_LIST_REFRESH_DELAY_MS = 150`).

The header comment in `getWorkspaceCards` acknowledges "database work is not bounded by the
visible page." I do not think that is a documentable tradeoff at this cost.

**Minimum fixes:**
- `CREATE INDEX idx_messages_session_ts ON conversation_messages(session_id, timestamp)`
- Equivalent covering index on `command_runs(session_id, completed_at, started_at)`
- Raise the debounce well above 150 ms

---

## Issue 6 — `handleStar` reverts a persisted star when the follow-up refresh fails

**File:** `packages/web/src/views/SessionListView.vue`

```js
async function handleStar({ id, starred }) {
  const snapshot = workspaceList.applyOptimisticStar(id, starred);
  try {
    await sessionsStore.toggleSessionStar(id);   // succeeded — persisted server-side
    const refreshWasInFlight = workspaceList.isRefreshInFlight();
    await workspaceList.refresh();               // network hiccup → throws
    if (refreshWasInFlight) await workspaceList.refresh();
  } catch (error) {
    workspaceList.restoreOptimisticStar(snapshot);   // reverts the UI
    uiStore.error(error.message || 'Failed to update star');  // lies to the user
  }
}
```

A refresh failure after a successful toggle rolls back the UI and reports "Failed to update
star", even though the star was persisted. The refresh must live outside the `try`, or the
catch must distinguish the two failure modes.

Separately, the double-refresh issues two full-extent fetches (see Issue 4) for a single star
toggle.

---

# Medium

## Issue 7 — A single shared abort controller in `fetchSession` causes concurrent callers to cancel each other

**Files:** `packages/web/src/stores/sessions/sessionActions.js:117-160`,
`packages/web/src/composables/useSessionPolling.js:59`,
`packages/web/src/composables/useSessionTree.js:56`

```js
async fetchSession(id, showLoading = true) {
  this._sessionFetchController?.abort();
  const controller = new AbortController();
  this._sessionFetchController = controller;
```

The controller is store-global, but `fetchSession` has 7 call sites, including a polling
interval and the session-tree builder. When a poll tick fires while `buildSessionChain` is
fetching, one aborts the other — and `useSessionTree` swallows it:

```js
// useSessionTree.js:56
if (!existingSession) {
  try { await sessionsStore.fetchSession(sessionId, false); } catch { return; }
}
```

Result: the session chain intermittently fails to build with no user-visible error.

**Fix:** key the controller by session id, or skip aborting when the in-flight request is for
the same id.

**Secondary note:** `_sessionFetchController` is an undeclared property assigned onto a Pinia
store. It happens to work because Vue's `reactive` does not proxy an `AbortController`
(`getTargetType` returns INVALID for non-plain objects), so the `===` identity guards hold.
That is an implementation detail to be relying on silently — if the stored value ever becomes
a plain object, every `this._sessionFetchController === controller` guard silently becomes
`false` and `loading` never clears.

---

## Issue 8 — `GET /api/workspaces/:id` is a breaking, unversioned contract change

**File:** `packages/server/src/api/workspaces.js:286-301`

```js
const members = sessions.getWorkspaceMembers(workspace.id);
const root = members.find(member => member.id === workspace.id);
// Keep the root fields and `sessions` alias during the compatibility window;
// both now use the compact allowlisted projection rather than raw rows.
return sendWorkspaceJson(res, {
  ...root,
  sessions: members.filter(member => member.id !== workspace.id),
  workspace: root,
  members,
}, startedAt);
```

The response went from a full session row plus `pendingAgentInput` to a 13-field projection.
Fields silently removed: `model`, `providerId`, `mode`, `thinkingEnabled`, `effortLevel`,
`prUrl`, `gitBranch`, `gitWorktree`, `agentType`, `latestCommandRuns`, and
**`pendingAgentInput` is dropped entirely**.

This endpoint is part of the documented external Session Management API that agents are
instructed to call. The "compatibility window" comment preserves the `sessions` / `workspace`
*keys* but not the *fields*, which is the part consumers actually read.

Also note the legacy (non-`view=cards`) list path no longer applies `withPendingAgentInput`
to its rows either — the helper was deleted.

**Fix:** keep the full row on the legacy path and put the compact shape behind `?view=`, or
version the endpoint.

---

## Issue 9 — ~540 lines of newly-dead code left in place, with tests that still pass

Verified by grepping for non-test callers. These now have **zero** production consumers:

| Symbol | File | Lines |
|---|---|---|
| `useProjectSessionSubscription` (entire composable) | `composables/useProjectSessionSubscription.js` | 320 |
| `filteredGroupedSessions` | `composables/useSessionFiltering.js` | — |
| `fetchArchivedSessions` | `stores/sessions/sessionActions.js` | — |
| `loadMoreArchivedSessions` | `stores/sessions/sessionActions.js` | — |
| `archivedPagination` | `stores/sessions.js`, `sessionActions.js` | — |

Their test files (`useProjectSessionSubscription.test.js`, `useSessionFiltering.test.js`)
still run and pass, providing false coverage confidence for code no longer on any path.

Additionally, **new dead API surface** was added: `ProjectsApi.getWorkspaceMembers` and the
`GET /workspaces/:id/members` endpoint have no consumer at all. The endpoint's comment calls
it "cacheable lightweight tree only" but it sets no cache headers.

---

## Issue 10 — `latestCommandRuns` fan-out is unbounded in SQL variables

**File:** `packages/server/src/db/CommandRunRepository.js:259-274`

```js
getLatestRunsForSessions(sessionIds) {
  if (!sessionIds.length) return [];
  const placeholders = sessionIds.map(() => '?').join(', ');
  // ... WHERE cr.session_id IN (${placeholders})
```

Called from `workspaces.js` with `memberIds` flattened across up to 500 workspaces:

```js
const memberIds = [...new Set(cards.flatMap(card => card.memberIds))];
```

Modern SQLite caps at 32,766 host parameters, so this will not fail today, but nothing bounds
it and the failure mode is a hard `SQLITE_ERROR` on the entire list endpoint.

**Fix:** chunk the IN-list, or join against a CTE / temp table of ids.

---

## Issue 11 — Stale `loadMore` failures write into the current context's error state

**File:** `packages/web/src/stores/workspaceList.js`

```js
} catch (error) {
  if (!isAbort(error)) {
    if (canCommitPage(this, lifecycle, request)) {
      this.requestedExtent = Math.max(WORKSPACE_PAGE_SIZE, extent - WORKSPACE_PAGE_SIZE);
    }
    this.error = error.message || 'Failed to load more workspaces';   // NOT guarded
    throw error;
  }
}
```

The extent rollback is correctly guarded by `canCommitPage`, but the `this.error` assignment
is not. A superseded request that fails will surface an error banner for a project or query
the user has already navigated away from.

---

## Issue 12 — No cycle guard in the aggregates CTE, inconsistent with the members CTE

**File:** `packages/server/src/db/workspace-queries.js`

`getWorkspaceMembers` defends against cycles:

```sql
SELECT s.id, s.parent_session_id, tree.depth + 1, tree.path || '/' || s.id
FROM sessions s JOIN tree ON s.parent_session_id = tree.id
WHERE instr(tree.path, s.id) = 0        -- cycle guard
```

`WORKSPACE_AGGREGATES_CTE` has no equivalent:

```sql
WITH RECURSIVE tree(root_id, id, project_id) AS (
  SELECT id, id, project_id FROM sessions WHERE project_id = ? AND parent_session_id IS NULL
  UNION ALL
  SELECT tree.root_id, s.id, tree.project_id FROM sessions s
  JOIN tree ON s.parent_session_id = tree.id AND s.project_id = tree.project_id
)
```

If `parent_session_id` ever forms a cycle, the members query survives while the list query
loops forever. Two queries over the same data with different safety assumptions is the kind
of inconsistency that bites later.

---

# Low

## Issue 13 — `memberCount` does not mean what its name says

**Files:** `packages/server/src/db/workspace-queries.js`,
`packages/web/src/components/SessionCard.vue:352-362`

```sql
COUNT(*) - 1 AS member_count
```

It is the *descendant* count, while `memberIds` on the same DTO **includes** the root.
`SessionCard` compensates:

```js
totalCount: (props.workflowAggregate.memberCount || 0) + 1,
```

Confirmed by the server test asserting `runningCount: 2, memberCount: 1` for a root plus one
child. Rename to `descendantCount` before other consumers guess wrong.

---

## Issue 14 — `workspaceCommandRuns` has muddled precedence

**File:** `packages/server/src/api/workspaces.js`

```js
const runRecency = run => run.completedAt ?? run.startedAt ?? 0;

for (const run of Object.values(runsBySession[sessionId] || {})) {
  const current = latestByButton[run.buttonId];
  if (!current || run.status === 'running' || runRecency(run) > runRecency(current)) {
    latestByButton[run.buttonId] = run;
  }
}
```

The recency comparison is not gated on the *current* run's status, so a newer completed run
can overwrite a currently-running one for the same button depending on iteration order. Make
the priority rule explicit (running always wins, then recency).

---

## Issue 15 — Summary retry path is now dead UI

**Files:** `packages/web/src/views/SessionListView.vue`,
`packages/web/src/components/ArchivedTabContent.vue`,
`packages/web/src/components/SessionCard.vue`

`summary-loading` and `summary-error` are no longer passed to `SessionCard`, so they default
to falsy and the error state / retry button never render. Yet `retryFetchSummary` is still
imported from `useSummaries`, bound in both views, and re-emitted through
`ArchivedTabContent` as `handleRetrySummary`.

Either restore the loading/error states or remove the plumbing.

---

## Issue 16 — New response shapes bypass the repo's Zod contract convention

**Files:** `packages/shared/src/contracts/workspaces.js`,
`packages/web/src/stores/kanbanWebSocketActions.js`

`contracts/workspaces.js` exports request contracts only (`CreateWorkspaceRequest`,
`CreateWorkspaceSessionRequest`). Neither the new workspace-card DTO nor the members DTO is
modelled.

This matters because the kanban store's allowlist explicitly derives from the contract for
exactly this reason:

```js
// Kept adjacent to `KanbanCardSessionResponse` (instead of a hand-maintained
// list) so the allowlist below cannot silently drift from the contract
const KANBAN_CARD_SESSION_FIELDS = Object.keys(KanbanCardSessionResponse.shape);
```

The new endpoints establish the opposite precedent. Without a contract, client field
expectations drift silently.

---

## Issue 17 — Stale doc comment on the list route

**File:** `packages/server/src/api/workspaces.js`

The comment block above `projectWorkspacesRouter.get('/:projectId/workspaces', ...)` still
documents only two response shapes:

```
//   Without `limit` query param → bare array of root session rows.
//   With `limit` query param    → { workspaces: [...], pagination: {...} }
```

It never mentions `view=cards`, which is now the primary path and returns a third shape
including `facets`.

---

## Issue 18 — Observability headers are effectively invisible cross-origin

**File:** `packages/server/src/api/workspaces.js`

```js
res.set({
  'Server-Timing': `workspace;dur=${totalMs.toFixed(1)}, serialize;dur=${serializationMs.toFixed(1)}`,
  'X-Response-Bytes': String(Buffer.byteLength(body)),
});
```

`VITE_API_URL` defaults to a different origin from the dev frontend. Without
`Access-Control-Expose-Headers`, neither header is readable from JS — only visible in
devtools. `X-Response-Bytes` is also non-standard and duplicates `Content-Length`.

Minor inconsistency: `sendWorkspaceJson` is used for the detail endpoint and the cards path,
but not the legacy list path or `/members`.

---

## Issue 19 — Dead variable introduced

**File:** `packages/web/src/composables/useSessionTree.js:59`

```js
const session = sessionsStore.getSessionById(sessionId) || sessionsStore.currentSession;
```

Unused since `mergeProjectSessionsToStore` was removed. Confirmed:

```
$ npx eslint packages/web/src/composables/useSessionTree.js --rule '{"no-unused-vars":"error"}'
  59:11  error  'session' is assigned a value but never used
```

`yarn lint` passes because the project config has `no-unused-vars` disabled — worth revisiting
separately.

---

## Issue 20 — `uniqueCards` is dead defensiveness

**File:** `packages/web/src/stores/workspaceList.js`

```js
function uniqueCards(cards) {
  const seen = new Set();
  return cards.filter((card) => { /* dedupe by id */ });
}
```

Both `kanban_card_sessions.session_id` and `session_summaries.session_id` are declared
`UNIQUE` (`kanbanMigrations.js:48`, `session_summaries` schema), so neither `LEFT JOIN` in
`getWorkspaceCards` can fan out rows. Harmless, but it implies a duplicate-row bug that does
not exist and could mask a real one later.

---

# Wider Perspective

The read-model direction is correct and I would keep it.

The concern is that the change is framed as an optimization while the actual per-request
database cost went **up**: a full-forest recursive CTE plus an unindexed `MAX` over all
messages, evaluated across the entire filtered set because it drives the sort. Meanwhile the
client now re-fetches the whole loaded extent on every one of a high-frequency stream of
invalidation events.

On a small local database this reads as faster because it eliminated N round-trips. On a
project with a few thousand sessions and a busy agent it will read as slower and hotter than
what it replaced.

The code comments in `getWorkspaceCards` and `useWorkspaceListRealtime` show the authors knew
this and consciously deferred it. I would want Issues 4 and 5 addressed now — indexes, true
incremental paging, and a longer debounce — rather than deferred to a "maintained workspace
projection," because that deferral is precisely what makes the 500-row cap in Issue 3
necessary in the first place.
