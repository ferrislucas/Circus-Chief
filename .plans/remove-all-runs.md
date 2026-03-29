# Plan: "Remove Run" Should Delete All Runs for a Button

## Problem

When a user clicks "Remove Run" in the `ButtonStatusModal`, only the single most-recent run is deleted. If the same command button has been executed multiple times, the next-oldest run surfaces as the new "latest run" and the status indicator persists. The user must repeat the remove action for every historical run before the indicator finally disappears.

**Expected behavior:** Clicking "Remove Run" should delete **all** runs for that button (within the session), so the indicator goes away immediately.

## Root Cause

The current flow only deletes one run at a time:

1. **Frontend** (`ButtonStatusModal.vue` line 317): calls `commandButtonsStore.deleteRun(sessionId, latestRun.runId)` with a single `runId`.
2. **Frontend store** (`commandButtons.js` line 420-422): `deleteRun()` calls `api.deleteCommandRun(sessionId, runId)` -- single run.
3. **Backend API** (`commandButtons.js` line 282-315): `DELETE /runs/:runId` deletes one row from `command_runs`.
4. After deletion, `getLatestRunsForSession` / `getLatestRunsForProject` returns the next-oldest run, which becomes the new indicator.

## Implementation Plan

### 1. Backend: Add new repository method to delete all runs for a button+session

**File:** `packages/server/src/db/CommandRunRepository.js`

Add a new method:
```js
deleteByButtonAndSession(buttonId, sessionId) {
  const result = this.db
    .prepare('DELETE FROM command_runs WHERE button_id = ? AND session_id = ? AND status != ?')
    .run(buttonId, sessionId, 'running');
  return result.changes;
}
```

This deletes all non-running runs for the given button in the given session.

### 2. Backend: Add new API endpoint for bulk deletion

**File:** `packages/server/src/api/commandButtons.js`

Add a new route:
```
DELETE /api/sessions/:sessionId/command-buttons/:buttonId/runs
```

This endpoint will:
1. Verify the session exists
2. Verify the button exists
3. Check that no runs for this button are currently running (return 409 if so -- or skip running ones)
4. Call `commandRuns.deleteByButtonAndSession(buttonId, sessionId)`
5. Broadcast `COMMAND_RUN_DELETED` events for each deleted run (or a new bulk event)
6. Return 204

### 3. Frontend: Add API client method

**File:** `packages/web/src/api/resources/CommandButtonsApi.js`

Add:
```js
async deleteAllRunsForButton(sessionId, buttonId) {
  return this.client.delete(`/sessions/${sessionId}/command-buttons/${buttonId}/runs`);
}
```

### 4. Frontend: Add store action for bulk delete

**File:** `packages/web/src/stores/commandButtons.js`

Add a new action:
```js
async deleteAllRunsForButton(sessionId, buttonId) {
  await api.deleteAllRunsForButton(sessionId, buttonId);
  // Clear all runs for this button from local state
  for (const runId of Object.keys(this.runs)) {
    if (this.runs[runId].buttonId === buttonId && this.runs[runId].sessionId === sessionId) {
      this.clearRun(runId);
    }
  }
}
```

### 5. Frontend: Update ButtonStatusModal to call bulk delete

**File:** `packages/web/src/components/ButtonStatusModal.vue`

Change `handleRemoveRun()` to call the new bulk action:
```js
const handleRemoveRun = async () => {
  deleting.value = true;
  try {
    await commandButtonsStore.deleteAllRunsForButton(props.sessionId, props.button.id);
    emit('close');
  } catch (err) {
    console.error('Failed to remove runs:', err);
  } finally {
    deleting.value = false;
    showConfirmation.value = false;
  }
};
```

### 6. Frontend: Update sessions store handler

**File:** `packages/web/src/stores/sessions.js`

The existing `removeSessionCommandRun(sessionId, buttonId)` method already removes by `buttonId`, so it should work correctly with the bulk delete. Verify that the WebSocket handler in `useProjectSessionSubscription.js` properly clears the indicator.

### 7. WebSocket handling for bulk deletes

Two options (recommend Option A for simplicity):

**Option A:** Have the backend return the list of deleted run IDs, and the frontend clears them locally (no new WS event type needed). Other tabs receive individual `COMMAND_RUN_DELETED` events for each deleted run.

**Option B:** Add a new WS event type `COMMAND_RUNS_BULK_DELETED` that includes `{ buttonId, sessionId, deletedRunIds }`. This is cleaner for multi-tab sync but adds a new protocol message.

I recommend **Option A** since it minimizes changes and the existing `COMMAND_RUN_DELETED` handler already works per-run.

## Files to Change

| File | Change |
|------|--------|
| `packages/server/src/db/CommandRunRepository.js` | Add `deleteByButtonAndSession()` method |
| `packages/server/src/api/commandButtons.js` | Add `DELETE /:buttonId/runs` endpoint |
| `packages/web/src/api/resources/CommandButtonsApi.js` | Add `deleteAllRunsForButton()` API method |
| `packages/web/src/stores/commandButtons.js` | Add `deleteAllRunsForButton()` store action |
| `packages/web/src/components/ButtonStatusModal.vue` | Update `handleRemoveRun()` to use bulk delete |

## Testing

- Unit test: `CommandRunRepository` - verify `deleteByButtonAndSession` deletes correct rows and skips running ones
- Unit test: `commandButtons` store - verify `deleteAllRunsForButton` clears all matching runs from state
- E2E test: Run a command button 3 times, click "Remove Run" once, verify indicator disappears completely
