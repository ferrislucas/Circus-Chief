import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  navigateAndWait,
  seedKanbanCard,
  seedKanbanLane,
  seedProject,
  seedSession,
} from './helpers';

const IPHONE_12_MINI = { width: 375, height: 812 };

interface Box { x: number; y: number; width: number; height: number }

/**
 * Overlapping area of two bounding boxes in px². 0 when the boxes are
 * disjoint — used to prove hit areas and content never share pixels.
 */
function overlapArea(a: Box, b: Box): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, width) * Math.max(0, height);
}

test.describe('Kanban card actions and lane header controls — 375×812', () => {
  // Regression coverage for two review findings:
  //  1. The mobile/coarse-pointer Move and Remove card controls had 44px hit
  //     areas that overlapped by 20px; Remove (later in the DOM) won the
  //     shared region, so part of the apparent Move target destructively
  //     removed the card. The card also had no space reserved for the
  //     always-visible action strip.
  //  2. The lane header was a role="button" wrapper around the Lane settings
  //     <button>; Enter bubbled into the header's toggle handler and the
  //     prevented Space keydown suppressed the settings button's native
  //     activation.
  let project: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('Kanban action strip audit project', process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Exercise the mobile kanban card action strip.',
      name: 'A long workspace name to pressure the compact card action strip',
      startImmediately: false,
    });
    const lane = await seedKanbanLane(project.id, { name: 'Action strip lane' });
    await seedKanbanCard(project.id, { sessionId: session.id, laneId: lane.id });
    await page.setViewportSize(IPHONE_12_MINI);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('card Move and Remove hit areas stay distinct and clear of card content', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board', timeout: 15000 });

    const card = page.locator('.kanban-card').first();
    await expect(card).toBeVisible();

    const move = (await card.locator('.card-move-btn').boundingBox()) as Box;
    const remove = (await card.locator('.card-remove-btn').boundingBox()) as Box;
    expect(move).not.toBeNull();
    expect(remove).not.toBeNull();

    // Touch targets keep the 44px minimum.
    for (const box of [move, remove]) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    // The destructive control shares no pixels with the move control.
    expect(overlapArea(move, remove)).toBe(0);

    // Card content does not render beneath the always-visible action strip.
    const title = (await card.locator('.card-title').boundingBox()) as Box;
    expect(title).not.toBeNull();
    expect(overlapArea(title, move)).toBe(0);
    expect(overlapArea(title, remove)).toBe(0);
  });

  test('Enter and Space on Lane settings open the modal without collapsing the lane', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board', timeout: 15000 });

    const lane = page.locator('.kanban-lane').filter({ hasText: 'Action strip lane' });
    const settings = lane.locator('.lane-settings-btn');
    const cards = lane.locator('.lane-cards');
    const modal = page.locator('.modal-content');

    await expect(cards).toBeVisible();

    await settings.focus();
    await page.keyboard.press('Enter');
    await expect(modal).toBeVisible();
    await page.locator('.modal-footer .btn-secondary').click();
    await expect(modal).toBeHidden();
    await expect(cards).toBeVisible();

    await settings.focus();
    await page.keyboard.press('Space');
    await expect(modal).toBeVisible();
    await page.locator('.modal-footer .btn-secondary').click();
    await expect(modal).toBeHidden();
    await expect(cards).toBeVisible();
  });

  test('lane accordion toggle stays keyboard operable via Enter and Space', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board', timeout: 15000 });

    const lane = page.locator('.kanban-lane').filter({ hasText: 'Action strip lane' });
    const toggle = lane.locator('.lane-toggle-btn');
    const cards = lane.locator('.lane-cards');

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.focus();

    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(cards).toBeHidden();

    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(cards).toBeVisible();
  });
});
