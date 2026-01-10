# Fix: Command Button Icons on Session List Views

## Problem Summary

Command button status icons on session list views have two issues:
1. **Icons don't render at all** if no commands are currently running
2. **Icons don't update in real-time** when commands succeed or fail

## Root Cause Analysis (Deep Dive)

### Issue 1: Icons Don't Render on Initial Load

The `SessionCard.vue` component calls `commandButtonsStore.getLatestRunForButton(buttonId, sessionId)` to get icon status. This getter only looks at `state.runs` in the Pinia store.

**The problem**: `state.runs` is never populated with historical run data!

Looking at `SessionListView.vue` line 330, it only calls:
```javascript
await commandButtonsStore.fetchButtons(newProjectId);  // Gets button definitions only!
```

There's no call to fetch run history. The `fetchActiveRuns(sessionId)` method exists but:
1. It's never called for sessions on the list view
2. It only returns "recent" runs (last 1 hour) - not truly historical data

**Current flow on SessionListView mount:**
```
1. fetchButtons(projectId) ✅ - Gets button definitions
2. Nothing fetches run history ❌
3. getLatestRunForButton() returns null - No runs in store!
```

### Issue 2: Real-Time Updates - Partially Working

`SessionListView.vue` DOES have WebSocket handlers (lines 383-415):
- `onCommandRunOutput` - **Creates run in state if missing** (lines 387-398) ✅
- `onCommandRunComplete` - Only calls `completeRun()` which **silently fails if run doesn't exist** ❌
- `onCommandRunError` - Only calls `errorRun()` which **silently fails if run doesn't exist** ❌

**Edge case bug**: If a command produces NO output before completing:
1. No `commandRunOutput` event → run not created in state
2. `commandRunComplete` event arrives → `completeRun()` checks `if (this.runs[runId])` and exits
3. Icon never appears!

### Issue 3: ActiveSessionsView Missing Handlers

`ActiveSessionsView.vue` has NO WebSocket handlers for command run events at all. It only has session-level handlers.

## Solution

### Step 1: Create API Endpoint for Historical Runs

Create a new endpoint that returns the **latest run for each button per session** within a project, regardless of when it was run.

**New Endpoint**: `GET /api/projects/:projectId/command-buttons/latest-runs`

**SQL Query** (using window function):
```sql
SELECT *
FROM (
  SELECT cr.*,
    ROW_NUMBER() OVER (PARTITION BY session_id, button_id ORDER BY started_at DESC) as rn
  FROM command_runs cr
  INNER JOIN sessions s ON cr.session_id = s.id
  WHERE s.project_id = ?
)
WHERE rn = 1
```

Returns one entry per (sessionId, buttonId) combination - the most recent run for each.

### Step 2: Add Repository Method

Add `getLatestRunsForProject(projectId)` to `CommandRunRepository.js`:
- Queries for the latest run per (sessionId, buttonId) within the project
- No time window - returns historical data

### Step 3: Add Store Action

