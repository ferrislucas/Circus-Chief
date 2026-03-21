# Plan: E2E Test for Command Button Run Removal Bug

## Problem Summary

When removing a command button run from the **session list view**, the run doesn't actually get removed. This is different from the session detail view where removal works correctly.

## Root Cause Analysis

After investigating the codebase, I've identified the bug:

### The Bug

In `packages/web/src/components/SessionCard.vue` (lines 132-138), the `ButtonStatusModal` is instantiated without passing the `sessionId` prop:

```vue
<ButtonStatusModal
  v-if="selectedButtonForModal"
  :button="{ label: selectedButtonForModal.label, command: selectedButtonForModal.command }"
  :latest-run="selectedButtonForModal.latestRun"
  :is-open="!!selectedButtonForModal"
  @close="selectedButtonForModal = null"
/>
```

The `sessionId` prop is missing!

### Why This Breaks Removal

In `packages/web/src/components/ButtonStatusModal.vue` (line 297), the `handleRemoveRun` method calls:

```javascript
await commandButtonsStore.deleteRun(props.sessionId, props.latestRun.runId);
```

When `props.sessionId` is `undefined`, the API call becomes:
```javascript
DELETE /api/sessions/undefined/command-buttons/runs/{runId}
```

This returns a 404 (Session not found), so the run never gets deleted from the database.

### Contrast: Session Detail View (Works Correctly)

In `packages/web/src/views/SessionDetailView.vue`, the ButtonStatusModal correctly receives the sessionId:

```vue
<ButtonStatusModal
  :button="selectedButtonForModal"
  :latest-run="selectedButtonForModal.latestRun"
  :session-id="session.id"
  :is-open="!!selectedButtonForModal"
  @close="selectedButtonForModal = null"
/>
```

This is why removal works in the session detail view but not in the session list view.

## Test Strategy

Create an end-to-end test that:

1. **Sets up the scenario:**
   - Create a project and session
   - Create a command button with `showOnList: true`
   - Run the command to completion
   - Navigate to the **session list view** (not session detail)

2. **Attempts to remove from session list:**
   - Click the command button status indicator on the session card
   - Verify the modal opens with run details
   - Click "Remove Run" → "Confirm"
   - **This should fail** (demonstrating the bug)

