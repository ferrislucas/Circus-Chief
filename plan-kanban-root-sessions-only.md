# Plan: Filter Kanban "Add Session to Lane" to Show Only Root Sessions

## Summary
When users click "Add Session" to add a session to a kanban lane, only root sessions (sessions without a parent session) should be available for selection. Child sessions should be excluded from the list.

## Current Behavior
- The `AddSessionToLaneModal.vue` component fetches ALL sessions for a project
- It filters out sessions already on the board
- It does NOT filter out child sessions (sessions with a `parentSessionId`)

## Desired Behavior
- Only root sessions (`parentSessionId === null`) should appear in the "Add Session" modal
- Child sessions should be excluded from the list
- This prevents adding child sessions to kanban lanes independently of their parent

## Implementation Plan

### 1. Frontend Changes
**File: `packages/web/src/components/AddSessionToLaneModal.vue`**

In the `loadSessions()` function (around line 162), add a filter to exclude child sessions:

```javascript
// After fetching sessions
const sessions = await api.getProjectSessions(props.projectId, false, null);
const sessionsArray = Array.isArray(sessions) ? sessions : sessions?.sessions || [];

// Filter to only include root sessions (no parent)
availableSessions.value = sessionsArray.filter(s => !s.parentSessionId);
```

Alternatively, add the filter to the `filteredSessions` computed property (line 98-113):

```javascript
const filteredSessions = computed(() => {
  let sessions = availableSessions.value.filter((s) => {
    // Check if session is already on the board
    return !kanbanStore.isSessionOnBoard(s.id);
  });

  // NEW: Filter to only root sessions
  sessions = sessions.filter((s) => !s.parentSessionId);

  // Apply search filter
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase();
    sessions = sessions.filter((s) =>
      s.name?.toLowerCase().includes(query)
    );
  }

  return sessions;
});
```

**Recommendation:** Use the computed property approach so the filter is always applied, even if sessions are loaded from elsewhere.

### 2. Backend Considerations
The backend already returns `parentSessionId` in the session responses (per `SessionResponse` schema in `packages/shared/src/contracts/sessions.js` line 70), so no backend changes are needed.

### 3. Testing Strategy

#### E2E Test
**File: `tests/e2e/kanban-board.spec.ts`** (or new test file)

Add a test to verify child sessions are not shown:

```typescript
test('child sessions should not appear in "Add Session" modal', async ({ page }) => {
  // Create a root session
  const rootSession = await seedSession(project.id, {
    prompt: 'Root session',
    name: 'Root Session',
    startImmediately: false,
  });

  // Create a child session
  const childSession = await seedChildSession(project.id, rootSession.id, {
    prompt: 'Child session',
    name: 'Child Session',
  });

  // Navigate to kanban tab
  await navigateAndWait(page, `/projects/${project.id}/kanban`, {
    waitFor: '.kanban-board',
  });

  // Open "Add Session" modal
  const lane = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
  await lane.locator('.add-session-btn').click();

  // Wait for modal and sessions to load
  await expect(page.locator('.modal-content')).toBeVisible();
  await page.waitForSelector('.session-item', { timeout: 10000 });

  // Get all session names in the list
  const sessionNames = await page.locator('.session-name').allTextContents();

  // Assert root session is visible
  expect(sessionNames).toContain('Root Session');

  // Assert child session is NOT visible
  expect(sessionNames).not.toContain('Child Session');
});
```

### 4. Implementation Steps
1. ✅ Explore codebase and understand current implementation
2. ⬜ Modify `AddSessionToLaneModal.vue` to filter out child sessions
3. ⬜ Write E2E test to verify the behavior
4. ⬜ Run E2E tests to ensure no regressions
5. ⬜ Manually test the feature in the browser

### 5. Files to Modify
- `packages/web/src/components/AddSessionToLaneModal.vue` - Add filter for root sessions only
- `tests/e2e/kanban-board.spec.ts` - Add E2E test (or create new test file)

### 6. Success Criteria
- ✅ Only root sessions appear in the "Add Session" modal
- ✅ Child sessions are excluded from the list
- ✅ Search functionality still works correctly
- ✅ Sessions already on the board are still filtered out
- ✅ E2E tests pass
- ✅ No regressions in existing kanban functionality

## Notes
- Root sessions are identified by `parentSessionId === null` or `parentSessionId === undefined`
- The `parentSessionId` field is already included in API responses
- Child sessions can still be viewed in the SessionListView but should not be added to kanban lanes independently
