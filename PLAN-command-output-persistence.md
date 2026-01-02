# Plan: Fix Command Button Output Persistence Bug

## Problem Statement

When navigating away from the Commands tab and returning, command output is sometimes gone. The user reports this happens more frequently with failed commands, and the issue is intermittent ("works correctly sometimes").

## Status

**Database persistence was already implemented.** The actual bugs are in the frontend component's run-to-button mapping logic.

---

## Root Cause Analysis

After tracing the complete data flow, I identified **two bugs** causing this issue:

### Bug 1: Wrong Run Shown for Buttons with Multiple Runs (PRIMARY CAUSE)

**Location:** `packages/web/src/components/CommandsTab.vue` lines 243-245

**Problem:** When mapping button IDs to run IDs after fetching active runs:

```javascript
for (const run of activeRuns) {
  currentRunIds[run.buttonId] = run.runId;
}
```

The runs are returned from the API in `ORDER BY started_at DESC` (newest first), but the loop iterates through ALL of them, **overwriting** the mapping with each iteration. This means for buttons with multiple runs, the mapping ends up pointing to the **oldest** run instead of the most recent one.

**Example Scenario:**
1. Button A has 3 runs: Run1 (oldest, success), Run2, Run3 (newest, failed)
2. API returns: [Run3, Run2, Run1] (DESC order - newest first)
3. Loop iteration 1: `currentRunIds[buttonA] = Run3.id` (correct!)
4. Loop iteration 2: `currentRunIds[buttonA] = Run2.id` (overwrites!)
5. Loop iteration 3: `currentRunIds[buttonA] = Run1.id` (overwrites!)
6. Final result: Button A shows Run1 (oldest success), **not** Run3 (newest failure)

**Why this explains the symptom:** The user sees output "disappear" for failed commands because:
- They run a command → it fails → they see the failed output
- They run it again → it succeeds → they see success output
- They leave and return → they see the OLD successful run (because loop overwrote with oldest)

### Bug 2: Empty Output on Command Spawn Failure

**Location:** `packages/server/src/services/commandRunner.js` lines 167-175

**Problem:** When a command fails to spawn (e.g., command not found), the exception handler saves empty output:

```javascript
} catch (err) {
  const msg = `Error running command: ${err.message}`;
  if (onError) onError(msg);  // Sends error via WebSocket
  commandRuns.complete(runId, 1, '');  // <-- EMPTY STRING saved to DB!
  // ...
}
```

The error message is sent via WebSocket but **not persisted to database**. When the user returns to the tab, the database has empty output.

---

## Proposed Fixes

### Fix 1: Only Map First (Newest) Run Per Button

**File:** `packages/web/src/components/CommandsTab.vue`

**Option A - Use existing getter (RECOMMENDED):**
Replace:
```html
:run="commandButtonsStore.getRun(currentRunIds[button.id])"
```
With:
```html
:run="commandButtonsStore.getLatestRunForButton(button.id, sessionId)"
```

The store already has a `getLatestRunForButton` getter that correctly handles this!

**Option B - Fix the loop:**
```javascript
for (const run of activeRuns) {
  // Only set if not already set (first = newest due to DESC order)
  if (!currentRunIds[run.buttonId]) {
    currentRunIds[run.buttonId] = run.runId;
  }
}
```

### Fix 2: Persist Error Message on Spawn Failure

**File:** `packages/server/src/services/commandRunner.js`

Change:
```javascript
commandRuns.complete(runId, 1, '');
```
To:
```javascript
commandRuns.complete(runId, 1, `[Error] ${msg}`);
```

---

## Files to Modify

| File | Change | Priority |
|------|--------|----------|
| `packages/web/src/components/CommandsTab.vue` | Use `getLatestRunForButton` getter | HIGH |
| `packages/server/src/services/commandRunner.js` | Persist error message on spawn failure | MEDIUM |

---

## Testing Plan

1. **Test multiple runs per button (Bug 1):**
   - Run a command that succeeds
   - Leave and return to tab - verify success output shown
   - Run same command again (fails this time)
   - Leave and return to tab - verify FAILURE output shown (not old success)

2. **Test failed command spawn (Bug 2):**
   - Create button with invalid command (`nonexistent-command-xyz`)
   - Run it
   - Leave and return to tab - verify error message is shown

3. **Regression tests:**
   - Single run per button still works
   - Running command shows live output
   - Kill button works for running commands