3. **Verifies the bug:**
   - Check that the status indicator is still visible (run wasn't removed)
   - Verify the run still exists in the database via API
   - Optionally check console/network for 404 error

4. **Contrast with working behavior (optional):**
   - Navigate to session detail view
   - Remove the run from there
   - Verify it actually gets removed
   - This confirms the feature works when sessionId is properly passed

## Implementation Steps

### Step 1: Add Helper Function

Add a helper function in `tests/e2e/helpers.ts` to attempt removal from the session list view:

```typescript
export async function removeCommandRunFromSessionList(page, buttonLabel) {
  // Click status indicator on session card in list view
  const indicator = page.locator(
    `.session-card .button-status-indicator[title*="${buttonLabel}"]`
  ).first();

  await indicator.click();

  // Wait for modal
  await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible();

  // Click remove and confirm
  await page.locator('[data-testid="remove-run-button"]').click();
  await expect(page.locator('[data-testid="confirm-remove-button"]')).toBeVisible();
  await page.locator('[data-testid="confirm-remove-button"]').click();

  // Wait for modal to close
  await page.locator('[data-testid="button-status-modal"]').waitFor({ state: 'hidden', timeout: 5000 });
}
```

### Step 2: Create the Test File

Create `tests/e2e/command-buttons-remove-sessionlist-bug.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCommandButton,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
  runCommandButtonAndWait,
  getCommandRun,
  getSession,
} from './helpers';

test.describe('Command Buttons - Remove Run from Session List Bug', () => {
  test.describe.configure({ timeout: 60000 });

  let project;
  let session;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Session List Remove Bug', '/tmp/test');
    session = await seedSession(project.id, {
      prompt: 'Test session for list removal bug',
      name: 'List Remove Bug Session',
    });
    await waitForSessionToExist(session.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('removing run from session list view does not actually remove the run (bug)', async ({ page }) => {
    // Step 1: Create and run a command button
    const button = await seedCommandButton(project.id, {
      label: 'List View Test',
      command: 'echo "This should not be removed"',
      showOnList: true, // Critical: ensures button appears on session list
    });

    const run = await runCommandButtonAndWait(session.id, button.id, 15000);
    expect(run.status).toBe('success');

    // Step 2: Navigate to session LIST view (not detail view)
    await navigateAndWait(page, `/projects/${project.id}/sessions`);
    await page.waitForTimeout(1000); // Wait for WebSocket connection

    // Step 3: Verify status indicator is visible on session card
    const indicator = page.locator(
      `.session-card .button-status-indicator[title*="List View Test"]`
    );
    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Step 4: Attempt to remove the run from the session list view
    await indicator.click();
    await expect(page.locator('[data-testid="button-status-modal"]')).toBeVisible();

    // Click "Remove Run" and confirm
    await page.locator('[data-testid="remove-run-button"]').click();
    await expect(page.locator('[data-testid="confirm-remove-button"]')).toBeVisible();
    await page.locator('[data-testid="confirm-remove-button"]').click();

    // Modal closes (API call silently fails with 404)
    await page.locator('[data-testid="button-status-modal"]').waitFor({ state: 'hidden', timeout: 5000 });

    // Step 5: Verify the BUG - run was NOT actually removed
    // The status indicator should still be visible
    await expect(indicator).toBeVisible({ timeout: 5000 });

    // Step 6: Verify database - run still exists
    const existingRun = await getCommandRun(session.id, run.runId);
    expect(existingRun).not.toBeNull();
    expect(existingRun.runId).toBe(run.runId);

    // Step 7: Verify session's latestCommandRuns still contains the run
    const sessionData = await getSession(session.id);
    const runStillInLatest = sessionData.latestCommandRuns?.find(r => r.runId === run.runId);
    expect(runStillInLatest).toBeDefined();
  });

  test('contrast: removing run from session detail view works correctly', async ({ page }) => {
    // This test demonstrates the correct behavior when sessionId is properly provided

    const button = await seedCommandButton(project.id, {
      label: 'Detail View Test',
      command: 'echo "This will be removed correctly"',
      showOnList: true,
    });

    const run = await runCommandButtonAndWait(session.id, button.id, 15000);
    expect(run.status).toBe('success');

    // Navigate to session DETAIL view
    await navigateAndWait(page, `/sessions/${session.id}`);
    await page.waitForTimeout(1000);

    // Remove the run using existing helper
    await removeCommandRunViaUI(page, 'Detail View Test');

    // Verify run was actually removed
    const deletedRun = await getCommandRun(session.id, run.runId);
    expect(deletedRun).toBeNull();

    const sessionData = await getSession(session.id);
    const runInLatest = sessionData.latestCommandRuns?.find(r => r.runId === run.runId);
    expect(runInLatest).toBeUndefined();
  });
});
```

### Step 3: Run the Test

Execute the test to confirm it surfaces the bug:

```bash
./scripts/pw.sh test tests/e2e/command-buttons-remove-sessionlist-bug.spec.ts
```

### Expected Test Results

**Before Fix:**
- First test (`removing run from session list view does not actually remove the run`) ✅ PASSES - demonstrating the bug
- Second test (`contrast: removing run from session detail view works correctly`) ✅ PASSES - showing the feature works when properly implemented

**After Fix:**
- First test should ❌ FAIL (because the removal will now work correctly)
- Need to update test expectations to verify successful removal

## Fix Implementation (After Test Confirms Bug)

Once the test surfaces the bug, fix it by adding `sessionId` prop to ButtonStatusModal in SessionCard.vue:

```vue
<ButtonStatusModal
  v-if="selectedButtonForModal"
  :button="{ label: selectedButtonForModal.label, command: selectedButtonForModal.command }"
  :latest-run="selectedButtonForModal.latestRun"
  :session-id="session.id"
  :is-open="!!selectedButtonForModal"
  @close="selectedButtonForModal = null"
/>
```

Then update the test to expect successful removal:

```typescript
test('removing run from session list view successfully removes the run', async ({ page }) => {
  // ... setup code ...

  // Remove the run
  await removeCommandRunFromSessionList(page, 'List View Test');

  // Verify run was removed
  await expect(indicator).not.toBeVisible({ timeout: 5000 });

  const deletedRun = await getCommandRun(session.id, run.runId);
  expect(deletedRun).toBeNull();
});
```

## Benefits of This Approach

1. **Documents the bug** - The test serves as executable documentation of the issue
2. **Prevents regression** - After the fix, the test ensures the bug doesn't reoccur
3. **Provides contrast** - Shows what works (detail view) vs what doesn't (list view)
4. **Guides the fix** - Makes it clear exactly what needs to be changed
5. **Validates the fix** - After implementing the fix, the test will confirm it works

## Timeline

1. **Write test** (30 min) - Implement the E2E test as described
2. **Confirm bug** (5 min) - Run test to verify it surfaces the issue
3. **Implement fix** (5 min) - Add sessionId prop to SessionCard.vue
4. **Verify fix** (5 min) - Update test expectations and confirm everything works
5. **Clean up** (10 min) - Update test to be positive verification rather than bug demonstration

Total: ~1 hour
