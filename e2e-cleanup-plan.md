# E2E Test Cleanup and Parallelization Plan

## Executive Summary

This plan outlines the steps to remove all failing and skipped tests from the E2E test suite, then optimize the tests for parallel execution. Based on the test results summary, we have **84 failing tests** and **23 skipped tests** to address.

---

## Phase 1: Test File Inventory & Categorization

### Test Files to Modify

| File | Failing Tests | Skipped Tests | Action |
|------|---------------|---------------|--------|
| `canvas.spec.ts` | 24 (Canvas), 4 (Trash), 3 (Copy) | 0 | Remove failing tests |
| `draft-sessions.spec.ts` | 22 (Editing + Settings) | 1 | Remove failing + skipped |
| `commandButtons.spec.ts` | 13 | 0 | Remove failing tests |
| `sessions.spec.ts` | 9 | 5 | Remove failing + skipped |
| `conversation-persistence.spec.ts` | 4 | 0 | **DELETE ENTIRE FILE** |
| `conversation-branching.spec.ts` | 2 | 0 | **DELETE ENTIRE FILE** |
| `templates.spec.ts` | 6 | 0 | Remove failing tests |
| `file-attachments.spec.ts` | 2 | 0 | Remove failing tests |
| `scheduling-ui.spec.ts` | 1 | 1 | Remove failing + skipped |
| `slash-commands.spec.ts` | 1 | 0 | Remove failing test |
| `projects.spec.ts` | 0 | 4 | Remove skipped tests |
| `model-providers.spec.ts` | 0 | 2 | Remove skipped tests |
| `pwshOutput.spec.ts` | 0 | 3 | Remove skipped tests |
| `real-model-response.spec.ts` | 0 | 1 | **DELETE ENTIRE FILE** |
| `quick-response-dialog-fixed-footer.spec.ts` | 0 | 5 | Remove skipped tests |
| `qr-save-button-visibility.spec.ts` | 0 | 1 | Inspect & potentially delete |

### Files to Delete Entirely

1. **`conversation-persistence.spec.ts`** - All 4 tests are failing. These tests are marked CRITICAL but rely on real Claude API responses (haiku model) which isn't available in test environment.

2. **`conversation-branching.spec.ts`** - Both tests are failing with 30-second timeouts. The branching feature likely needs real Claude sessions.

3. **`real-model-response.spec.ts`** - Single test is skipped. Hardcoded URL/port makes it non-portable.

---

## Phase 2: Detailed Removal Plan

### 2.1 `canvas.spec.ts` - Remove 31 Failing Tests

**Tests to Remove from "Canvas Management" describe block:**
- `displays empty canvas state with upload option`
- `displays single canvas item directly in viewer (no list)`
- `displays file list when multiple items exist`
- `clicking list item opens viewer`
- `back button returns to list view`
- `markdown items default to preview mode and can toggle to raw`
- `markdown items render properly with MarkdownViewer`
- `can delete single canvas item`
- `displays different canvas item types in list`
- `image renders correctly in viewer when using data and mimeType fields`
- `image renders correctly when using data URL in content field`
- `image with invalid data shows as broken`
- `API returns error when image posted with raw base64 content (no data URL)`
- `can upload an image file via file input`
- `version grouping: shows version badge in list for files with same name`
- `version dropdown: can switch between versions`
- `delete all versions: removes entire file group`

**Tests to Remove from "Canvas Trash & Soft Delete" describe block:**
- `deleted items go to trash (soft delete)`
- `trash toggle button appears when trash has items`
- `can view trash and see deleted items`
- `back button returns from trash to canvas`

**Tests to Remove from "Canvas Copy Button" describe block:**
- `copy button exists in file list`
- `copy button exists in viewer header`
- `copy button has correct aria-label for accessibility`

**Tests to Keep (3 passing tests):**
- `API returns error when image file path does not exist`
- `can recover file from trash`
- `can permanently delete from trash`

### 2.2 `draft-sessions.spec.ts` - Remove 22 Failing + 1 Skipped

**Remove entire "Draft Session Editing" describe block** (14 failing tests):
All tests depend on draft session UI elements that don't exist or have changed selectors.

**Remove entire "Draft Session Settings UI" describe block** (8 failing + 1 skipped):
All tests look for `.thinking-toggle`, `.mode-buttons`, `.model-row` etc. that aren't rendering.

**Result:** Delete entire file or keep empty shell if describe blocks are used elsewhere.

### 2.3 `commandButtons.spec.ts` - Remove 13 Failing Tests