---

## Previous Analysis (Archived)

The following was the original analysis before database persistence was implemented. Keeping for reference.

## Solution Design

### Phase 1: Database Persistence (Server)

#### 1.1 Create CommandRunRepository
Create a new repository to persist command run history.

**New File:** `packages/server/src/db/CommandRunRepository.js`

```javascript
// Schema for command_runs table:
// - id (TEXT PRIMARY KEY)
// - session_id (TEXT, FK)
// - button_id (TEXT, FK)
// - status (TEXT: 'running' | 'success' | 'error' | 'killed')
// - output (TEXT)
// - exit_code (INTEGER, nullable)
// - started_at (DATETIME)
// - completed_at (DATETIME, nullable)
```

#### 1.2 Update DatabaseManager
Add migration to create `command_runs` table.

**File:** `packages/server/src/db/DatabaseManager.js`

#### 1.3 Update commandRunner.js
Integrate with CommandRunRepository:
- Create run record when command starts
- Update output incrementally (buffered writes every 500ms)
- Update status and exit_code when complete

**File:** `packages/server/src/services/commandRunner.js`

### Phase 2: API Endpoints (Server)

#### 2.1 Add endpoint to fetch runs for session
Return both active AND recent completed runs.

**Modify:** `packages/server/src/api/commandButtons.js`

```javascript
// GET /api/sessions/:sessionId/command-buttons/runs
// Returns: Array of runs including:
// - Currently running (from commandRunner.processes with live output)
// - Recent completed (from database, last 1 hour or configurable)
```

#### 2.2 Add endpoint to get single run by ID
For fetching full output on demand.

```javascript
// GET /api/sessions/:sessionId/command-buttons/runs/:runId
```

### Phase 3: Client Updates (Web)

#### 3.1 Update commandButtonsStore.js
Modify `fetchActiveRuns` to restore all runs (running + completed).

**File:** `packages/web/src/stores/commandButtons.js`

```javascript
async fetchRuns(sessionId) {
  // Fetch all runs (active + recent completed)
  const runs = await api.getRuns(sessionId);
  for (const run of runs) {
    this.runs[run.runId] = {
      runId: run.runId,
      buttonId: run.buttonId,
      status: run.status,
      output: run.output,
      exitCode: run.exitCode,
    };
  }
  return runs;
}
```

#### 3.2 Update CommandsTab.vue
Restore proper mapping on mount.

**File:** `packages/web/src/components/CommandsTab.vue`

```javascript
onMounted(async () => {
  await commandButtonsStore.fetchButtons(props.projectId);

  // Fetch ALL runs (running + completed) for this session
  const runs = await commandButtonsStore.fetchRuns(props.sessionId);

  // Restore currentRunIds mapping (use most recent run per button)
  for (const run of runs) {
    currentRunIds[run.buttonId] = run.runId;
  }

  // Setup WebSocket handlers for streaming (running commands)
  setupWebSocketHandlers();
});
```

#### 3.3 Update ApiClient.js
Add new API methods.

**File:** `packages/web/src/api/ApiClient.js`

### Phase 4: WebSocket Reconnection

Ensure that when returning to the tab with a running command:
1. WebSocket handlers are re-established
2. Any output missed during navigation is fetched from database
3. New output continues streaming

## Files to Modify

| File | Changes |
|------|---------|
| `packages/server/src/db/DatabaseManager.js` | Add migration for `command_runs` table |
| `packages/server/src/db/CommandRunRepository.js` | **NEW** - Repository for command runs |
| `packages/server/src/database.js` | Export CommandRunRepository instance |
| `packages/server/src/services/commandRunner.js` | Persist runs to database |
| `packages/server/src/api/commandButtons.js` | Update `/runs` endpoint, add single run endpoint |
| `packages/web/src/api/ApiClient.js` | Add `getRuns()` and `getRun()` methods |
| `packages/web/src/stores/commandButtons.js` | Update `fetchActiveRuns` → `fetchRuns` |
| `packages/web/src/components/CommandsTab.vue` | Restore all runs on mount |

## Testing Strategy

### 1. Server Unit Tests

#### 1.1 CommandRunRepository Tests
**File:** `packages/server/src/db/CommandRunRepository.test.js` (NEW)

