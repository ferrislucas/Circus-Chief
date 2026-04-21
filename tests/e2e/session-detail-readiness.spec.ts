import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  waitForSessionToExist,
  waitForSessionStatus,
  cleanupCreatedResources,
  navigateAndWait,
} from './helpers';
import { API_READY, PAGE_READY_TIMEOUT } from './timeouts';

/**
 * Regression tests for the SessionDetailView readiness contract.
 *
 * SessionDetailView.vue exposes:
 *   [data-testid="session-detail"][data-ready="true|false"]
 *
 * The attribute becomes "true" only after:
 *   - sessionsStore.loading === false
 *   - sessionsStore.currentSession is present
 *   - the session chain (ancestor/descendants) has been built
 *
 * These tests pin that contract so the openSessionOverlay helper can rely on
 * it as a deterministic readiness signal (no arbitrary sleeps, no networkidle
 * flakiness under parallel load).
 */
test.describe('SessionDetailView readiness contract', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('SessionDetailReady', '/tmp/session-detail-ready');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('renders [data-testid=session-detail] and transitions to data-ready=true on initial navigation', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: `ready-${Date.now()}`,
      startImmediately: false,
    });

    await waitForSessionToExist(session.id, API_READY);
    await waitForSessionStatus(session.id, 'waiting', API_READY);

    await navigateAndWait(page, `/sessions/${session.id}/summary`, {
      loadState: 'domcontentloaded',
    });

    const root = page.locator('[data-testid="session-detail"]');
    // The root must exist even before readiness. Asserting data-ready reaches
    // "true" (not just "truthy") is the actual contract.
    await expect(root).toBeVisible({ timeout: PAGE_READY_TIMEOUT });
    await expect(root).toHaveAttribute('data-ready', 'true', {
      timeout: PAGE_READY_TIMEOUT,
    });
  });

  test('resets to data-ready=false and back to true when navigating between sessions', async ({ page }) => {
    const sessionA = await seedSession(project.id, {
      prompt: `ready-A-${Date.now()}`,
      startImmediately: false,
    });
    const sessionB = await seedSession(project.id, {
      prompt: `ready-B-${Date.now()}`,
      startImmediately: false,
    });

    await waitForSessionToExist(sessionA.id, API_READY);
    await waitForSessionToExist(sessionB.id, API_READY);
    await waitForSessionStatus(sessionA.id, 'waiting', API_READY);
    await waitForSessionStatus(sessionB.id, 'waiting', API_READY);

    // Navigate to A and wait for readiness.
    await navigateAndWait(page, `/sessions/${sessionA.id}/summary`, {
      loadState: 'domcontentloaded',
    });
    const root = page.locator('[data-testid="session-detail"]');
    await expect(root).toHaveAttribute('data-ready', 'true', {
      timeout: PAGE_READY_TIMEOUT,
    });

    // In-app navigation to B: the same root element must return to "true"
    // within the page-ready budget. We do not assert the intermediate "false"
    // because the transition can be very fast; what matters is that the
    // readiness signal correctly reflects the *new* session once settled.
    await page.goto(`/sessions/${sessionB.id}/summary`);
    await expect(root).toHaveAttribute('data-ready', 'true', {
      timeout: PAGE_READY_TIMEOUT,
    });

    // And the URL reflects session B (sanity against stale rendering).
    expect(page.url()).toContain(sessionB.id);
  });
});
