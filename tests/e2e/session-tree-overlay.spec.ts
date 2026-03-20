import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForSessionToExist,
} from './helpers';

test.describe('Session Tree Overlay', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSession: any;

  test.beforeEach(async () => {
    project = await seedProject('Tree Overlay Test', '/tmp/tree-overlay-test');
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

  test('shows tree handle on parent session detail page', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    const handle = page.locator('[data-testid="session-tree-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
  });

  test('shows tree handle on child session detail page', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${childSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    const handle = page.locator('[data-testid="session-tree-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });
  });

  test('opens overlay when clicking the tree handle', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    const handle = page.locator('[data-testid="session-tree-handle"]');
    await expect(handle).toBeVisible({ timeout: 10000 });

    await handle.click();
    const overlay = page.locator('[data-testid="session-tree-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
  });

  test('overlay displays root session name', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    await page.locator('[data-testid="session-tree-handle"]').click();
    const overlay = page.locator('[data-testid="session-tree-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    const rootName = overlay.locator('.overlay-root-name');
    await expect(rootName).toContainText('Parent Session');
  });

  test('overlay displays close button and closes on click', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    await page.locator('[data-testid="session-tree-handle"]').click();
    const overlay = page.locator('[data-testid="session-tree-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    const closeBtn = page.locator('[data-testid="session-tree-close"]');
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    await expect(overlay).not.toBeVisible({ timeout: 5000 });
  });

  test('overlay closes on Escape key', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    await page.locator('[data-testid="session-tree-handle"]').click();
    const overlay = page.locator('[data-testid="session-tree-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    await page.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible({ timeout: 5000 });
  });

  test('overlay shows dropdown when session has children', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${parentSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    await page.locator('[data-testid="session-tree-handle"]').click();
    const overlay = page.locator('[data-testid="session-tree-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Dropdown should appear after session chain is built
    const dropdown = overlay.locator('[data-testid="session-tree-dropdown"]');
    await expect(dropdown).toBeVisible({ timeout: 10000 });
  });

  test('does not show tree handle for session without parent or children', async ({ page }) => {
    // Create a standalone session (no parent, no children)
    const standaloneSession = await seedSession(project.id, {
      prompt: 'Standalone prompt',
      name: 'Standalone Session',
    });
    await waitForSessionToExist(standaloneSession.id);

    await navigateAndWait(page, `/sessions/${standaloneSession.id}`, {
      waitFor: '.session-detail',
      timeout: 15000,
    });

    const handle = page.locator('[data-testid="session-tree-handle"]');
    // Should not be visible for standalone sessions
    await expect(handle).not.toBeVisible({ timeout: 5000 });
  });
});
