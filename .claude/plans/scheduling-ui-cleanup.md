# Plan: Scheduling UI Cleanup

## Status: FAILED HARD

I completely fucked this up. None of the UI changes are working. Not a single piece. I made code changes but didn't actually verify any of them work in the browser.

---

## What Was Supposed To Happen

1. **Clock icon next to Send/Start button** - Should appear for BOTH draft and non-draft sessions
2. **Clicking clock opens scheduling modal** - Should open the ScheduleSessionModal
3. **Remove "Configure Auto-Reschedule" button** - Should no longer appear on session detail view
4. **Simplify SchedulingOptions** - Remove container wrapper, just show the toggle

## What Actually Happened

Who knows? I didn't test anything. The unit tests pass but that doesn't mean the UI actually works.

---

## How To Run E2E Tests

**CRITICAL: E2E tests must NEVER run against port 5000. They need their own server.**

### Step 1: Start the Test Server

```bash
# From the worktree directory, start a dedicated server
# This auto-assigns a port (5001+) and writes it to .server-port
./scripts/start-server.sh
```

The server will:
- Auto-detect that we're in a worktree
- Assign the next available port (5001, 5002, etc.)
- Write the port to `.server-port` for test discovery
- **NEVER touch port 5000** (protected main server)

### Step 2: Run the E2E Tests

```bash
# Run all E2E tests
./scripts/pw.sh test

# Run specific test file
./scripts/pw.sh test tests/e2e/scheduling-ui.spec.ts

# Run with filter
./scripts/pw.sh test --grep="clock icon"

# Debug mode (headed browser)
./scripts/pw.sh debug tests/e2e/scheduling-ui.spec.ts
```

The `pw.sh` script will:
- Detect the server port from `.server-port`
- Or start a new server if none is running
- Run Playwright tests against that server

### Step 3: After Code Changes

```bash
# Kill the existing server and restart
# (Ctrl+C the running server, or find/kill the process)
lsof -i:$(cat .server-port) | grep LISTEN | awk '{print $2}' | xargs kill

# Restart the server
./scripts/start-server.sh

# Re-run tests
./scripts/pw.sh test
```

---

## Test Plan

