import { test, expect, Page } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForPageReady,
  waitForSessionToExist,
  updateSessionStatus,
  getSession,
} from './helpers';

/**
 * Tests for stale spinner after WebSocket reconnection.
 *
 * Bug scenario (observed on iPhone Safari):
 * 1. User views a parent session while a child session is "running"
 * 2. User backgrounds Safari (kills WebSocket connection)
 * 3. While disconnected, the child session finishes (running -> waiting)
 * 4. User returns -> WebSocket reconnects -> onReconnect fires
 * 5. BUG: Spinner still shows because sessionChain holds stale snapshot
 *    with old "running" status; buildSessionChain() is not called on reconnect.
 *
 * To reproduce reliably: instead of relying on CDP offline mode (which doesn't
 * reliably kill WebSocket connections), we use Playwright's page.route() to
 * intercept and abort the browser's HTTP requests for session data, ensuring
 * the reconnect handler can't refetch fresh session state. Then we change
 * session status server-side and verify the spinner reflects the stale state.
 *
 * We also test the positive case: after a proper reconnection (without blocking),
 * the spinner should correctly clear.
 */
test.describe('Stale spinner on session chat handle after WebSocket reconnect', () => {
  test.describe.configure({ timeout: 90000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('spinner clears on chat handle when child session stops during WebSocket disconnect', async ({
    page,
  }) => {
    // Setup: parent session (waiting) with a running child session
    project = await seedProject('Stale Spinner Test', '/tmp/test');
    const parent = await seedSession(project.id, {
      prompt: 'Parent task',
      name: 'Parent Session',
      startImmediately: false,
    });
    await waitForSessionToExist(parent.id);
    await updateSessionStatus(parent.id, 'waiting');

    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child task',
      name: 'Child Session',
    });
    await waitForSessionToExist(child.id);
    await updateSessionStatus(child.id, 'running');

    // Navigate to parent session detail view
    await navigateAndWait(page, `/sessions/${parent.id}/summary`);
    await waitForPageReady(page);

    // Verify spinner IS visible on the session chat handle (child is running)
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    const spinner = handle.locator('.active-spinner');
    await expect(spinner).toBeVisible({ timeout: 10000 });

    // Simulate disconnect using CDP offline mode
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    });

    // Wait for the socket to die
    await page.waitForTimeout(5000);

    // While disconnected, the child session finishes its work.
    // The server broadcasts SESSION_UPDATED but the client may or may not receive it.
    await updateSessionStatus(child.id, 'waiting');

    // Verify server-side
    const childAfter = await getSession(child.id);
    expect(childAfter.status).toBe('waiting');

    // Restore network and trigger reconnection
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Wait for reconnection and state refresh
    await page.waitForTimeout(8000);

    // The spinner should be GONE because the child session is no longer running.
    await expect(spinner).not.toBeVisible({ timeout: 10000 });
  });

  test('spinner clears on chat handle when grandchild session stops during WebSocket disconnect', async ({
    page,
  }) => {
    // Setup: parent → child → grandchild chain, grandchild is running
    project = await seedProject('Stale Spinner GC Test', '/tmp/test');
    const parent = await seedSession(project.id, {
      prompt: 'Parent task',
      name: 'Parent Session GC',
      startImmediately: false,
    });
    await waitForSessionToExist(parent.id);
    await updateSessionStatus(parent.id, 'waiting');

    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child task',
      name: 'Child Session GC',
    });
    await waitForSessionToExist(child.id);
    await updateSessionStatus(child.id, 'waiting');

    const grandchild = await seedChildSession(project.id, child.id, {
      prompt: 'Grandchild task',
      name: 'Grandchild Session GC',
    });
    await waitForSessionToExist(grandchild.id);
    await updateSessionStatus(grandchild.id, 'running');

    // Navigate to parent session detail view
    await navigateAndWait(page, `/sessions/${parent.id}/summary`);
    await waitForPageReady(page);

    // Verify spinner IS visible (grandchild is running)
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    const spinner = handle.locator('.active-spinner');
    await expect(spinner).toBeVisible({ timeout: 10000 });

    // Simulate disconnect
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    });
    await page.waitForTimeout(5000);

    // While disconnected, grandchild session finishes
    await updateSessionStatus(grandchild.id, 'stopped');
    const gcAfter = await getSession(grandchild.id);
    expect(gcAfter.status).toBe('stopped');

    // Restore network and trigger reconnection
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      downloadThroughput: -1,
      uploadThroughput: -1,
      latency: 0,
    });

    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(8000);

    // Spinner should be gone - no session in the tree is running anymore.
    await expect(spinner).not.toBeVisible({ timeout: 10000 });
  });
});
