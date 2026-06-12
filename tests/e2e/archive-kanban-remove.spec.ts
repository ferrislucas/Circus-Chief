import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedKanbanLane,
  seedKanbanCard,
  cleanupCreatedResources,
  navigateAndWait,
} from './helpers';

const API_URL = process.env.API_URL || 'http://localhost:5000';

test.describe('Archive Modal - Remove from Kanban Board', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Archive Kanban Test', '/tmp/test-archive-kanban');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // ---------------------------------------------------------------------------
  // Checkbox visibility
  // ---------------------------------------------------------------------------

  test('shows "Remove from Kanban board" checkbox (checked by default) when session is on board — session list view', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Kanban session',
      name: 'Board Session List',
      startImmediately: false,
    });
    const lane = await seedKanbanLane(project.id, { name: 'In Progress' });
    await seedKanbanCard(project.id, { sessionId: session.id, laneId: lane.id });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    await page.locator('button.archive-btn[title="Archive session"]').first().click();

    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const boardOption = modal.locator('.cleanup-option').filter({ hasText: 'Remove from Kanban board' });
    await expect(boardOption).toBeVisible();

    // Checkbox must be pre-checked (the new default)
    const checkbox = boardOption.locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();

    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });

  test('shows "Remove from Kanban board" checkbox (checked by default) when session is on board — session detail view', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Kanban session',
      name: 'Board Session Detail',
      startImmediately: false,
    });
    const lane = await seedKanbanLane(project.id, { name: 'Review' });
    await seedKanbanCard(project.id, { sessionId: session.id, laneId: lane.id });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);

    await page.click('button[aria-label="Session actions"]');
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });
    await page.locator('button.menu-item').filter({ hasText: 'Archive' }).click({ timeout: 10000 });

    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const boardOption = modal.locator('.cleanup-option').filter({ hasText: 'Remove from Kanban board' });
    await expect(boardOption).toBeVisible();

    // Checkbox must be pre-checked (the new default)
    const checkbox = boardOption.locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();

    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });

  test('hides "Remove from Kanban board" checkbox when session is not on board — session list view', async ({ page }) => {
    await seedSession(project.id, {
      prompt: 'Off-board session',
      name: 'Off Board List',
      startImmediately: false,
    });
    // No card added for this session

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    await page.locator('button.archive-btn[title="Archive session"]').first().click();

    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const boardOption = modal.locator('.cleanup-option').filter({ hasText: 'Remove from Kanban board' });
    await expect(boardOption).not.toBeVisible();

    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });

  // ---------------------------------------------------------------------------
  // Archive + remove card behaviour
  // ---------------------------------------------------------------------------

  test('archiving with checkbox checked removes the card from the board', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Remove card session',
      name: 'Remove Card Session',
      startImmediately: false,
    });
    const lane = await seedKanbanLane(project.id, { name: 'Done' });
    await seedKanbanCard(project.id, { sessionId: session.id, laneId: lane.id });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    await page.locator('button.archive-btn[title="Archive session"]').first().click();

    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Checkbox should already be checked — confirm the archive
    const boardOption = modal.locator('.cleanup-option').filter({ hasText: 'Remove from Kanban board' });
    const checkbox = boardOption.locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();

    await modal.locator('button').filter({ hasText: 'Archive' }).click();
    await expect(modal).toBeHidden({ timeout: 10000 });

    // Verify the card is gone from the board via the API
    const boardRes = await page.request.get(`${API_URL}/api/projects/${project.id}/kanban`);
    const board = await boardRes.json();
    const allCards = board.lanes.flatMap((l: any) => l.cards ?? []);
    expect(allCards.every((c: any) => c.sessions?.every((s: any) => s.id !== session.id))).toBe(true);
  });

  test('archiving with checkbox unchecked leaves the card on the board', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Keep card session',
      name: 'Keep Card Session',
      startImmediately: false,
    });
    const lane = await seedKanbanLane(project.id, { name: 'Done' });
    const card = await seedKanbanCard(project.id, { sessionId: session.id, laneId: lane.id });

    await navigateAndWait(page, `/projects/${project.id}/sessions`);

    await page.locator('button.archive-btn[title="Archive session"]').first().click();

    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Uncheck the "Remove from Kanban board" checkbox
    const boardOption = modal.locator('.cleanup-option').filter({ hasText: 'Remove from Kanban board' });
    const checkbox = boardOption.locator('input[type="checkbox"]');
    await expect(checkbox).toBeChecked();
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();

    await modal.locator('button').filter({ hasText: 'Archive' }).click();
    await expect(modal).toBeHidden({ timeout: 10000 });

    // Verify the card is still on the board via the API
    const boardRes = await page.request.get(`${API_URL}/api/projects/${project.id}/kanban`);
    const board = await boardRes.json();
    const allCards = board.lanes.flatMap((l: any) => l.cards ?? []);
    expect(allCards.some((c: any) => c.id === card.id)).toBe(true);
  });
});
