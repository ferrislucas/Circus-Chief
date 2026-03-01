# Performance Fix Plan

## Current State

Session list page takes **20-25 seconds** to load. Only **6 root session cards** are visible, but **68 non-archived sessions** (6 roots + 62 children in workflow trees) are fetched, and a summary request fires for every single one.

---

## Fix 1: Parallelize Summary Fetches (Quick Win)

**Impact: ~8-10 seconds saved**
**Effort: Tiny (15 min)**

### Problem
The session list fires **68 individual** `GET /api/sessions/:id/summary` calls — one per session. Each takes 40-150ms. The `fetchSummaries()` loop does NOT `await` each call (no `await` on line 673), so the calls fire in a burst — but the browser's HTTP/1.1 connection limit (6 concurrent per host) serializes most of them into a waterfall anyway.

### Solution
This is actually **already fire-and-forget** (no `await` in the loop). The real bottleneck is **68 calls × 6-connection browser limit = ~12 rounds of sequential network trips**. The fix should reduce the number of calls, not just parallelize them — see Fix 3.

However, there's a quick optimization: **only fetch summaries for visible root sessions, not all 68 sessions including children.** The `fetchSummaries()` loop iterates `sessionsStore.sessions` (all 68), but child session summaries aren't displayed on the session list cards.

```js
// BEFORE: fetches summaries for ALL 68 sessions
const sessions = sessionsStore.sessions;
for (const session of sessions) { ... }

// AFTER: only fetch for root sessions (6 calls instead of 68)
const sessions = sessionsStore.sessions.filter(s => !s.parentSessionId);
for (const session of sessions) { ... }
```

This same issue exists in `fetchArchivedSummaries()` (line 712-718) and in **`ActiveSessionsView.vue`** (line 362-368) which has an identical pattern.

### Files to Change
- `packages/web/src/views/SessionListView.vue` — filter to root sessions in `fetchSummaries()` and `fetchArchivedSummaries()`
- `packages/web/src/views/ActiveSessionsView.vue` — same filter in its `fetchSummaries()`

### Test Coverage
- **Unit test:** Add test in `SessionListView.test.js` verifying that `getSessionSummary` is only called for root sessions, not child sessions. Mock `sessionsStore.sessions` with a mix of root and child sessions, trigger the watcher, assert call count.
- **E2E test:** The existing `performance-audit.spec.ts` "Session list page load performance" test will validate — summary call count should drop from ~68 to ~6. Assert `summaryCalls.length` matches root session count.

---

## Fix 2: Cache `files-count` Git Operations

**Impact: ~4-32 seconds saved (when sessions have worktrees)**
**Effort: Small (30 min)**

### Problem
`GET /api/sessions/:id/files-count` spawns two git subprocesses per session (`getOriginDefaultBranch` + `getModifiedFilesCount`). During the initial audit with 7 worktree sessions, each call took **4,400-4,700ms** — totaling ~32 seconds.

The `files-count` call fires from **`SessionCard.vue`'s `onMounted`** hook (line 381-391) — meaning **every rendered SessionCard** fires one, including child session cards when a workflow is expanded. This is the component doing the calling, not a centralized view-level fetch.

### Solution
Add a server-side TTL cache in the `files-count` route handler:

```
Map<sessionId, { count, timestamp }>
```

- **TTL: 60 seconds** — file counts don't change that fast
- Cache key: `sessionId` (the git dir is derived from it)
- Invalidate on session status change to `completed`
- Return cached value immediately; refresh in background if stale

### Files to Change
- `packages/server/src/api/sessions.js` — the `/:id/files-count` handler (line 207)

### Test Coverage
- **Unit test:** Add test in `sessions.filesCount.test.js` (already exists, extend it):
  - Call the endpoint twice within TTL — verify `gitService.getModifiedFilesCount` is called once
  - Call after TTL expires — verify git is called again
  - Test cache invalidation scenario
- **E2E test:** The `performance-audit.spec.ts` "Session list page load performance" test already tracks `files-count` timing. After the fix, individual calls should return in < 10ms (cache hit) instead of 4,400ms.

---

## Fix 3: Batch Summary Endpoint (Proper Long-Term Fix)

