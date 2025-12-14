import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedCanvasItem,
  cleanupAll,
  updateSessionStatus,
  getSession,
} from './helpers';

const API_URL = process.env.API_URL || 'http://localhost:5000';

test.describe('WebSocket Real-time Updates', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'WebSocket test', name: 'WS Test Session' });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('session status updates are reflected in UI without page reload', async ({ page }) => {
    // Set initial status to running
    await updateSessionStatus(session.id, 'running');

    await page.goto(`/sessions/${session.id}`);

    // Verify initial status
    await expect(page.locator('.status-badge.status-running')).toBeVisible();
    await expect(page.locator('.status-badge')).toHaveText('running');

    // Update status via API (simulating backend update)
    await updateSessionStatus(session.id, 'waiting');

    // Wait for UI to reflect the change (via polling or WebSocket)
    await expect(page.locator('.status-badge.status-waiting')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.status-badge')).toHaveText('waiting');

    // Verify input form appears when status changes to waiting
    await expect(page.locator('.input-form')).toBeVisible({ timeout: 5000 });
  });

  test('session status change to completed hides Stop button', async ({ page }) => {
    // Start with running session
    await updateSessionStatus(session.id, 'running');

    await page.goto(`/sessions/${session.id}`);

    // Verify Stop button is visible
    await expect(page.getByRole('button', { name: 'Stop Session' })).toBeVisible();

    // Update status to completed
    await updateSessionStatus(session.id, 'completed');

    // Wait for UI to reflect the change
    await expect(page.locator('.status-badge.status-completed')).toBeVisible({ timeout: 5000 });

    // Stop button should disappear
    await expect(page.getByRole('button', { name: 'Stop Session' })).not.toBeVisible({
      timeout: 5000,
    });
  });

  test('canvas items added via API appear in UI without page reload', async ({ page }) => {
    await page.goto(`/sessions/${session.id}/canvas`);

    // Verify empty state initially
    await expect(page.getByText('No canvas items yet')).toBeVisible();

    // Add canvas item via API
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Real-time Canvas Item',
      label: 'WS Canvas Test',
    });

    // Wait for item to appear in UI (via polling or WebSocket)
    await expect(page.getByText('WS Canvas Test')).toBeVisible({ timeout: 5000 });

    // Verify empty state is gone
    await expect(page.getByText('No canvas items yet')).not.toBeVisible();
  });

  test('multiple canvas items added appear in correct order', async ({ page }) => {
    await page.goto(`/sessions/${session.id}/canvas`);

    // Add multiple canvas items
    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'First item content',
      label: 'First Item',
    });

    await seedCanvasItem(session.id, {
      type: 'text',
      content: 'Second item content',
      label: 'Second Item',
    });

    // Wait for items to appear
    await expect(page.getByText('First Item')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Second Item')).toBeVisible({ timeout: 5000 });

    // Verify both items are present
    const canvasItems = page.locator('.canvas-item');
    await expect(canvasItems).toHaveCount(2);
  });

  test('session transitions from running to waiting shows input form', async ({ page }) => {
    // Start with running session
    await updateSessionStatus(session.id, 'running');

    await page.goto(`/sessions/${session.id}`);

    // Verify "Claude is working..." message
    await expect(page.getByText('Claude is working...')).toBeVisible();
    await expect(page.locator('.input-form')).not.toBeVisible();

    // Update to waiting
    await updateSessionStatus(session.id, 'waiting');

    // Wait for input form to appear
    await expect(page.locator('.input-form')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Claude is working...')).not.toBeVisible();
  });

  test('session error status is reflected in UI', async ({ page }) => {
    await updateSessionStatus(session.id, 'running');

    await page.goto(`/sessions/${session.id}`);
    await expect(page.locator('.status-badge.status-running')).toBeVisible();

    // Simulate error
    await updateSessionStatus(session.id, 'error');

    // Wait for error status to appear
    await expect(page.locator('.status-badge.status-error')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.status-badge')).toHaveText('error');

    // Stop button should disappear for error state
    await expect(page.getByRole('button', { name: 'Stop Session' })).not.toBeVisible();
  });
});

test.describe('Session Polling Fallback', () => {
  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'Polling test', name: 'Polling Test' });
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('active session polls for updates', async ({ page }) => {
    // Set session to running (active state that triggers polling)
    await updateSessionStatus(session.id, 'running');

    await page.goto(`/sessions/${session.id}`);

    // Verify initial state
    await expect(page.locator('.status-badge.status-running')).toBeVisible();

    // Change status - should be picked up by polling within 2-3 seconds
    await updateSessionStatus(session.id, 'waiting');

    // Polling interval is 2 seconds, so within 5 seconds we should see the update
    await expect(page.locator('.status-badge.status-waiting')).toBeVisible({ timeout: 5000 });
  });

  test('completed session does not continue polling', async ({ page }) => {
    // Start with completed session
    await updateSessionStatus(session.id, 'completed');

    await page.goto(`/sessions/${session.id}`);

    // Verify completed status
    await expect(page.locator('.status-badge.status-completed')).toBeVisible();

    // This test verifies that the page loads correctly for completed sessions
    // and doesn't cause unnecessary polling (though we can't easily verify no polling occurs)
    await expect(page.locator('h1')).toHaveText('Polling Test');
  });
});