**Tests to Remove:**
- `should execute pwd and display correct output`
- `should execute echo and capture exact output`
- `should capture multi-line output correctly`
- `should kill running command when clicking stop button`
- `should stream output in real-time`
- `create a new command button`
- `edit an existing command button`
- `delete a command button`
- `run command button from session detail view`
- `kill running command`
- `copy command output to clipboard`
- `send command output to canvas`
- `validate required form fields`

**Tests to Keep (5 passing tests):**
- `see real-time command output`
- `navigate between tabs with output persisting`
- `show empty state when no buttons configured`
- `show error state when command fails`
- `show success state when command succeeds`
- `display command buttons in table on management page`

### 2.4 `sessions.spec.ts` - Remove 9 Failing + 5 Skipped

**Skipped tests to remove:**
- `can view session details - TODO: fix Notes tab visibility`
- `can switch between tabs - TODO: fix Notes tab navigation`
- `displays session mode - TODO: fix session mode badge visibility`
- `mode selector is visible on new session form - TODO: fix Plan button visibility`
- `YOLO mode is selected by default - TODO: fix mode button visibility`

**Failing tests to remove (from "Conversation - Mode Switching" describe block):**
- `mode switcher is visible in conversation tab when session is waiting`
- `mode switcher shows current session mode`
- `can switch mode from standard to yolo`
- `can switch mode from yolo to plan`
- `mode persists after page reload`

**Failing tests to remove (from "New Session - Mode Selection"):**
- `can create session with plan mode`
- `can create session with yolo mode`
- `can switch between modes`
- `can create a new session`

### 2.5 `templates.spec.ts` - Remove 6 Failing Tests

**Tests to Remove from "Session Templates - Empty State":**
- `displays empty state when no templates exist`
- `empty state Create Template button opens form`

**Tests to Remove from "Session Templates - Create Form":**
- `form has all required fields`
- `can create a project template`
- `can create a global template`
- `cancel button closes form`

**Tests to Keep:** All tests in Tab Navigation, Display, Edit, Delete, and Chaining sections.

### 2.6 `projects.spec.ts` - Remove 4 Skipped Tests

- `displays project list - TODO: fix test`
- `can navigate to project sessions - TODO: fix test`
- `can edit a project - TODO: fix test`
- `can delete a project - TODO: fix test`

**Test to Keep:**
- `can create a new project`

### 2.7 `model-providers.spec.ts` - Remove 2 Skipped Tests

- `FAILING: editing provider name via UI preserves auth token`
- `FAILING: editing provider via UI without touching auth token preserves it`

### 2.8 `quick-response-*.spec.ts` Files - Consolidate/Clean

**`quick-response-dialog-fixed-footer.spec.ts`** - Remove 5 skipped tests, keep 1 passing test

**Other quick-response files** - Evaluate and potentially delete if all tests are skipped/failing

### 2.9 Other Files

**`file-attachments.spec.ts`** - Remove 2 failing UI display tests
**`scheduling-ui.spec.ts`** - Remove 1 failing + 1 skipped test
**`slash-commands.spec.ts`** - Remove 1 failing test
**`pwshOutput.spec.ts`** - Remove 3 skipped tests

---

## Phase 3: Test Parallelization Strategy

### Current Configuration Analysis

```typescript
// Current playwright.config.ts
fullyParallel: false,  // Disabled
workers: 1,            // Single worker
```

### Recommended Parallel Configuration

```typescript
export default defineConfig({
  fullyParallel: true,    // Enable parallel test execution
  workers: process.env.CI ? 2 : 4,  // 4 workers locally, 2 in CI

  // Add test isolation
  use: {
    // Each test gets fresh browser context
    contextOptions: {
      ignoreHTTPSErrors: true,
    },
  },
});
```

### Test Isolation Requirements

For parallelization to work, tests must be **fully isolated**. Current issues to address:

1. **Database Isolation**: Each test calls `cleanupAll()` which affects all data
   - **Solution**: Prefix all test-created data with unique identifiers (already using `[TEST]`)
   - **Solution**: Use unique project names per test file/worker

2. **Shared State**: Tests share the same database
   - **Solution**: Each test should create its own project/session
   - **Already Good**: Tests use `seedProject()`, `seedSession()` etc.

3. **Port Conflicts**: Currently using single server on one port
   - **Solution**: The `pw.sh` script already handles this with `.server-port` file
   - **Already Good**: Tests read port from environment or file

### Parallelization Categories