**Impact: Replaces Fix 1's filtering with a single HTTP call**
**Effort: Medium (1-2 hr)**

### Problem
Even after Fix 1 reduces calls from 68 to ~6, it's still 6 individual HTTP round-trips. And the `ActiveSessionsView` could have many more root sessions across all projects.

### Solution
Two changes (server + client):

**Server — New batch endpoint:**

> **Route ordering concern:** This must be registered BEFORE the `/:id/summary` route (line 1068) in `sessions.js`, otherwise Express will match `summaries` as an `:id` param. Place it near the other non-parameterized routes at the top of the file (after `/scheduled` on line 26).

```
POST /api/sessions/summaries/batch
Body: { ids: ["id1", "id2", ...] }
```

Using POST instead of GET avoids URL length limits with many session IDs. Returns `{ [sessionId]: summaryObject | null }`.

**Repository — New method in `SessionSummaryRepository.js`:**
```js
getBySessionIds(sessionIds) {
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = this.db
    .prepare(`SELECT * FROM session_summaries WHERE session_id IN (${placeholders})`)
    .all(...sessionIds);
  return rows.map(this.map);
}
```

Note: The repository class is `SessionSummaryRepository` (not `SummaryRepository` as previously stated). It's imported in `sessions.js` as `sessionSummaries` from `../database.js`.

**Client — New API method + update views:**

Add `getSessionSummariesBatch(ids)` to `ApiClient.js`, then update `SessionListView.vue` and `ActiveSessionsView.vue` to call it instead of the loop.

### Files to Change
- `packages/server/src/db/SessionSummaryRepository.js` — add `getBySessionIds(ids[])`
- `packages/server/src/api/sessions.js` — add `POST /summaries/batch` route (before `/:id` routes)
- `packages/web/src/api/ApiClient.js` — add `getSessionSummariesBatch(ids)`
- `packages/web/src/views/SessionListView.vue` — use batch in `fetchSummaries()` and `fetchArchivedSummaries()`
- `packages/web/src/views/ActiveSessionsView.vue` — use batch in `fetchSummaries()`

### Test Coverage
- **Unit test (server):** Add test in `SessionSummaryRepository.test.js`:
  - `getBySessionIds` with mix of existing and non-existing IDs
  - Empty array input returns empty array
  - Verify correct mapping of all fields
- **Unit test (server route):** Test `POST /sessions/summaries/batch` in existing sessions API test:
  - Returns summaries keyed by session ID
  - Missing sessions return null values
  - Validates ids array is required
- **Unit test (client):** Test `getSessionSummariesBatch` in `ApiClient.test.js`
- **Unit test (view):** Update `SessionListView.test.js` to verify batch call is made instead of individual calls
- **E2E test:** The `performance-audit.spec.ts` test should show 1 summary API call instead of 6-68. Update the summary call counter to check for batch endpoint.

---

## Execution Order

| Priority | Fix | Time | Load Time Impact |
|----------|-----|------|-----------------|
| 1 | Fix 1: Filter to root-only summaries | 15 min | -8-10s (68 calls → 6) |
| 2 | Fix 2: Cache files-count | 30 min | -4 to -32s (with worktrees) |
| 3 | Fix 3: Batch summary endpoint | 1-2 hr | 6 calls → 1 call |

**Fix 1 alone should bring load time from ~25s down to ~3-5s.**
Fix 1 + Fix 2 covers the worktree case too.
Fix 3 is the clean long-term solution.

---

## Validation

After each fix, run the performance audit E2E test:
```bash
BASE_URL=http://localhost:5000 API_URL=http://localhost:5000 \
  npx playwright test tests/e2e/performance-audit.spec.ts
```

And run the existing unit test suites for modified files:
```bash
yarn workspace @claudetools/web test src/views/SessionListView.test.js
yarn workspace @claudetools/web test src/views/ActiveSessionsView.test.js
yarn workspace @claudetools/server test src/api/sessions.filesCount.test.js
yarn workspace @claudetools/server test src/db/SessionSummaryRepository.test.js
```

**Target:** Session list loads in **< 3 seconds** with current data volume.