```javascript
describe('CommandRunRepository', () => {
  describe('create()', () => {
    it('should create a new run record with required fields')
    it('should generate unique id if not provided')
    it('should set started_at to current timestamp')
    it('should set initial status to "running"')
  })

  describe('getById()', () => {
    it('should return run by id')
    it('should return null for non-existent id')
  })

  describe('getBySessionId()', () => {
    it('should return all runs for a session')
    it('should return empty array for session with no runs')
    it('should order by started_at descending (most recent first)')
  })

  describe('getRecentBySessionId()', () => {
    it('should return runs from last hour by default')
    it('should respect custom time window parameter')
    it('should include currently running commands regardless of time')
  })

  describe('updateOutput()', () => {
    it('should append text to existing output')
    it('should handle empty initial output')
    it('should handle large output (>1MB)')
  })

  describe('complete()', () => {
    it('should set status to "success" for exit code 0')
    it('should set status to "error" for non-zero exit code')
    it('should set completed_at timestamp')
    it('should preserve final output')
  })

  describe('markKilled()', () => {
    it('should set status to "killed"')
    it('should set completed_at timestamp')
  })

  describe('deleteOlderThan()', () => {
    it('should delete runs older than specified duration')
    it('should not delete runs within retention period')
    it('should return count of deleted records')
  })
})
```

#### 1.2 CommandRunner Integration Tests
**File:** `packages/server/src/services/commandRunner.test.js` (UPDATE)

```javascript
describe('CommandRunner with persistence', () => {
  describe('run()', () => {
    it('should create database record when command starts')
    it('should update database output as command streams')
    it('should buffer output updates (not write every character)')
    it('should flush buffered output on command completion')
    it('should mark run complete in database on success')
    it('should mark run error in database on failure')
  })

  describe('kill()', () => {
    it('should mark run as killed in database')
    it('should flush any buffered output before marking killed')
  })

  describe('getRunsBySession()', () => {
    it('should merge in-memory running processes with database records')
    it('should prefer in-memory output for running commands (more current)')
  })
})
```

#### 1.3 API Endpoint Tests
**File:** `packages/server/src/api/commandButtons.test.js` (UPDATE)

```javascript
describe('GET /api/sessions/:sessionId/command-buttons/runs', () => {
  it('should return 404 for non-existent session')
  it('should return empty array when no runs exist')
  it('should return running commands with current output')
  it('should return recently completed commands from database')
  it('should merge running and completed runs correctly')
  it('should return most recent run per button when multiple exist')
  it('should include all run fields (runId, buttonId, status, output, exitCode, startedAt)')
})

describe('GET /api/sessions/:sessionId/command-buttons/runs/:runId', () => {
  it('should return 404 for non-existent run')
  it('should return full run details including complete output')
  it('should return current output for still-running command')
})

describe('POST /api/sessions/:sessionId/command-buttons/run/:buttonId', () => {
  it('should create run record in database')
  it('should return runId immediately')
  it('should stream output via WebSocket')
  it('should update database on completion')
})

describe('POST /api/sessions/:sessionId/command-buttons/runs/:runId/kill', () => {
  it('should mark run as killed in database')
  it('should return 404 for already completed run')
})
```

### 2. Client Unit Tests

#### 2.1 Store Tests
**File:** `packages/web/src/stores/commandButtons.test.js` (UPDATE)

```javascript
describe('commandButtonsStore', () => {
  describe('fetchRuns()', () => {
    it('should fetch all runs for session from API')
    it('should populate runs state with fetched data')
    it('should handle empty response')
    it('should handle API errors gracefully')
    it('should preserve existing runs not in response')
  })

  describe('run restoration', () => {
    it('should restore running command with current output')
    it('should restore completed command with full output')
    it('should restore error command with exit code')
    it('should restore killed command with partial output')
  })

  describe('appendOutput() after restoration', () => {
    it('should append new output to restored running command')
    it('should not duplicate output already fetched from server')
  })

  describe('completeRun() after restoration', () => {
    it('should update status of restored running command')
    it('should merge server output with streamed output correctly')
  })
})
```

#### 2.2 Component Tests
**File:** `packages/web/src/components/CommandsTab.test.js` (UPDATE)

