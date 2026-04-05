import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
} from './helpers';

test.describe('Debug: New Session Button', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSession: any;

  test.beforeEach(async () => {
    project = await seedProject('Debug Button Test', '/tmp/debug-button-test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);
    childSession = await seedChildSession(project.id, parentSession.id, {
      prompt: 'Child session prompt',
      name: 'Child Session',
    });
    await waitForSessionToExist(childSession.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('screenshot overlay and debug new session button', async ({ page }) => {
    const consoleErrors: string[] = [];
    const consoleWarnings: string[] = [];
    const resourceErrors: any[] = [];

    // Capture console messages and network errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
        console.log('CONSOLE ERROR:', msg.text());
      }
      if (msg.type() === 'warning') {
        consoleWarnings.push(msg.text());
        console.log('CONSOLE WARNING:', msg.text());
      }
    });

    // Capture failed resource requests
    page.on('requestfailed', (request) => {
      resourceErrors.push({
        url: request.url(),
        failure: request.failure()?.errorText,
      });
      console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText);
    });

    // Navigate to parent session
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    // Click tree handle to open overlay
    const handle = page.locator('[data-testid="session-chat-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
    console.log('Tree handle found and visible');
    await handle.click();
    console.log('Tree handle clicked');

    // Wait for overlay to be visible
    const overlay = page.locator('[data-testid="session-chat-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    console.log('Overlay is visible');
    await page.waitForTimeout(500); // Wait for animation

    // Get overlay bounding box
    const overlayBox = await overlay.boundingBox();
    console.log('Overlay bounding box:', overlayBox);

    // Locate the "New Session" button inside overlay
    const addBtn = overlay.locator('[data-testid="overlay-add-session-btn"]');
    await expect(addBtn).toBeVisible({ timeout: 5000 });
    const btnBox = await addBtn.boundingBox();
    console.log('Button bounding box:', btnBox);
    console.log('Button text:', await addBtn.textContent());

    // Take screenshot BEFORE clicking button (full page)
    await page.screenshot({
      path: 'screenshots/overlay-full-before.png',
      fullPage: true,
    });
    console.log('Full page screenshot taken: overlay-full-before.png');

    // Take screenshot of just the overlay area
    if (overlayBox) {
      const clip = {
        x: overlayBox.x,
        y: overlayBox.y,
        width: overlayBox.width,
        height: overlayBox.height,
      };
      await page.screenshot({
        path: 'screenshots/overlay-zoomed-before.png',
        clip,
      });
      console.log('Zoomed overlay screenshot taken: overlay-zoomed-before.png');
    }

    // Click the button
    console.log('Clicking New Session button...');
    await addBtn.click();
    console.log('New Session button clicked');

    // Wait a moment for the action to complete
    await page.waitForTimeout(1000);

    // Take screenshot AFTER clicking button (full page)
    await page.screenshot({
      path: 'screenshots/overlay-full-after.png',
      fullPage: true,
    });
    console.log('Full page screenshot taken: overlay-full-after.png');

    // Check if overlay still exists
    try {
      await expect(overlay).toBeVisible({ timeout: 2000 });
      console.log('Overlay still visible after click');
      const overlayBoxAfter = await overlay.boundingBox();
      if (overlayBoxAfter) {
        const clip = {
          x: overlayBoxAfter.x,
          y: overlayBoxAfter.y,
          width: overlayBoxAfter.width,
          height: overlayBoxAfter.height,
        };
        await page.screenshot({
          path: 'screenshots/overlay-zoomed-after.png',
          clip,
        });
        console.log('Zoomed overlay screenshot taken: overlay-zoomed-after.png');
      }
    } catch {
      console.log('Overlay not visible after click (may have closed)');
    }

    // Check that the session detail page switched to "New Session"
    const pageTitle = page.locator('[data-testid="session-name"]');
    try {
      await expect(pageTitle).toHaveText('New Session', { timeout: 5000 });
      console.log('Page successfully switched to New Session');
    } catch (e) {
      console.log('Failed to confirm page switched to New Session');
    }

    // Report resource and console errors
    console.log('\n=== NETWORK ERRORS ===');
    console.log('Failed resources:', resourceErrors.length > 0 ? resourceErrors : 'None');
    console.log('\n=== CONSOLE MESSAGES ===');
    console.log('Console errors:', consoleErrors.length > 0 ? consoleErrors : 'None');
    console.log('Console warnings:', consoleWarnings.length > 0 ? consoleWarnings : 'None');
  });
});
