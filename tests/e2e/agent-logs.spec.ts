import { test, expect, type Page } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedAgentCallLog,
  cleanupCreatedResources,
} from './helpers';

/**
 * Scope all agent-call list requests to a specific session.
 *
 * The Agent Logs page shows ALL logs globally, which causes interference when
 * parallel test workers each seed their own data. By intercepting requests and
 * injecting `sessionId=<id>` we make each test see only its own session's logs.
 *
 * filter-options (/api/agent-calls/filter-options) is intentionally NOT
 * intercepted — it needs to return all distinct values so the dropdowns are
 * populated with our seeded option values.
 */
async function scopeLogsToSession(page: Page, sessionId: string) {
  await page.route(/\/api\/agent-calls(\?.*)?$/, async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.set('sessionId', sessionId);
    await route.continue({ url: url.toString() });
  });
}

test.describe('Agent Logs - Settings Tab', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    project = await seedProject('Agent Logs Test', '/tmp/test');
    session = await seedSession(project.id, {
      prompt: 'test session for agent logs',
      name: 'Logs Test Session',
      startImmediately: false,
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // ============================================================
  // 1. Navigation & Page Load (3 tests)
  // ============================================================

  test('Logs tab is visible and has active class on /settings/logs', async ({ page }) => {
    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');
    const tab = page.locator('a.tab').filter({ hasText: 'Logs' });
    await expect(tab).toBeVisible();
    await expect(tab).toHaveClass(/active/);
  });

  test('shows empty state message when no logs exist', async ({ page }) => {
    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.empty-cell')).toHaveText('No agent call logs found.');
  });

  test('filter bar dropdowns and date inputs are all visible on load', async ({ page }) => {
    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // Check the 4 filter select dropdowns
    for (const labelText of ['Agent Type', 'Call Type', 'Status', 'Model']) {
      const group = page.locator('.filter-group').filter({
        has: page.locator('label.filter-label', { hasText: labelText }),
      });
      await expect(group.locator('select')).toBeVisible();
    }

    // Check the 2 date range inputs
    for (const labelText of ['From', 'To']) {
      const group = page.locator('.filter-group').filter({
        has: page.locator('label.filter-label', { hasText: labelText }),
      });
      await expect(group.locator('input[type="date"]')).toBeVisible();
    }
  });

  // ============================================================
  // 2. Table Data Display (6 tests)
  // ============================================================

  test('displays seeded agent call logs in the table', async ({ page }) => {
    await seedAgentCallLog(session.id, {
      agentType: 'claude-code',
      callType: 'runSession',
      model: 'claude-sonnet',
    });
    await seedAgentCallLog(session.id, {
      agentType: 'other-agent',
      callType: 'continueSession',
      model: 'claude-opus',
    });
    await seedAgentCallLog(session.id, {
      agentType: 'claude-code',
      callType: 'runSession',
      model: 'claude-haiku',
    });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.log-row')).toHaveCount(3);
  });

  test('status column shows colored dots for completed and error statuses', async ({ page }) => {
    await seedAgentCallLog(session.id, { status: 'completed' });
    await seedAgentCallLog(session.id, { status: 'error', errorMessage: 'Connection timeout' });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.dot-completed')).toHaveCount(1);
    await expect(page.locator('.dot-error')).toHaveCount(1);
    // Verify status text is rendered
    const rows = page.locator('.log-row');
    const statuses = await rows.allTextContents();
    expect(statuses.some((t) => t.includes('completed'))).toBe(true);
    expect(statuses.some((t) => t.includes('error'))).toBe(true);
  });

  test('session column links to session detail page', async ({ page }) => {
    await seedAgentCallLog(session.id);

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    const link = page.locator('a.session-link').first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href).toContain(`/sessions/${session.id}`);
  });

  test('tokens column displays locale-formatted total token count', async ({ page }) => {
    // 1,000,000 + 200,000 + 34,567 = 1,234,567
    await seedAgentCallLog(session.id, {
      inputTokens: 1000000,
      outputTokens: 200000,
      thinkingTokens: 34567,
    });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    const row = page.locator('.log-row').first();
    // Use regex to be locale-resilient (commas, periods, or spaces as separators)
    await expect(row).toContainText(/1.234.567/);
  });

  test('duration column displays human-readable time (2m 5s for 125000ms)', async ({ page }) => {
    await seedAgentCallLog(session.id, { durationMs: 125000 });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.log-row').first()).toContainText('2m 5s');
  });

  test('null model field renders as em-dash', async ({ page }) => {
    // model defaults to null in the seeding endpoint
    await seedAgentCallLog(session.id, { model: null });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    const modelCell = page.locator('.log-row .model-cell').first();
    await expect(modelCell).toHaveText('—');
  });

  // ============================================================
  // 3. Filtering (8 tests)
  // ============================================================

  test('filter by status shows only matching logs', async ({ page }) => {
    await seedAgentCallLog(session.id, { status: 'completed' });
    await seedAgentCallLog(session.id, { status: 'completed' });
    await seedAgentCallLog(session.id, { status: 'error', errorMessage: 'fail' });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.log-row')).toHaveCount(3);

    const statusGroup = page.locator('.filter-group').filter({
      has: page.locator('label.filter-label', { hasText: 'Status' }),
    });
    await statusGroup.locator('select').selectOption('completed');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.log-row')).toHaveCount(2);
    // Verify all visible rows show 'completed'
    const rows = page.locator('.log-row');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).toContainText('completed');
    }
  });

  test('filter by agent type shows only matching logs', async ({ page }) => {
    await seedAgentCallLog(session.id, { agentType: 'claude-code' });
    await seedAgentCallLog(session.id, { agentType: 'other-agent' });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    const agentTypeGroup = page.locator('.filter-group').filter({
      has: page.locator('label.filter-label', { hasText: 'Agent Type' }),
    });
    await agentTypeGroup.locator('select').selectOption('claude-code');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.log-row')).toHaveCount(1);
    await expect(page.locator('.log-row').first()).toContainText('claude-code');
  });

  test('filter by call type shows only matching logs', async ({ page }) => {
    await seedAgentCallLog(session.id, { callType: 'runSession' });
    await seedAgentCallLog(session.id, { callType: 'continueSession' });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    const callTypeGroup = page.locator('.filter-group').filter({
      has: page.locator('label.filter-label', { hasText: 'Call Type' }),
    });
    await callTypeGroup.locator('select').selectOption('continueSession');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.log-row')).toHaveCount(1);
    await expect(page.locator('.log-row').first()).toContainText('continueSession');
  });

  test('filter by model shows only matching logs', async ({ page }) => {
    await seedAgentCallLog(session.id, { model: 'claude-sonnet' });
    await seedAgentCallLog(session.id, { model: 'claude-opus' });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    const modelGroup = page.locator('.filter-group').filter({
      has: page.locator('label.filter-label', { hasText: 'Model' }),
    });
    await modelGroup.locator('select').selectOption('claude-sonnet');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.log-row')).toHaveCount(1);
    await expect(page.locator('.log-row').first()).toContainText('claude-sonnet');
  });

  test('filter by date range shows only logs within range', async ({ page }) => {
    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    await seedAgentCallLog(session.id, { startedAt: yesterday });
    await seedAgentCallLog(session.id, { startedAt: sevenDaysAgo });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.log-row')).toHaveCount(2);

    // Set "From" to 3 days ago — filters out the 7-day-old log
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const fromGroup = page.locator('.filter-group').filter({
      has: page.locator('label.filter-label', { hasText: 'From' }),
    });
    const dateInput = fromGroup.locator('input[type="date"]');
    await dateInput.fill(threeDaysAgo);
    await dateInput.dispatchEvent('change');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.log-row')).toHaveCount(1);
  });

  test('clear filters button appears when a filter is active', async ({ page }) => {
    await seedAgentCallLog(session.id, { status: 'completed' });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // No clear button initially
    await expect(page.locator('.btn-clear')).not.toBeVisible();

    // Select a status filter to make it active
    const statusGroup = page.locator('.filter-group').filter({
      has: page.locator('label.filter-label', { hasText: 'Status' }),
    });
    await statusGroup.locator('select').selectOption('completed');

    // Clear button should now appear
    await expect(page.locator('.btn-clear')).toBeVisible();
    await expect(page.locator('.btn-clear')).toHaveText('Clear Filters');
  });

  test('clear filters button resets all filters and hides itself', async ({ page }) => {
    await seedAgentCallLog(session.id, { status: 'completed' });
    await seedAgentCallLog(session.id, { status: 'error', errorMessage: 'fail' });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // Apply a status filter
    const statusGroup = page.locator('.filter-group').filter({
      has: page.locator('label.filter-label', { hasText: 'Status' }),
    });
    await statusGroup.locator('select').selectOption('completed');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.log-row')).toHaveCount(1);

    // Click clear filters
    await page.locator('.btn-clear').click();
    await page.waitForLoadState('networkidle');

    // All logs shown again
    await expect(page.locator('.log-row')).toHaveCount(2);
    // Clear button hidden
    await expect(page.locator('.btn-clear')).not.toBeVisible();
    // Status select reset to empty
    await expect(statusGroup.locator('select')).toHaveValue('');
  });

  test('clear filters button is not visible when no filters are active', async ({ page }) => {
    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.btn-clear')).not.toBeVisible();
  });

  // ============================================================
  // 4. Sorting (3 tests)
  // ============================================================

  test('clicking a sortable column header shows a sort indicator', async ({ page }) => {
    await seedAgentCallLog(session.id, { agentType: 'claude-code' });
    await seedAgentCallLog(session.id, { agentType: 'other-agent' });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // Click "Agent Type" column (not the default sort column "Started")
    const agentTypeHeader = page.locator('th.th.sortable').filter({ hasText: 'Agent Type' });
    await agentTypeHeader.click();
    await page.waitForLoadState('networkidle');

    // Sort indicator should appear — first click on a new column defaults to DESC (↓)
    const sortIndicator = agentTypeHeader.locator('.sort-indicator');
    await expect(sortIndicator).toBeVisible();
    await expect(sortIndicator).toHaveText('↓');
  });

  test('clicking same column header twice toggles sort direction ASC/DESC', async ({ page }) => {
    await seedAgentCallLog(session.id);

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // "Started" is the default sort column, initially DESC
    const startedHeader = page.locator('th.th.sortable').filter({ hasText: 'Started' });
    const sortIndicator = startedHeader.locator('.sort-indicator');

    // Initial state: DESC → ↓
    await expect(sortIndicator).toBeVisible();
    await expect(sortIndicator).toHaveText('↓');

    // First click on already-active column: DESC → ASC → ↑
    await startedHeader.click();
    await page.waitForLoadState('networkidle');
    await expect(sortIndicator).toHaveText('↑');

    // Second click: ASC → DESC → ↓
    await startedHeader.click();
    await page.waitForLoadState('networkidle');
    await expect(sortIndicator).toHaveText('↓');
  });

  test('clicking a non-sortable column does not add a sort indicator', async ({ page }) => {
    await seedAgentCallLog(session.id);

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // The "Session" column is not sortable
    const sessionHeader = page.locator('th.th').filter({ hasText: 'Session' });
    await sessionHeader.click();

    // No sort indicator in "Session" header
    await expect(sessionHeader.locator('.sort-indicator')).not.toBeVisible();

    // Default sort on "Started" should remain unchanged
    const startedHeader = page.locator('th.th.sortable').filter({ hasText: 'Started' });
    await expect(startedHeader.locator('.sort-indicator')).toBeVisible();
  });

  // ============================================================
  // 5. Pagination (6 tests)
  // ============================================================

  async function seedManyLogs(sessionId: string, count: number) {
    // Use concurrent batched requests for speed
    const batchSize = 20;
    for (let i = 0; i < count; i += batchSize) {
      const batch = [];
      for (let j = i; j < Math.min(i + batchSize, count); j++) {
        batch.push(
          seedAgentCallLog(sessionId, {
            startedAt: Date.now() - j * 1000,
            agentType: 'claude-code',
          })
        );
      }
      await Promise.all(batch);
    }
  }

  test('pagination bar appears with data and shows correct page info', async ({ page }) => {
    test.setTimeout(90000);
    await seedManyLogs(session.id, 60);

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.pagination-bar')).toBeVisible();
    await expect(page.locator('.page-info')).toContainText('Showing 1\u201325 of 60 logs');
  });

  test('per-page selector changes the number of rows displayed', async ({ page }) => {
    test.setTimeout(90000);
    await seedManyLogs(session.id, 60);

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // Change per-page from 25 to 10
    await page.locator('.per-page-select').selectOption('10');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.page-info')).toContainText('Showing 1\u201310 of 60 logs');
    await expect(page.locator('.log-row')).toHaveCount(10);
  });

  test('next page button navigates to page 2', async ({ page }) => {
    test.setTimeout(90000);
    await seedManyLogs(session.id, 60);

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // Click next page button (›)
    await page.locator('.page-btn').filter({ hasText: '›' }).click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.page-info')).toContainText('Showing 26\u201350 of 60 logs');
  });

  test('previous and first page buttons are disabled on page 1', async ({ page }) => {
    test.setTimeout(90000);
    await seedManyLogs(session.id, 60);

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // « (first) and ‹ (previous) should be disabled on page 1
    await expect(page.locator('.page-btn').filter({ hasText: '«' })).toBeDisabled();
    await expect(page.locator('.page-btn').filter({ hasText: '‹' })).toBeDisabled();
  });

  test('clicking a specific page number button navigates to that page', async ({ page }) => {
    test.setTimeout(90000);
    await seedManyLogs(session.id, 60);

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // Click the "2" page button
    const page2Btn = page.locator('.page-buttons .page-btn').filter({ hasText: /^2$/ });
    await page2Btn.click();
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.page-info')).toContainText('Showing 26\u201350 of 60 logs');
    // Page 2 button should have the active class
    await expect(page2Btn).toHaveClass(/page-btn-active/);
  });

  test('pagination bar is hidden when there are no logs', async ({ page }) => {
    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.pagination-bar')).not.toBeVisible();
  });

  // ============================================================
  // 6. Error Handling (2 tests)
  // ============================================================

  test('shows error banner and retry button when API returns 500', async ({ page }) => {
    // Intercept only the main paginated endpoint (not filter-options)
    await page.route(/\/api\/agent-calls(\?.*)?$/, (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal server error' }),
      });
    });

    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.error-banner')).toBeVisible();
    await expect(page.locator('.btn-retry')).toBeVisible();
    await expect(page.locator('.btn-retry')).toHaveText('Retry');
  });

  test('retry button re-fetches data and clears the error banner', async ({ page }) => {
    let callCount = 0;

    // First call returns 500, subsequent calls pass through
    await page.route(/\/api\/agent-calls(\?.*)?$/, (route) => {
      callCount++;
      if (callCount === 1) {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporary failure' }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // Error banner should be visible after initial failure
    await expect(page.locator('.error-banner')).toBeVisible();

    // Click retry — second call passes through, data loads
    await page.locator('.btn-retry').click();
    await page.waitForLoadState('networkidle');

    // Error banner should disappear after successful retry
    await expect(page.locator('.error-banner')).not.toBeVisible();
  });

  // ============================================================
  // 7. Clear All Logs (3 tests)
  // ============================================================

  test('Clear All Logs button is always visible on the page', async ({ page }) => {
    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // Button should be visible even with no data
    await expect(page.locator('.btn-clear-all')).toBeVisible();
    await expect(page.locator('.btn-clear-all')).toHaveText('Clear All Logs');
  });

  test('clicking Clear All Logs shows confirmation state, auto-reverts after timeout', async ({ page }) => {
    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    const button = page.locator('.btn-clear-all');

    // First click: enter confirmation state
    await button.click();
    await expect(button).toHaveText('Confirm Clear All?');
    await expect(button).toHaveClass(/confirming/);

    // Wait for auto-revert (3 seconds + small buffer)
    await page.waitForTimeout(3500);

    // Should revert to default state
    await expect(button).toHaveText('Clear All Logs');
    await expect(button).not.toHaveClass(/confirming/);
  });

  test('confirming Clear All sends DELETE request and empties the table', async ({ page }) => {
    // Seed some logs
    await seedAgentCallLog(session.id, { agentType: 'claude-code' });
    await seedAgentCallLog(session.id, { agentType: 'other-agent' });
    await seedAgentCallLog(session.id, { agentType: 'claude-code' });

    await scopeLogsToSession(page, session.id);
    await page.goto('/settings/logs');
    await page.waitForLoadState('networkidle');

    // Verify logs are visible
    await expect(page.locator('.log-row')).toHaveCount(3);

    // Intercept DELETE /api/agent-calls to verify it's called and mock response
    let deleteCallCount = 0;
    await page.route('**/api/agent-calls', async (route, request) => {
      if (request.method() === 'DELETE') {
        deleteCallCount++;
        // Mock successful deletion
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, deleted: 3 }),
        });
      } else {
        // Continue other requests (GET, etc.)
        await route.continue();
      }
    });

    const button = page.locator('.btn-clear-all');

    // First click: enter confirmation
    await button.click();
    await expect(button).toHaveText('Confirm Clear All?');

    // Second click: confirm deletion (within 3 seconds)
    await button.click();

    // Wait for DELETE request and page update
    await page.waitForLoadState('networkidle');

    // Verify DELETE was called exactly once
    expect(deleteCallCount).toBe(1);

    // Verify table shows empty state
    await expect(page.locator('.empty-cell')).toBeVisible();
    await expect(page.locator('.empty-cell')).toHaveText('No agent call logs found.');
  });
});
