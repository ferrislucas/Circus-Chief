import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedQuickResponse,
  cleanupCreatedResources,
  waitForPageReady,
  openSessionOverlay,
} from './helpers';

/**
 * E2E tests for quick response focus/blur behavior
 *
 * These tests verify that:
 * - Non-auto-submit responses blur the textarea (no mobile keyboard)
 * - Auto-submit responses still submit the form correctly
 * - Content is inserted correctly in both cases
 */

test.beforeEach(async () => {
  await cleanupCreatedResources();
});

test.afterEach(async () => {
  await cleanupCreatedResources();
});

test.describe('Quick Response Focus Behavior', () => {
  test('non-auto-submit response blurs textarea in new session view', async ({ page }) => {
    const project = await seedProject('QR Focus NewSession', '/tmp/qr-focus-new');
    await seedQuickResponse(project.id, {
      label: 'No Auto',
      content: 'Content without auto-submit',
      autoSubmit: false,
    });

    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    // Expand quick responses panel
    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible();
    await panel.click();
    await page.waitForTimeout(300);

    // Click the quick response
    await page.locator('.response-button', { hasText: 'No Auto' }).click();

    // Verify content was inserted
    const textarea = page.locator('textarea#prompt');
    await expect(textarea).toHaveValue('Content without auto-submit');

    // Verify textarea is NOT focused using document.activeElement
    const activeTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeTag).not.toBe('TEXTAREA');

    // Verify panel collapsed
    await expect(page.locator('.responses-content')).not.toBeVisible();
  });

  test('non-auto-submit response blurs textarea in conversation view', async ({ page }) => {
    const project = await seedProject('QR Focus Conversation', '/tmp/qr-focus-conv');
    await seedQuickResponse(project.id, {
      label: 'No Auto Conv',
      content: 'Conversation content',
      autoSubmit: false,
    });

    const session = await seedSession(project.id, {
      prompt: 'Initial',
      startImmediately: false,
    });

    // Set up the quick-responses API response listener BEFORE navigating
    const apiDone = page.waitForResponse(
      (resp) => resp.url().includes('/quick-responses') && resp.status() === 200,
      { timeout: 30000 }
    );

    await page.goto(`/sessions/${session.id}/summary`);
    await openSessionOverlay(page);

    // Wait for the quick-responses API call to complete
    await apiDone;

    // Wait for the panel to render
    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible({ timeout: 10000 });
    await panel.click();
    await page.waitForTimeout(300);

    // Click the quick response
    await page.locator('.response-button', { hasText: 'No Auto Conv' }).click();

    // Verify content was inserted
    const textarea = page.locator('textarea').first();
    await expect(textarea).toHaveValue(/Conversation content/);

    // Verify textarea is NOT focused
    const activeTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeTag).not.toBe('TEXTAREA');

    // Verify panel collapsed
    await expect(page.locator('.responses-content')).not.toBeVisible();
  });

  test('auto-submit response still submits form in new session view', async ({ page }) => {
    const project = await seedProject('QR Focus AutoSubmit', '/tmp/qr-focus-auto');
    await seedQuickResponse(project.id, {
      label: 'Auto Submit',
      content: 'Auto-submit content',
      autoSubmit: true,
    });

    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    // Expand quick responses panel
    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible();
    await panel.click();
    await page.waitForTimeout(300);

    // Click the auto-submit quick response
    await page.locator('.response-button', { hasText: 'Auto Submit' }).click();

    // Verify form submission by checking we navigated away from new session view
    await expect(page).not.toHaveURL(/\/sessions\/new/, { timeout: 10000 });
    await expect(page).toHaveURL(/\/sessions\/[a-f0-9-]+$/);
  });

  test('mobile viewport - non-auto-submit blurs textarea', async ({ page }) => {
    const project = await seedProject('QR Focus Mobile', '/tmp/qr-focus-mobile');
    await seedQuickResponse(project.id, {
      label: 'Mobile Test',
      content: 'Mobile content',
      autoSubmit: false,
    });

    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    // Expand quick responses panel
    const panel = page.locator('.quick-responses-panel');
    await expect(panel).toBeVisible();
    await panel.click();
    await page.waitForTimeout(300);

    // Click the quick response
    await page.locator('.response-button', { hasText: 'Mobile Test' }).click();

    // Verify content was inserted
    const textarea = page.locator('textarea#prompt');
    await expect(textarea).toHaveValue('Mobile content');

    // Verify textarea is NOT focused (this implies keyboard won't appear)
    const activeTag = await page.evaluate(() => document.activeElement?.tagName);
    expect(activeTag).not.toBe('TEXTAREA');
  });
});