**Group A - Can Run in Parallel (Isolated Tests):**
- `projects.spec.ts` - Creates own projects
- `model-providers.spec.ts` - Uses provider API isolation
- `templates.spec.ts` - Creates own templates
- `session-hooks.spec.ts` - Isolated session tests
- `child-session-indicators.spec.ts` - Isolated indicators

**Group B - Require Sequential Execution:**
- `canvas.spec.ts` - Uses shared beforeEach cleanup
- `commandButtons.spec.ts` - Depends on sequential command execution
- `sessions.spec.ts` - Complex session state dependencies

### Recommended Parallel Configuration

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 2 : 1,

  // Configure test sharding
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
```

---

## Phase 4: Implementation Steps

### Step 1: Delete Entire Files (5 minutes)
```bash
rm tests/e2e/conversation-persistence.spec.ts
rm tests/e2e/conversation-branching.spec.ts
rm tests/e2e/real-model-response.spec.ts
```

### Step 2: Clean Up Each Test File (30-45 minutes)

For each file, remove the failing/skipped tests identified above:

1. Open file
2. Delete or comment out identified tests
3. Remove empty describe blocks
4. Save file

### Step 3: Update Playwright Config (5 minutes)

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 2 : 1,
  reporter: 'list',
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
  use: {
    baseURL: getBaseURL(),
    trace: 'on-first-retry',
    actionTimeout: 10000,
    navigationTimeout: 30000,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  globalSetup: require.resolve('./tests/e2e/global-setup'),
  globalTeardown: require.resolve('./tests/e2e/global-teardown'),
});
```

### Step 4: Run Tests and Verify (10 minutes)
```bash
./scripts/pw.sh test
```

### Step 5: Fix Any Remaining Issues (Variable)

Address any unexpected failures from parallelization.

---

## Expected Outcome

### Before Cleanup
- **Total Tests**: 270
- **Failing**: 84 (168 with retries)
- **Skipped**: 23
- **Passing**: ~163 (estimated)

### After Cleanup
- **Total Tests**: ~163 (only passing tests remain)
- **Failing**: 0
- **Skipped**: 0
- **Parallel Execution**: 4 workers (local), 2 workers (CI)

### Time Savings (Estimated)

| Configuration | Before | After |
|---------------|--------|-------|
| Sequential (1 worker) | ~15-20 min | ~8-10 min |
| Parallel (4 workers) | N/A | ~2-3 min |

---

## Risk Mitigation

1. **Git Branch**: All changes on feature branch `claude-tools/7e97-end-end-test-cleanup`
2. **Backup**: No destructive database operations
3. **Reversibility**: Git history preserves all deleted tests
4. **Future Work**: Deleted tests can be restored and fixed individually

---

## Files Summary

### Files to Delete Entirely (3)
- `tests/e2e/conversation-persistence.spec.ts`
- `tests/e2e/conversation-branching.spec.ts`
- `tests/e2e/real-model-response.spec.ts`

### Files to Modify (13)
- `tests/e2e/canvas.spec.ts`
- `tests/e2e/draft-sessions.spec.ts`
- `tests/e2e/commandButtons.spec.ts`
- `tests/e2e/sessions.spec.ts`
- `tests/e2e/templates.spec.ts`
- `tests/e2e/projects.spec.ts`
- `tests/e2e/model-providers.spec.ts`
- `tests/e2e/file-attachments.spec.ts`
- `tests/e2e/scheduling-ui.spec.ts`
- `tests/e2e/slash-commands.spec.ts`
- `tests/e2e/pwshOutput.spec.ts`
- `tests/e2e/quick-response-dialog-fixed-footer.spec.ts`
- `playwright.config.ts`

### Files to Keep Unchanged (14)
- `tests/e2e/child-session-indicators.spec.ts`
- `tests/e2e/path-chooser.spec.ts`
- `tests/e2e/session-hooks.spec.ts`
- `tests/e2e/session-navigation.spec.ts`
- `tests/e2e/sessionDefaults.spec.ts`
- `tests/e2e/sessionListButtonIndicators.spec.ts`
- `tests/e2e/thinking-leak.spec.ts`
- `tests/e2e/token-count-realtime.spec.ts`
- `tests/e2e/work-logs.spec.ts`
- `tests/e2e/model-selector-default.spec.ts`
- `tests/e2e/scheduled-session-prompt.spec.ts`
- `tests/e2e/scheduled-session-prompt-visible.spec.ts`
- `tests/e2e/helpers.ts`
- `tests/e2e/global-setup.ts` / `global-teardown.ts`
