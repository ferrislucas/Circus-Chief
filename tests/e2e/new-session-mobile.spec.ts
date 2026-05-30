import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupAll,
  waitForPageReady,
} from './helpers';

const MOBILE_VIEWPORT = { width: 375, height: 812 };
const DESKTOP_VIEWPORT = { width: 1280, height: 800 };

test.describe('New Session View — Mobile Responsiveness', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    // Use the actual repo path so git status detection works for git-related tests
    project = await seedProject('Mobile Test Project', process.cwd());
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('new session form goes edge-to-edge on mobile viewport', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    const card = page.locator('.form.card');
    await expect(card).toBeVisible({ timeout: 10000 });

    const styles = await card.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        borderLeft: computed.borderLeftWidth,
        borderRight: computed.borderRightWidth,
        borderRadius: computed.borderRadius,
      };
    });

    // At 375px width, the card should have no side borders and no border-radius
    expect(styles.borderLeft).toBe('0px');
    expect(styles.borderRight).toBe('0px');
    expect(styles.borderRadius).toBe('0px');
  });

  test('options row uses 2-column grid on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    const optionsRow = page.locator('.options-row');
    await expect(optionsRow).toBeVisible({ timeout: 10000 });

    const gridTemplateColumns = await optionsRow.evaluate((el) => {
      return window.getComputedStyle(el).gridTemplateColumns;
    });

    // At 375px width, the options row should be a 2-column grid.
    // getComputedStyle returns resolved pixel values, e.g. "180px 180px".
    // Verify it resolves to two equal columns (not a single column or auto).
    const columns = gridTemplateColumns.trim().split(/\s+/);
    expect(columns).toHaveLength(2);
    expect(columns[0]).toBe(columns[1]); // both columns are equal width
  });

  test('GitOptionsPanel shows abbreviated WT label on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    // Wait for git detection to complete (the segmented control appears for git repos)
    const segmentedControl = page.locator('.segmented-control');
    await expect(segmentedControl).toBeVisible({ timeout: 15000 });

    const fullLabel = page.locator('.segment-label-full').first();
    const shortLabel = page.locator('.segment-label-short').first();

    await expect(fullLabel).toBeHidden();
    await expect(shortLabel).toBeVisible();
    await expect(shortLabel).toHaveText('WT');
  });

  test('form renders normally at desktop width', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto(`/projects/${project.id}/sessions/new`);
    await waitForPageReady(page);

    const card = page.locator('.form.card');
    await expect(card).toBeVisible({ timeout: 10000 });

    const borderRadius = await card.evaluate((el) => {
      return window.getComputedStyle(el).borderRadius;
    });

    // At 1280px width, the card should retain its border-radius
    expect(borderRadius).not.toBe('0px');

    // At desktop width, the full "Worktree" label should be visible
    const segmentedControl = page.locator('.segmented-control');
    const isGitRepo = await segmentedControl.isVisible({ timeout: 5000 }).catch(() => false);

    if (isGitRepo) {
      const fullLabel = page.locator('.segment-label-full').first();
      await expect(fullLabel).toBeVisible();
    }
  });
});