Add `fetchLatestRunsForProject(projectId)` action to `commandButtonsStore`:
1. Calls the new API endpoint
2. Populates `state.runs` with returned data
3. Preserves any already-running commands (merge, don't replace)

### Step 4: Update SessionListView to Fetch Runs on Load

In the `projectId` watcher (line 309), add after fetching buttons:
```javascript
await commandButtonsStore.fetchButtons(newProjectId);
await commandButtonsStore.fetchLatestRunsForProject(newProjectId);  // NEW
```

### Step 5: Fix WebSocket Handler Edge Case

Update `onCommandRunComplete` handler in `SessionListView.vue` to create the run if it doesn't exist:

```javascript
onCommandRunComplete((runId, sessionId, buttonId, exitCode, output) => {
  // Create run if it doesn't exist (handles edge case of no output)
  if (!commandButtonsStore.runs[runId]) {
    commandButtonsStore.runs[runId] = {
      runId,
      buttonId,
      sessionId,
      status: 'running', // Will be updated immediately below
      output: '',
      exitCode: null,
      startedAt: Date.now(),
      outputTruncated: false,
    };
  }
  commandButtonsStore.completeRun(runId, exitCode, output);
})
```

Same fix needed for `onCommandRunError`.

### Step 6: Add WebSocket Handlers to ActiveSessionsView

Add command run WebSocket handlers to `ActiveSessionsView.vue`:
- Need to use global subscription (not project-specific) since it shows multiple projects
- Add handlers for `commandRunOutput`, `commandRunComplete`, `commandRunError`
- Call `fetchLatestRunsForProject` for each unique project ID on mount

## Files to Modify

### Server Package

1. **`packages/server/src/db/CommandRunRepository.js`**
   - Add `getLatestRunsForProject(projectId)` method

2. **`packages/server/src/api/commandButtons.js`** (or `projects.js`)
   - Add `GET /api/projects/:projectId/command-buttons/latest-runs` endpoint

### Web Package

3. **`packages/web/src/api/ApiClient.js`**
   - Add `getLatestRunsForProject(projectId)` method

4. **`packages/web/src/stores/commandButtons.js`**
   - Add `fetchLatestRunsForProject(projectId)` action

5. **`packages/web/src/views/SessionListView.vue`**
   - Call `fetchLatestRunsForProject` after fetching buttons (line ~330)
   - Fix `onCommandRunComplete` handler to create run if missing (line ~405)
   - Fix `onCommandRunError` handler to create run if missing (line ~411)

6. **`packages/web/src/views/ActiveSessionsView.vue`**
   - Add WebSocket handlers for command run events
   - Call `fetchLatestRunsForProject` for each unique project on mount

## Implementation Order

1. **Backend**: Add repository method `getLatestRunsForProject`
2. **Backend**: Add API endpoint
3. **Frontend**: Add API client method
4. **Frontend**: Add store action `fetchLatestRunsForProject`
5. **Frontend**: Update SessionListView to fetch runs on load
6. **Frontend**: Fix WebSocket handler edge case in SessionListView
7. **Frontend**: Add WebSocket handlers to ActiveSessionsView
8. **Test**: End-to-end verification

---

## Test Cases

### 1. Repository: `getLatestRunsForProject(projectId)`

**File**: `packages/server/src/db/CommandRunRepository.test.js`

```javascript
describe('getLatestRunsForProject', () => {
  it('returns latest run per (sessionId, buttonId) combination', () => {
    // Setup: Create two runs for same button/session, different times
    repository.create({ id: 'run-old', sessionId: 'sess-1', buttonId: 'btn-1' });
    repository.complete('run-old', 0, 'old output');
    repository.create({ id: 'run-new', sessionId: 'sess-1', buttonId: 'btn-1' });
    repository.complete('run-new', 0, 'new output');

    const runs = repository.getLatestRunsForProject('proj-1');

    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe('run-new');
  });

  it('returns runs from multiple sessions in same project', () => {
    repository.create({ id: 'run-1', sessionId: 'sess-1', buttonId: 'btn-1' });
    repository.create({ id: 'run-2', sessionId: 'sess-2', buttonId: 'btn-1' });

    const runs = repository.getLatestRunsForProject('proj-1');

    expect(runs.length).toBe(2);
    expect(runs.map(r => r.sessionId)).toContain('sess-1');
    expect(runs.map(r => r.sessionId)).toContain('sess-2');
  });

  it('returns runs for multiple buttons per session', () => {
    repository.create({ id: 'run-1', sessionId: 'sess-1', buttonId: 'btn-1' });
    repository.create({ id: 'run-2', sessionId: 'sess-1', buttonId: 'btn-2' });

    const runs = repository.getLatestRunsForProject('proj-1');

    expect(runs.length).toBe(2);
    expect(runs.map(r => r.buttonId)).toContain('btn-1');
    expect(runs.map(r => r.buttonId)).toContain('btn-2');
  });

  it('does not return runs from other projects', () => {
    // sess-1 belongs to proj-1, sess-other belongs to proj-2
    repository.create({ id: 'run-1', sessionId: 'sess-1', buttonId: 'btn-1' });
    repository.create({ id: 'run-other', sessionId: 'sess-other', buttonId: 'btn-1' });

    const runs = repository.getLatestRunsForProject('proj-1');

    expect(runs.length).toBe(1);
    expect(runs[0].sessionId).toBe('sess-1');
  });

  it('returns empty array when no runs exist for project', () => {
    const runs = repository.getLatestRunsForProject('proj-empty');

    expect(runs).toEqual([]);
  });

  it('includes all run fields (status, exitCode, output, timestamps)', () => {
    repository.create({ id: 'run-1', sessionId: 'sess-1', buttonId: 'btn-1' });
    repository.complete('run-1', 1, 'error output');

    const runs = repository.getLatestRunsForProject('proj-1');

    expect(runs[0]).toMatchObject({
      id: 'run-1',
      sessionId: 'sess-1',
      buttonId: 'btn-1',
      status: 'error',
      exitCode: 1,
      output: 'error output',
    });
    expect(runs[0].startedAt).toBeDefined();
    expect(runs[0].completedAt).toBeDefined();
  });
});
```

### 2. API Endpoint: `GET /api/projects/:projectId/command-buttons/latest-runs`

**File**: `packages/server/src/api/commandButtons.test.js`

```javascript
describe('GET /api/projects/:projectId/command-buttons/latest-runs', () => {
  it('returns 200 with array of latest runs', async () => {
    commandRuns.getLatestRunsForProject.mockReturnValue([
      { id: 'run-1', sessionId: 'sess-1', buttonId: 'btn-1', status: 'success' },
    ]);

    const res = await request(app).get(`/api/projects/${projectId}/command-buttons/latest-runs`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'run-1', sessionId: 'sess-1', buttonId: 'btn-1', status: 'success' },
    ]);
  });

  it('returns 404 for non-existent project', async () => {
    projects.findById.mockReturnValue(null);

    const res = await request(app).get('/api/projects/nonexistent/command-buttons/latest-runs');

    expect(res.status).toBe(404);
  });

  it('returns empty array when no runs exist', async () => {
    commandRuns.getLatestRunsForProject.mockReturnValue([]);

    const res = await request(app).get(`/api/projects/${projectId}/command-buttons/latest-runs`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
```

### 3. API Client: `getLatestRunsForProject(projectId)`

**File**: `packages/web/src/api/ApiClient.test.js`

```javascript
describe('getLatestRunsForProject', () => {
  it('calls correct endpoint', async () => {
    mockFetch.mockReturnValue(mockResponse([]));

    await client.getLatestRunsForProject('proj-123');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/projects/proj-123/command-buttons/latest-runs',
      expect.any(Object)
    );
  });

  it('returns parsed response array', async () => {
    const mockRuns = [
      { runId: 'run-1', sessionId: 'sess-1', buttonId: 'btn-1', status: 'success' },
    ];
    mockFetch.mockReturnValue(mockResponse(mockRuns));

    const result = await client.getLatestRunsForProject('proj-123');

    expect(result).toEqual(mockRuns);
  });
});
```

### 4. Store Action: `fetchLatestRunsForProject(projectId)`

**File**: `packages/web/src/stores/commandButtons.test.js`

```javascript
describe('fetchLatestRunsForProject', () => {
  it('populates state.runs with returned data', async () => {
    const mockRuns = [
      { runId: 'run-1', sessionId: 'sess-1', buttonId: 'btn-1', status: 'success', output: 'done' },
    ];
    api.getLatestRunsForProject.mockResolvedValue(mockRuns);
    const store = useCommandButtonsStore();

    await store.fetchLatestRunsForProject('proj-1');

    expect(store.runs['run-1']).toBeDefined();
    expect(store.runs['run-1'].status).toBe('success');
    expect(store.runs['run-1'].sessionId).toBe('sess-1');
  });

  it('preserves already-running commands (does not overwrite)', async () => {
    const store = useCommandButtonsStore();
    // Pre-existing running command with accumulated output
    store.runs = {
      'run-1': { runId: 'run-1', status: 'running', output: 'live output...' },
    };
    // Server returns stale data for same run
    api.getLatestRunsForProject.mockResolvedValue([
      { runId: 'run-1', status: 'running', output: '' },
    ]);

    await store.fetchLatestRunsForProject('proj-1');

    // Should keep the existing output, not overwrite with empty
    expect(store.runs['run-1'].output).toBe('live output...');
  });

  it('adds new runs without affecting existing different runs', async () => {
    const store = useCommandButtonsStore();
    store.runs = {
      'run-existing': { runId: 'run-existing', status: 'running' },
    };
    api.getLatestRunsForProject.mockResolvedValue([
      { runId: 'run-new', sessionId: 'sess-1', buttonId: 'btn-1', status: 'success' },
    ]);

    await store.fetchLatestRunsForProject('proj-1');

    expect(store.runs['run-existing']).toBeDefined();
    expect(store.runs['run-new']).toBeDefined();
  });

  it('handles API errors gracefully', async () => {
    api.getLatestRunsForProject.mockRejectedValue(new Error('Network error'));
    const store = useCommandButtonsStore();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await store.fetchLatestRunsForProject('proj-1');

    expect(store.error).toContain('Failed to fetch');
    consoleSpy.mockRestore();
  });

  it('sets sessionId on each run from response', async () => {
    api.getLatestRunsForProject.mockResolvedValue([
      { runId: 'run-1', sessionId: 'sess-abc', buttonId: 'btn-1', status: 'success' },
    ]);
    const store = useCommandButtonsStore();

    await store.fetchLatestRunsForProject('proj-1');

    expect(store.runs['run-1'].sessionId).toBe('sess-abc');
  });
});
```

### 5. SessionListView: Fetches Runs on Load

**File**: `packages/web/src/views/SessionListView.test.js`

```javascript
describe('command button runs loading', () => {
  it('calls fetchLatestRunsForProject after fetchButtons on projectId change', async () => {
    const wrapper = mount(SessionListView, { ... });

    await router.push('/projects/proj-123/sessions');
    await flushPromises();

    expect(commandButtonsStore.fetchButtons).toHaveBeenCalledWith('proj-123');
    expect(commandButtonsStore.fetchLatestRunsForProject).toHaveBeenCalledWith('proj-123');
  });

  it('displays icons for previously run commands after load', async () => {
    commandButtonsStore.buttons = [
      { id: 'btn-1', label: 'Test', showOnList: true, projectId: 'proj-123' },
    ];
    commandButtonsStore.runs = {
      'run-1': { runId: 'run-1', buttonId: 'btn-1', sessionId: 'sess-1', status: 'success' },
    };

    const wrapper = mount(SessionListView, { ... });
    await flushPromises();

    const statusIndicator = wrapper.find('.button-status-indicator');
    expect(statusIndicator.exists()).toBe(true);
    expect(statusIndicator.text()).toContain('✓');
  });
});
```

### 6. SessionListView: WebSocket Handler Edge Case Fix

**File**: `packages/web/src/views/SessionListView.test.js`

```javascript
describe('WebSocket command run handlers', () => {
  it('onCommandRunComplete creates run in state if missing', async () => {
    const wrapper = mount(SessionListView, { ... });
    await flushPromises();

    // Simulate complete event without prior output event
    const completeHandler = mockProjectSubscription.onCommandRunComplete.mock.calls[0][0];
    completeHandler('run-new', 'sess-1', 'btn-1', 0, 'output');

    expect(commandButtonsStore.runs['run-new']).toBeDefined();
    expect(commandButtonsStore.runs['run-new'].status).toBe('success');
  });

  it('onCommandRunError creates run in state if missing', async () => {
    const wrapper = mount(SessionListView, { ... });
    await flushPromises();

    // Simulate error event without prior output event
    const errorHandler = mockProjectSubscription.onCommandRunError.mock.calls[0][0];
    errorHandler('run-new', 'sess-1', 'btn-1', 'Command failed');

    expect(commandButtonsStore.runs['run-new']).toBeDefined();
    expect(commandButtonsStore.runs['run-new'].status).toBe('error');
  });

  it('onCommandRunComplete updates existing run (does not duplicate)', async () => {
    commandButtonsStore.runs = {
      'run-1': { runId: 'run-1', buttonId: 'btn-1', sessionId: 'sess-1', status: 'running', output: 'partial' },
    };
    const wrapper = mount(SessionListView, { ... });
    await flushPromises();

    const completeHandler = mockProjectSubscription.onCommandRunComplete.mock.calls[0][0];
    completeHandler('run-1', 'sess-1', 'btn-1', 0, 'full output');

    expect(Object.keys(commandButtonsStore.runs).length).toBe(1);
    expect(commandButtonsStore.runs['run-1'].status).toBe('success');
  });
});
```

### 7. ActiveSessionsView: WebSocket Handlers and Run Loading

**File**: `packages/web/src/views/ActiveSessionsView.test.js`

```javascript
describe('command button runs', () => {
  it('fetches latest runs for each unique project on mount', async () => {
    sessionsStore.activeSessions = [
      { id: 'sess-1', projectId: 'proj-1' },
      { id: 'sess-2', projectId: 'proj-1' },
      { id: 'sess-3', projectId: 'proj-2' },
    ];

    mount(ActiveSessionsView, { ... });
    await flushPromises();

    // Should fetch for proj-1 and proj-2 (deduplicated)
    expect(commandButtonsStore.fetchLatestRunsForProject).toHaveBeenCalledWith('proj-1');
    expect(commandButtonsStore.fetchLatestRunsForProject).toHaveBeenCalledWith('proj-2');
    expect(commandButtonsStore.fetchLatestRunsForProject).toHaveBeenCalledTimes(2);
  });

  it('handles commandRunOutput WebSocket events', async () => {
    const wrapper = mount(ActiveSessionsView, { ... });
    await flushPromises();

    // Get the registered handler
    const outputHandler = mockGlobalSubscription.onCommandRunOutput.mock.calls[0][0];
    outputHandler('run-1', 'sess-1', 'btn-1', 'output text');

    expect(commandButtonsStore.runs['run-1']).toBeDefined();
    expect(commandButtonsStore.runs['run-1'].status).toBe('running');
  });

  it('handles commandRunComplete WebSocket events', async () => {
    commandButtonsStore.runs = {
      'run-1': { runId: 'run-1', status: 'running' },
    };
    const wrapper = mount(ActiveSessionsView, { ... });
    await flushPromises();

    const completeHandler = mockGlobalSubscription.onCommandRunComplete.mock.calls[0][0];
    completeHandler('run-1', 'sess-1', 'btn-1', 0, 'done');

    expect(commandButtonsStore.runs['run-1'].status).toBe('success');
  });

  it('handles commandRunError WebSocket events', async () => {
    commandButtonsStore.runs = {
      'run-1': { runId: 'run-1', status: 'running' },
    };
    const wrapper = mount(ActiveSessionsView, { ... });
    await flushPromises();

    const errorHandler = mockGlobalSubscription.onCommandRunError.mock.calls[0][0];
    errorHandler('run-1', 'sess-1', 'btn-1', 'Failed');

    expect(commandButtonsStore.runs['run-1'].status).toBe('error');
  });

  it('creates run on complete if missing (edge case)', async () => {
    const wrapper = mount(ActiveSessionsView, { ... });
    await flushPromises();

    const completeHandler = mockGlobalSubscription.onCommandRunComplete.mock.calls[0][0];
    completeHandler('run-new', 'sess-1', 'btn-1', 1, 'error output');

    expect(commandButtonsStore.runs['run-new']).toBeDefined();
    expect(commandButtonsStore.runs['run-new'].buttonId).toBe('btn-1');
    expect(commandButtonsStore.runs['run-new'].sessionId).toBe('sess-1');
  });
});
```

### 8. Integration/E2E Tests

**File**: `tests/e2e/command-buttons.spec.ts`

```javascript
describe('Command Button Icons on Session List', () => {
  test('icons appear for previously run commands on page load', async ({ page }) => {
    // Setup: Run a command, then navigate away and back
    await page.goto('/projects/test-project/sessions');
    await page.click('[data-testid="session-card"]');
    await page.click('[data-testid="run-test-button"]');
    await page.waitForSelector('[data-testid="command-status-success"]');

    // Navigate away and back
    await page.goto('/');
    await page.goto('/projects/test-project/sessions');

    // Icon should still be visible
    const statusIcon = page.locator('[data-testid="button-status-indicator"]');
    await expect(statusIcon).toBeVisible();
    await expect(statusIcon).toHaveText('✓');
  });

  test('icon updates in real-time when command succeeds', async ({ page }) => {
    await page.goto('/projects/test-project/sessions');

    // Start command from session detail in another context
    const sessionPage = await page.context().newPage();
    await sessionPage.goto('/sessions/test-session');
    await sessionPage.click('[data-testid="run-test-button"]');

    // List view should show spinning icon
    await expect(page.locator('[data-testid="button-status-running"]')).toBeVisible();

    // Wait for completion
    await sessionPage.waitForSelector('[data-testid="command-status-success"]');

    // List view should update to checkmark
    await expect(page.locator('[data-testid="button-status-success"]')).toBeVisible();
  });

  test('icon updates in real-time when command fails', async ({ page }) => {
    await page.goto('/projects/test-project/sessions');

    // Trigger failing command
    await page.click('[data-testid="session-card"]');
    await page.click('[data-testid="run-failing-button"]');

    // Should show error icon
    await expect(page.locator('[data-testid="button-status-error"]')).toBeVisible();
  });

  test('active sessions view shows command status icons', async ({ page }) => {
    // Setup: Have a session with completed command
    await page.goto('/active');

    const statusIcon = page.locator('[data-testid="button-status-indicator"]').first();
    await expect(statusIcon).toBeVisible();
  });
});
```

---

## Future Considerations

- **Database cleanup**: `deleteOlderThan()` could delete historical runs. May need to preserve latest run per button per session, or accept that very old statuses may not persist.
- **Performance**: For projects with many sessions, the bulk endpoint keeps query count low (1 query vs N sessions)
