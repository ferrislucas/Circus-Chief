import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedUserMessage,
  seedAssistantMessage,
  cleanupCreatedResources,
  navigateAndWait,
  waitForPageReady,
  waitForSessionToExist,
  updateSessionStatus,
} from './helpers';

test.describe('WebSocket wake-from-sleep recovery', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('session detail recovers data after wake-from-sleep without error toast', async ({ page }) => {
    // Setup: seed project, session, and messages
    project = await seedProject('Recovery Test', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
    await waitForSessionToExist(session.id);
    await updateSessionStatus(session.id, 'running');
    await seedUserMessage(session.id, 'hello');
    await seedAssistantMessage(session.id, 'hi there');

    // Navigate to session detail (conversation tab for messages)
    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await waitForPageReady(page);

    // Verify initial data is visible
    await expect(page.locator('text=hello').first()).toBeVisible({ timeout: 10000 });

    // Simulate sleep: kill network via CDP to create zombie socket
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    });
    await page.waitForTimeout(3000); // Let the socket die

    // Simulate wake: restore network and trigger visibilitychange
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

    // Wait for reconnection to settle
    await page.waitForTimeout(3000);

    // Seed a new message after wake - this verifies data recovery works
    // because new messages will only appear if the session is properly subscribed
    await seedAssistantMessage(session.id, 'message-after-wake');

    // Verify: new message appears (proves WebSocket subscription recovered)
    await expect(page.locator('text=message-after-wake')).toBeVisible({ timeout: 15000 });

    // Verify: original conversation content still visible
    await expect(page.locator('text=hello').first()).toBeVisible({ timeout: 10000 });

    // Verify: no error toast
    await expect(page.locator('.toast.toast-error')).not.toBeVisible();
  });

  test('session detail receives new WebSocket messages after reconnect', async ({ page }) => {
    // Setup
    project = await seedProject('Reconnect Msg Test', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'test reconnect', startImmediately: false });
    await waitForSessionToExist(session.id);
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await waitForPageReady(page);

    // Simulate sleep
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    });
    await page.waitForTimeout(3000);

    // Simulate wake
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

    // Wait for reconnection to settle
    await page.waitForTimeout(3000);

    // Push a new message via API after reconnect
    await seedAssistantMessage(session.id, 'message-after-reconnect');

    // Verify it appears in the UI via WebSocket
    await expect(page.locator('text=message-after-reconnect')).toBeVisible({ timeout: 10000 });
  });

  test('session list recovers project subscription after sleep', async ({ page }) => {
    // Setup - start with 'waiting' status (no running badge visible)
    project = await seedProject('Project Sub Test', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'test project sub', startImmediately: false });
    await waitForSessionToExist(session.id);
    await updateSessionStatus(session.id, 'waiting');

    // Navigate to session list
    await navigateAndWait(page, `/projects/${project.id}/sessions`);
    await waitForPageReady(page);

    // Verify no "running" badge is visible initially
    await expect(page.locator('.status-running')).not.toBeVisible();

    // Simulate sleep
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      downloadThroughput: 0,
      uploadThroughput: 0,
      latency: 0,
    });
    await page.waitForTimeout(3000);

    // Simulate wake
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

    // Wait for reconnection to settle
    await page.waitForTimeout(3000);

    // Update session status to 'running' via API - should arrive via WebSocket
    // SessionCard shows a "running" badge for sessions with running status
    await updateSessionStatus(session.id, 'running');

    // Verify the running status badge appears in the session list
    await expect(page.locator('.status-running').first()).toBeVisible({ timeout: 15000 });
  });

  test('no-op when waking with healthy WebSocket connection', async ({ page }) => {
    // Setup
    project = await seedProject('Healthy Socket Test', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'test healthy', startImmediately: false });
    await waitForSessionToExist(session.id);
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await waitForPageReady(page);

    // Wait for everything to settle
    await page.waitForTimeout(2000);

    // Track unexpected fetches
    let unexpectedFetch = false;
    page.on('response', (r) => {
      if (r.url().includes(`/api/sessions/${session.id}/messages`)) {
        unexpectedFetch = true;
      }
    });

    // Dispatch visibilitychange WITHOUT killing network first
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', {
        value: 'visible',
        configurable: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(2000);

    // No extra REST calls should have been made (socket was healthy)
    expect(unexpectedFetch).toBe(false);
  });

  test('multiple sleep/wake cycles don\'t cause duplicate subscriptions or stale data', async ({
    page,
  }) => {
    // Setup
    project = await seedProject('Multi Cycle Test', '/tmp/test');
    session = await seedSession(project.id, { prompt: 'test cycles', startImmediately: false });
    await waitForSessionToExist(session.id);
    await updateSessionStatus(session.id, 'running');

    await navigateAndWait(page, `/sessions/${session.id}/conversation`);
    await waitForPageReady(page);

    const cdp = await page.context().newCDPSession(page);

    // Run 3 sleep/wake cycles
    for (let i = 0; i < 3; i++) {
      await cdp.send('Network.emulateNetworkConditions', {
        offline: true,
        downloadThroughput: 0,
        uploadThroughput: 0,
        latency: 0,
      });
      await page.waitForTimeout(2000);

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

      await page.waitForTimeout(2000);
    }

    // After the 3rd cycle, seed a message and verify it appears exactly once
    await seedAssistantMessage(session.id, 'after-three-cycles');
    await expect(page.locator('text=after-three-cycles')).toBeVisible({ timeout: 10000 });
    // Verify only ONE instance (no duplicates from multiple subscriptions)
    await expect(page.locator('text=after-three-cycles')).toHaveCount(1);

    // Also verify no error toast appeared during any cycle
    await expect(page.locator('.toast.toast-error')).not.toBeVisible();
  });
});