```javascript
describe('CommandsTab', () => {
  describe('mount behavior', () => {
    it('should fetch buttons on mount')
    it('should fetch all runs (running + completed) on mount')
    it('should restore currentRunIds mapping from fetched runs')
    it('should setup WebSocket handlers after fetching runs')
    it('should display restored run output immediately')
  })

  describe('run restoration scenarios', () => {
    it('should show running command with spinner when restored')
    it('should show completed command with success status')
    it('should show error command with error status')
    it('should show killed command with appropriate status')
  })

  describe('WebSocket reconnection', () => {
    it('should receive new output for running command after remount')
    it('should not lose output between unmount and remount')
    it('should handle completion event after remount')
  })

  describe('multiple buttons', () => {
    it('should restore most recent run for each button')
    it('should handle buttons with no runs')
    it('should handle mix of running and completed runs')
  })
})
```

#### 2.3 CommandButtonItem Tests
**File:** `packages/web/src/components/CommandButtonItem.test.js` (UPDATE)

```javascript
describe('CommandButtonItem with restored runs', () => {
  it('should display restored output correctly')
  it('should show exit code for completed runs')
  it('should enable copy/send-to-canvas for completed runs')
  it('should show kill button for running runs')
  it('should auto-scroll work after restoration')
})
```

### 3. E2E Tests (Playwright)

**File:** `tests/e2e/command-buttons.spec.ts` (NEW or UPDATE)

```javascript
describe('Command Button Output Persistence', () => {
  describe('completed command persistence', () => {
    it('should preserve output when navigating away and back', async () => {
      // 1. Navigate to session with command buttons
      // 2. Run a quick command (echo "test")
      // 3. Wait for completion
      // 4. Navigate to different tab (e.g., Conversation)
      // 5. Navigate back to Commands tab
      // 6. Verify output is still visible
      // 7. Verify exit code is displayed
    })

    it('should preserve output across page refresh', async () => {
      // 1. Run command, wait for completion
      // 2. Refresh the page
      // 3. Navigate to Commands tab
      // 4. Verify output is restored
    })
  })

  describe('running command persistence', () => {
    it('should continue streaming after navigating away and back', async () => {
      // 1. Run a long-running command (sleep + periodic echo)
      // 2. Verify output is streaming
      // 3. Navigate to different tab
      // 4. Wait 2 seconds
      // 5. Navigate back to Commands tab
      // 6. Verify output includes content from while away
      // 7. Verify new output continues to appear
    })

    it('should show running indicator after page refresh', async () => {
      // 1. Start long-running command
      // 2. Refresh page
      // 3. Navigate to Commands tab
      // 4. Verify command shows as running
      // 5. Verify accumulated output is shown
      // 6. Verify streaming continues
    })
  })

  describe('multiple commands', () => {
    it('should preserve output for multiple buttons independently', async () => {
      // 1. Run command on button A
      // 2. Run command on button B
      // 3. Navigate away
      // 4. Navigate back
      // 5. Verify both outputs are preserved
    })
  })

  describe('edge cases', () => {
    it('should handle command that completes while on different tab', async () => {
      // 1. Start command
      // 2. Navigate away
      // 3. Wait for command to complete
      // 4. Navigate back
      // 5. Verify completed status and full output
    })

    it('should handle kill while on different tab', async () => {
      // 1. Start long-running command
      // 2. Navigate away
      // 3. Kill command via API
      // 4. Navigate back
      // 5. Verify killed status
    })
  })
})
```

### 4. Test Files Summary

| Test File | Status | Tests Added |
|-----------|--------|-------------|
| `packages/server/src/db/CommandRunRepository.test.js` | **NEW** | ~15 tests |
| `packages/server/src/services/commandRunner.test.js` | UPDATE | ~8 tests |
| `packages/server/src/api/commandButtons.test.js` | UPDATE | ~12 tests |
| `packages/web/src/stores/commandButtons.test.js` | UPDATE | ~10 tests |
| `packages/web/src/components/CommandsTab.test.js` | UPDATE | ~12 tests |
| `packages/web/src/components/CommandButtonItem.test.js` | UPDATE | ~5 tests |
| `tests/e2e/command-buttons.spec.ts` | NEW/UPDATE | ~8 tests |

**Total: ~70 new/updated tests**

## Implementation Order

1. Create database migration and CommandRunRepository
2. Integrate commandRunner with database persistence
3. Update API endpoints
4. Update client store and components
5. Add tests
6. Manual testing

## Estimated Effort

- Database layer: ~1 hour
- Server integration: ~1 hour
- Client updates: ~30 minutes
- Testing: ~1 hour

**Total: ~3.5 hours**
