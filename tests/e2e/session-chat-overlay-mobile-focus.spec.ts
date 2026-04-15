import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  updateSessionStatus,
  seedConversationHistory,
  waitForSessionToExist,
  cleanupCreatedResources,
  navigateAndWait,
} from './helpers';

let project: any;
let parentSession: any;
let childSession: any;

async function openOverlay(page: any, sessionId: string) {
  await navigateAndWait(page, `/sessions/${sessionId}`, {
    waitFor: '.session-detail',
    timeout: 15000,
  });
  const handle = page.locator('[data-testid="session-chat-handle"]');
  await expect(handle).toBeVisible({ timeout: 10000 });
  await handle.click();
  const overlay = page.locator('[data-testid="session-chat-overlay"]');
  await expect(overlay).toBeVisible({ timeout: 5000 });
  await page.waitForTimeout(400); // Wait for slide-in animation
  return overlay;
}

test.describe('Session Chat Overlay - Mobile Focus Behavior', () => {
  test.beforeEach(async () => {
    project = await seedProject('Mobile Focus Test', '/tmp/mobile-focus-test');
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

  test('header collapses to compact mode when textarea is focused on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await updateSessionStatus(parentSession.id, 'waiting');
    const overlay = await openOverlay(page, parentSession.id);

    // Verify header rows are visible before focus
    await expect(overlay.locator('.overlay-header-actions')).toBeVisible();
    await expect(overlay.locator('.overlay-header-selector')).toBeVisible();

    // Focus the textarea
    const textarea = overlay.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();

    // Verify compact mode is applied
    await expect(overlay.locator('.overlay-header.header-compact')).toBeVisible({ timeout: 3000 });

    // Verify hidden rows
    await expect(overlay.locator('.overlay-header-actions')).not.toBeVisible();
    await expect(overlay.locator('.overlay-header-selector')).not.toBeVisible();

    // Session name should still be visible
    await expect(overlay.locator('.overlay-root-name')).toBeVisible();
  });

  test('header re-expands when textarea loses focus on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await updateSessionStatus(parentSession.id, 'waiting');
    const overlay = await openOverlay(page, parentSession.id);

    // Focus then blur the textarea
    const textarea = overlay.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();
    await expect(overlay.locator('.overlay-header.header-compact')).toBeVisible({ timeout: 3000 });

    await textarea.blur();
    // Wait for requestAnimationFrame to fire
    await page.waitForTimeout(100);

    // Header should be back to full size
    await expect(overlay.locator('.overlay-header.header-compact')).not.toBeVisible({ timeout: 3000 });
    await expect(overlay.locator('.overlay-header-actions')).toBeVisible();
  });

  test('header does not collapse on desktop when textarea is focused', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await updateSessionStatus(parentSession.id, 'waiting');
    const overlay = await openOverlay(page, parentSession.id);

    const textarea = overlay.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();

    // Should NOT collapse — isMobile is false at 1280px
    await expect(overlay.locator('.overlay-header.header-compact')).not.toBeVisible();
    await expect(overlay.locator('.overlay-header-actions')).toBeVisible();
    await expect(overlay.locator('.overlay-header-selector')).toBeVisible();
  });

  test('textarea remains visible within viewport after focus on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    // Seed enough messages to force scroll, then set status to waiting so textarea appears
    await seedConversationHistory(parentSession.id, 20);
    await updateSessionStatus(parentSession.id, 'waiting');
    const overlay = await openOverlay(page, parentSession.id);

    const textarea = overlay.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();
    await page.waitForTimeout(500); // Allow scroll + header collapse animation

    const box = await textarea.boundingBox();
    expect(box).not.toBeNull();
    // Textarea should be within the viewport (CSS pixel coordinates relative to viewport)
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(667);
  });

  test('header does not collapse while editing session name on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await updateSessionStatus(parentSession.id, 'waiting');
    const overlay = await openOverlay(page, parentSession.id);

    // Start editing the session name
    const editTrigger = overlay.locator('.name-edit-trigger');
    await expect(editTrigger).toBeVisible({ timeout: 3000 });
    await editTrigger.click();
    await expect(overlay.locator('.name-edit-input')).toBeVisible({ timeout: 3000 });

    // Now focus the prompt textarea (user tabs down or taps it)
    const textarea = overlay.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();

    // Header should NOT collapse because isEditingName is true
    await expect(overlay.locator('.overlay-header.header-compact')).not.toBeVisible();
  });
});
