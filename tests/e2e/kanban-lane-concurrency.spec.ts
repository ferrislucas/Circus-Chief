import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedKanbanCard,
  cleanupCreatedResources,
  navigateAndWait,
  API_URL,
} from './helpers';
import {
  getBoard,
  getLaneByName,
  laneByTitle,
  openLaneSettings,
  saveLaneSettings,
  setLaneOnEnter,
  VCR_PROMPT,
  FORCE_PROACTIVE_RESCHEDULE_ON_ENTER,
} from './kanbanLaneRunHelpers';

/**
 * E2E coverage for per-lane concurrency limits with visible queueing.
 *
 * Lane automation uses the standard VCR prompt plus forced proactive
 * rescheduling, so each started worker's first turn registers a scheduled
 * continuation and its run stays open (holding its slot) for the whole
 * test — the scheduler is disabled under VCR_MODE. Slot release is driven
 * the way users do it: moving the runner to another lane through the Move
 * modal (completion-triggered release is covered in unit tests).
 */
test.describe('Kanban lane concurrency limits', () => {
  test.describe.configure({ timeout: 120000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kanban Concurrency Test', '/tmp/test-kanban-concurrency');
    await getBoard(project.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  async function moveWorkspaceToLane(workspaceId: string, laneId: string) {
    const response = await fetch(
      `${API_URL}/api/projects/${project.id}/kanban/cards/by-workspace/${workspaceId}/lane`,
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ laneId }) },
    );
    if (!response.ok) throw new Error(`Failed to move workspace: ${response.status} ${await response.text()}`);
    return response.json();
  }

  async function moveCardViaUI(page: any, cardName: string, targetLane: string) {
    const card = page.locator('.kanban-card').filter({ hasText: cardName }).first();
    await card.hover();
    await card.locator('.card-move-btn').click();
    await expect(page.locator('.modal-title')).toHaveText('Move to Lane');
    await page.locator('.lane-row').filter({ hasText: targetLane }).locator('input[type="radio"]').check();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 10000 });
  }

  function laneState(board: any, laneId: string) {
    const lane = board.lanes.find((l: any) => l.id === laneId);
    return {
      limit: lane.concurrencyLimit,
      cards: lane.cards.map((c: any) => ({
        name: c.sessions[0]?.name, entryState: c.entryState, queuePosition: c.queuePosition,
      })),
    };
  }

  test('limits queue excess cards and drains top-down on release', async ({ page }) => {
    const board0 = await getBoard(project.id);
    const wip = getLaneByName(board0, 'In Progress');
    const todo = getLaneByName(board0, 'To Do');
    await setLaneOnEnter(project.id, wip.id, {
      onEnterPrompt: VCR_PROMPT,
      ...FORCE_PROACTIVE_RESCHEDULE_ON_ENTER,
    });

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });

    // Set the limit through the Lane Settings modal.
    await openLaneSettings(page, 'In Progress');
    await page.locator('[data-testid="lane-concurrency-limit"]').fill('1');
    await saveLaneSettings(page);
    await expect(
      laneByTitle(page, 'In Progress').locator('[data-testid="lane-limit-state"]'),
    ).toContainText('0/1 running');

    // Bulk-move three cards into the limit-1 lane.
    const names = ['Queue A', 'Queue B', 'Queue C'];
    const sessions: any[] = [];
    for (const name of names) {
      const session = await seedSession(project.id, { prompt: 'E2E queue fixture', name, startImmediately: false });
      sessions.push(session);
      await seedKanbanCard(project.id, { sessionId: session.id, laneId: todo.id });
    }
    for (const session of sessions) {
      await moveWorkspaceToLane(session.id, wip.id);
    }

    // Server state: 1 running + 2 queued with positions.
    const board1 = await getBoard(project.id);
    expect(laneState(board1, wip.id)).toEqual({
      limit: 1,
      cards: [
        { name: 'Queue A', entryState: 'running', queuePosition: null },
        { name: 'Queue B', entryState: 'queued', queuePosition: 1 },
        { name: 'Queue C', entryState: 'queued', queuePosition: 2 },
      ],
    });

    // UI state: header + queued badges with positions.
    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    const wipLane = laneByTitle(page, 'In Progress');
    await expect(wipLane.locator('[data-testid="lane-limit-state"]')).toContainText('1/1 running · 2 queued');
    await expect(wipLane.locator('[data-testid="queued-badge"]')).toHaveCount(2);
    await expect(wipLane.locator('.kanban-card').filter({ hasText: 'Queue B' }).locator('[data-testid="queued-badge"]')).toContainText('#1');
    await expect(wipLane.locator('.kanban-card').filter({ hasText: 'Queue C' }).locator('[data-testid="queued-badge"]')).toContainText('#2');

    // Release the slot by moving the runner out through the UI: top queued starts.
    await moveCardViaUI(page, 'Queue A', 'Done');
    await expect(wipLane.locator('[data-testid="lane-limit-state"]')).toContainText('1/1 running · 1 queued', { timeout: 15000 });
    await expect(wipLane.locator('[data-testid="queued-badge"]')).toHaveCount(1);
    await expect(
      wipLane.locator('.kanban-card').filter({ hasText: 'Queue B' }).locator('[data-testid="queued-badge"]'),
    ).toBeHidden();
    await expect(
      wipLane.locator('.kanban-card').filter({ hasText: 'Queue C' }).locator('[data-testid="queued-badge"]'),
    ).toContainText('#1');

    const board2 = await getBoard(project.id);
    expect(laneState(board2, wip.id).cards).toEqual([
      { name: 'Queue B', entryState: 'running', queuePosition: null },
      { name: 'Queue C', entryState: 'queued', queuePosition: 1 },
    ]);
  });

  test('reordered queued cards start in the new lane order', async ({ page }) => {
    const board0 = await getBoard(project.id);
    const wip = getLaneByName(board0, 'In Progress');
    const todo = getLaneByName(board0, 'To Do');
    await setLaneOnEnter(project.id, wip.id, {
      onEnterPrompt: VCR_PROMPT,
      ...FORCE_PROACTIVE_RESCHEDULE_ON_ENTER,
      concurrencyLimit: 1,
    });

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });

    const names = ['Queue A', 'Queue B', 'Queue C'];
    const sessions: any[] = [];
    for (const name of names) {
      const session = await seedSession(project.id, { prompt: 'E2E queue fixture', name, startImmediately: false });
      sessions.push(session);
      await seedKanbanCard(project.id, { sessionId: session.id, laneId: todo.id });
    }
    for (const session of sessions) {
      await moveWorkspaceToLane(session.id, wip.id);
    }

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    const wipLane = laneByTitle(page, 'In Progress');
    await expect(wipLane.locator('[data-testid="lane-limit-state"]')).toContainText('1/1 running · 2 queued');

    // Drag Queue C to the top of the queue with the card up-arrows, then
    // release the slot: Queue C (not Queue B) must start next.
    const cardC = wipLane.locator('.kanban-card').filter({ hasText: 'Queue C' });
    await cardC.hover();
    await cardC.locator('.card-reorder-btn[title="Move card up"]').click();
    await cardC.hover();
    await cardC.locator('.card-reorder-btn[title="Move card up"]').click();

    await moveCardViaUI(page, 'Queue A', 'Done');

    await expect(
      wipLane.locator('.kanban-card').filter({ hasText: 'Queue C' }).locator('[data-testid="queued-badge"]'),
      { timeout: 15000 },
    ).toBeHidden();
    await expect(
      wipLane.locator('.kanban-card').filter({ hasText: 'Queue B' }).locator('[data-testid="queued-badge"]'),
    ).toContainText('#1');

    const board1 = await getBoard(project.id);
    expect(laneState(board1, wip.id).cards).toEqual([
      { name: 'Queue C', entryState: 'running', queuePosition: null },
      { name: 'Queue B', entryState: 'queued', queuePosition: 1 },
    ]);
  });
});