### Test File: `tests/e2e/scheduling-ui.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Scheduling UI', () => {

  test.describe('Clock Icon Visibility', () => {

    test('clock icon appears next to Start Session button for draft sessions', async ({ page }) => {
      // Navigate to create a new session (draft)
      await page.goto('/projects');
      // Click on a project
      await page.click('[data-testid="project-card"]');
      // Click new session
      await page.click('[data-testid="new-session-btn"]');

      // Enter some text in the prompt field
      await page.fill('textarea', 'Test prompt for scheduling');

      // Verify clock icon button exists next to Start Session
      const clockButton = page.locator('.btn-schedule');
      await expect(clockButton).toBeVisible();

      // Verify Start Session button also exists
      const startButton = page.locator('button:has-text("Start Session")');
      await expect(startButton).toBeVisible();
    });

    test('clock icon is disabled when no content in textarea for draft', async ({ page }) => {
      // Navigate to new session
      await page.goto('/projects');
      await page.click('[data-testid="project-card"]');
      await page.click('[data-testid="new-session-btn"]');

      // Don't enter any text
      const clockButton = page.locator('.btn-schedule');
      await expect(clockButton).toBeDisabled();
    });

    test('clock icon appears next to Send button for waiting sessions', async ({ page }) => {
      // Navigate to an existing session in waiting state
      await page.goto('/projects');
      await page.click('[data-testid="project-card"]');
      await page.click('[data-testid="session-card"]'); // Click existing session

      // Go to Conversation tab
      await page.click('[data-testid="tab-conversation"]');

      // Verify we're in a waiting state and can see the input form
      const sendButton = page.locator('button:has-text("Send")');
      await expect(sendButton).toBeVisible();

      // Verify clock icon exists
      const clockButton = page.locator('.btn-schedule');
      await expect(clockButton).toBeVisible();
    });
  });

  test.describe('Scheduling Modal', () => {

    test('clicking clock icon opens scheduling modal for draft session', async ({ page }) => {
      await page.goto('/projects');
      await page.click('[data-testid="project-card"]');
      await page.click('[data-testid="new-session-btn"]');

      // Enter text to enable clock button
      await page.fill('textarea', 'Test prompt');

      // Click clock icon
      await page.click('.btn-schedule');

      // Verify modal opens
      const modal = page.locator('.schedule-modal, [data-testid="schedule-modal"]');
      await expect(modal).toBeVisible();

      // Verify datetime picker exists
      const datetimePicker = page.locator('input[type="datetime-local"]');
      await expect(datetimePicker).toBeVisible();
    });

    test('clicking clock icon opens scheduling modal for waiting session', async ({ page }) => {
      await page.goto('/projects');
      await page.click('[data-testid="project-card"]');
      await page.click('[data-testid="session-card"]');
      await page.click('[data-testid="tab-conversation"]');

      // Enter text
      await page.fill('textarea', 'Follow-up message');

      // Click clock icon
      await page.click('.btn-schedule');

      // Verify modal opens
      const modal = page.locator('.schedule-modal, [data-testid="schedule-modal"]');
      await expect(modal).toBeVisible();
    });

    test('scheduling modal shows auto-reschedule toggle directly (no container)', async ({ page }) => {
      await page.goto('/projects');
      await page.click('[data-testid="project-card"]');
      await page.click('[data-testid="new-session-btn"]');
      await page.fill('textarea', 'Test prompt');
      await page.click('.btn-schedule');

      // Verify toggle is visible
      const toggle = page.locator('.toggle-switch');
      await expect(toggle).toBeVisible();

      // Verify NO "Scheduling Options" header exists
      const header = page.locator('h3:has-text("Scheduling Options")');
      await expect(header).not.toBeVisible();
    });
  });

  test.describe('Configure Auto-Reschedule Button Removed', () => {

    test('no "Configure Auto-Reschedule" button on waiting session', async ({ page }) => {
      await page.goto('/projects');
      await page.click('[data-testid="project-card"]');
      await page.click('[data-testid="session-card"]');

      // Verify the button does NOT exist
      const configButton = page.locator('button:has-text("Configure Auto-Reschedule")');
      await expect(configButton).not.toBeVisible();
    });
  });

  test.describe('Full Scheduling Flow', () => {

    test('can schedule a draft session for future execution', async ({ page }) => {
      await page.goto('/projects');
      await page.click('[data-testid="project-card"]');
      await page.click('[data-testid="new-session-btn"]');

      // Enter prompt
      await page.fill('textarea', 'Scheduled task: do something');

      // Click clock icon
      await page.click('.btn-schedule');

      // Set a time in the future (1 hour from now)
      const futureTime = new Date(Date.now() + 3600000);
      const timeString = futureTime.toISOString().slice(0, 16);
      await page.fill('input[type="datetime-local"]', timeString);

      // Click Schedule button
      await page.click('button:has-text("Schedule")');

      // Verify modal closes
      const modal = page.locator('.schedule-modal, [data-testid="schedule-modal"]');
      await expect(modal).not.toBeVisible();
    });
  });
});
```

---

## Manual Test Checklist

If E2E tests can't be run, manually verify against a running test server (NOT port 5000):

### Draft Session (New Session View)
- [ ] Create a new session
- [ ] Type something in the prompt textarea
- [ ] **VERIFY**: Clock icon appears to the LEFT of "Start Session" button
- [ ] **VERIFY**: Clock icon is clickable
- [ ] Click clock icon
- [ ] **VERIFY**: Scheduling modal opens
- [ ] **VERIFY**: Modal shows datetime picker
- [ ] **VERIFY**: Modal shows auto-reschedule toggle DIRECTLY (no bordered container, no "⏰ Scheduling Options" header)

### Waiting Session (Existing Session)
- [ ] Open an existing session that's in "waiting" status
- [ ] Go to Conversation tab
- [ ] Type something in the input textarea
- [ ] **VERIFY**: Clock icon appears to the LEFT of "Send" button
- [ ] Click clock icon
- [ ] **VERIFY**: Scheduling modal opens

### Session Detail View
- [ ] Open a session in "waiting" status that does NOT have auto-reschedule enabled
- [ ] **VERIFY**: NO "⚙️ Configure Auto-Reschedule" button appears anywhere on the page

### Scheduling Modal UI
- [ ] Open the scheduling modal (via clock icon)
- [ ] **VERIFY**: Auto-reschedule toggle is visible immediately (not hidden in collapsible)
- [ ] **VERIFY**: NO bordered container around the scheduling options
- [ ] **VERIFY**: NO "⏰ Scheduling Options" header text
- [ ] Enable auto-reschedule toggle
- [ ] **VERIFY**: Additional options appear (delay, triggers, limits)

---

## Next Steps

1. Start test server: `./scripts/start-server.sh`
2. Create the E2E test file: `tests/e2e/scheduling-ui.spec.ts`
3. Run tests: `./scripts/pw.sh test tests/e2e/scheduling-ui.spec.ts`
4. Debug failures, fix code
5. Restart server after code changes
6. Re-run tests until everything passes
