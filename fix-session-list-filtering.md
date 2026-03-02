# Fix: Session List Filtering Bug

## Problem

Toggling the starred filter on the sessions tab can leave the session list in an inconsistent state where sessions go missing. The root cause is a **dual-layer filtering mismatch**: the starred filter is applied both server-side (in `fetchSessions`) and client-side (in `filteredGroupedSessions`), but re-fetches aren't triggered consistently when the filter changes.

### How the bug manifests

1. Page loads → `fetchSessions(projectId)` runs with `starredFilter=null` → `this.sessions` gets **all** sessions. This works correctly.
2. User toggles starred filter → no re-fetch happens → `filteredGroupedSessions` filters client-side → still works because `this.sessions` has the full dataset.
3. User navigates to a different project and back (or any other code path that calls `fetchSessions`) → `fetchSessions` now runs with `starredFilter='starred'` → `this.sessions` gets **only starred** sessions from the server.
4. User toggles starred filter to "unstarred" → `filteredGroupedSessions` filters `this.sessions` for unstarred → but `this.sessions` only contains starred sessions → **empty list**.

### Why hard refresh fixes it

A hard refresh clears sessionStorage, so `starredFilter` initializes to `null`. The `{ immediate: true }` project watcher fires `fetchSessions` before `onMounted` restores filters, so the initial fetch always gets the full dataset.

## Changes

### 1. Remove server-side starred filter from `fetchSessions`

**File:** `packages/web/src/stores/sessions.js` line 652

```js
// BEFORE
this.sessions = await api.getProjectSessions(projectId, false, this.starredFilter);

// AFTER
this.sessions = await api.getProjectSessions(projectId, false, null);
```

**Why:** The starred filter is already applied client-side in `filteredGroupedSessions` (SessionListView.vue line 394-398). Passing it server-side is redundant and dangerous — it causes `this.sessions` to hold an incomplete dataset whenever a re-fetch happens while a filter is active. With this change, `this.sessions` always contains the complete set of non-archived sessions, and all filtering happens purely in the view layer.

**Note on other filters:** `statusFilter` and `scheduledFilter` are already purely client-side (neither is passed to `fetchSessions` or the API). Only `starredFilter` has this dual-layer problem. For archived sessions, server-side filtering is correct because they use pagination — the existing watcher (line 650-666) properly re-fetches when the filter changes on the archived tab.

### 2. No other code changes needed

The `filteredGroupedSessions` computed property (SessionListView.vue lines 370-418) already correctly handles all filter combinations client-side:
- `starredFilter === null` → shows all (no filter applied)
- `starredFilter === 'starred'` → `groups.filter(group => group.parent.starred)`
- `starredFilter === 'unstarred'` → `groups.filter(group => !group.parent.starred)`
- `statusFilter` and `scheduledFilter` → already purely client-side, no changes needed

WebSocket handlers (`addSessionToList`, `updateSession`) mutate `this.sessions` in-place without re-fetching, so they are unaffected by this change. They will continue to add/update sessions in the complete dataset, and the view's computed property will filter them for display.

## Testing

### Existing tests to verify/update

**File:** `packages/web/src/views/SessionListView.test.js`
- Line 1367: Tests that `fetchSessions` is called with the project ID on project change. **No change needed** — this test doesn't assert anything about the starred parameter.
- Lines 1391-1560: Starred filter toggle tests. **Verify these still pass** — they test the view layer's `filteredGroupedSessions` computed, which is unchanged. These tests mock the store, so they set `starredFilter` directly and check rendered output.
- Lines 1636-1856: Archived tab starred filter tests. **No change needed** — archived filtering is unaffected.

**File:** `packages/web/src/stores/sessions.test.js`
- Lines 3211-3316: `starredFilter` tests. **Verify these still pass** — they test `setStarredFilter`, `saveStarredFilter`, and `restoreStarredFilter`, none of which call `fetchSessions`.

### New test to add

**File:** `packages/web/src/stores/sessions.test.js`

Add a test in the `fetchSessions` describe block (or create one if it doesn't exist) that verifies the starred filter is NOT passed to the API:

```js
describe('fetchSessions', () => {
  it('should always fetch all sessions regardless of starredFilter', async () => {
    const store = useSessionsStore();
    store.starredFilter = 'starred'; // Set a filter

    // Mock the API
    const mockSessions = [{ id: '1', starred: true }, { id: '2', starred: false }];
    api.getProjectSessions = vi.fn().mockResolvedValue(mockSessions);

    await store.fetchSessions('project-1');

    // Verify API was called with null for starred (not the store's starredFilter)
    expect(api.getProjectSessions).toHaveBeenCalledWith('project-1', false, null);
    // Verify ALL sessions are stored (not just starred)
    expect(store.sessions).toEqual(mockSessions);
  });
});
```

### Run existing test suites

```bash
# Store-level tests
yarn workspace @claudetools/web test src/stores/sessions.test.js

# View-level tests (includes starred filter toggle tests)
yarn workspace @claudetools/web test src/views/SessionListView.test.js

# Full test suite
yarn test

# E2E regression
./scripts/pw.sh test
```

## Risk Assessment

**Very low risk.** This is a single-line change that removes a redundant server-side filter. The client-side filter already handles the same logic. The change makes behavior more predictable: `this.sessions` always contains the full dataset, eliminating the class of bugs where partial data causes empty/wrong filter results.
