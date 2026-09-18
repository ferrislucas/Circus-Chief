import { test, expect } from '@playwright/test';
import {
  API_URL,
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
  waitForChildSession,
  getProjectSessions,
} from './helpers';

/**
 * Get child sessions for a parent by filtering project sessions.
 * Uses getProjectSessions (same approach as waitForChildSession internally)
 * instead of the non-existent /children endpoint.
 */
async function getChildSessionsFor(parentSessionId: string, projectId: string) {
  const allSessions = await getProjectSessions(projectId);
  return allSessions.filter((s: any) => s.parentSessionId === parentSessionId);
}

// ============================================================
// Helpers
// ============================================================

async function getKanbanBoard(projectId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/kanban`);
  return response.json();
}

async function configureLaneAutomation(projectId: string, laneId: string, settings: object) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/kanban/lanes/${laneId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to configure lane automation: ${response.status} ${text}`);
  }
  return response.json();
}

async function addSessionToLane(projectId: string, sessionId: string, laneId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/kanban/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceId: sessionId, laneId }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to add session to lane: ${response.status} ${text}`);
  }
  return response.json();
}

async function moveCardViaAPI(
  projectId: string,
  workspaceId: string,
  laneId: string
) {
  const response = await fetch(
    `${API_URL}/api/projects/${projectId}/kanban/cards/by-workspace/${workspaceId}/lane`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ laneId }),
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to move card: ${response.status} ${text}`);
  }
  return response.json();
}

// ============================================================
// Tests
// ============================================================

test.describe('Kanban on-enter automation', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let session: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kanban Automation Test', '/tmp/test-kanban-auto');
    session = await seedSession(project.id, {
      prompt: 'Parent session',
      name: 'Automation Parent',
      startImmediately: false,
    });
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // ----------------------------------------------------------------
  // Test 1 (API): moving card to lane with onEnterPrompt creates a child session
  // ----------------------------------------------------------------
  test('moving card to lane with onEnterPrompt creates a child session', async () => {
    const board = await getKanbanBoard(project.id);
    const todoLane = board.lanes.find((l: any) => l.name === 'To Do');
    const doneLane = board.lanes.find((l: any) => l.name === 'Done');

    // Add session to "To Do" lane
    const card = await addSessionToLane(project.id, session.id, todoLane.id);

    // Configure "Done" lane with an onEnterPrompt
    await configureLaneAutomation(project.id, doneLane.id, {
      onEnterPrompt: 'Run the tests',
    });

    // Move the card to "Done" via the API (with automation enabled)
    const result = await moveCardViaAPI(project.id, session.id, doneLane.id);
    expect(result).toEqual({ status: 'moved', laneId: doneLane.id });

    // Wait for the child session to be created by the automation
    const childSession = await waitForChildSession(session.id, 15000);

    // Verify child session was created with expected properties
    expect(childSession).toBeTruthy();
    expect(childSession.parentSessionId).toBe(session.id);
    expect(childSession.name).toContain('Lane prompt (lane: Done)');
  });

  // ----------------------------------------------------------------
  // Test 2 (API): the unified route always honors destination automation
  // ----------------------------------------------------------------
  test('routing to an automated lane creates a child without an automation override', async () => {
    const board = await getKanbanBoard(project.id);
    const todoLane = board.lanes.find((l: any) => l.name === 'To Do');
    const doneLane = board.lanes.find((l: any) => l.name === 'Done');

    // Add session to "To Do" lane
    await addSessionToLane(project.id, session.id, todoLane.id);

    // Configure "Done" lane with an onEnterPrompt
    await configureLaneAutomation(project.id, doneLane.id, {
      onEnterPrompt: 'Run the tests',
    });

    await moveCardViaAPI(project.id, session.id, doneLane.id);
    expect(await waitForChildSession(session.id, 15000)).toBeTruthy();
  });

  // ----------------------------------------------------------------
  // Test 3 (API): moving card to lane WITHOUT automation does NOT create child session
  // ----------------------------------------------------------------
  test('moving card to lane without automation does NOT create a child session', async () => {
    const board = await getKanbanBoard(project.id);
    const todoLane = board.lanes.find((l: any) => l.name === 'To Do');
    const inProgressLane = board.lanes.find((l: any) => l.name === 'In Progress');

    // Add session to "To Do" lane (no automation configured on In Progress)
    await addSessionToLane(project.id, session.id, todoLane.id);

    // Move the card to "In Progress" (no automation configured)
    const movedCard = await moveCardViaAPI(project.id, session.id, inProgressLane.id);

    // Card should be in the target lane
    expect(movedCard).toEqual({ status: 'moved', laneId: inProgressLane.id });

    // Wait a moment and verify no child session was created
    await new Promise((r) => setTimeout(r, 2000));
    const children = await getChildSessionsFor(session.id, project.id);
    expect(children).toHaveLength(0);
  });

  // ----------------------------------------------------------------
  // Test 4 (UI): moving card via the Move Modal UI triggers automation
  // ----------------------------------------------------------------
  test('on-enter automation triggers when using move modal from kanban board', async ({ page }) => {
    const board = await getKanbanBoard(project.id);
    const todoLane = board.lanes.find((l: any) => l.name === 'To Do');
    const doneLane = board.lanes.find((l: any) => l.name === 'Done');

    // Configure "Done" lane with an onEnterPrompt
    await configureLaneAutomation(project.id, doneLane.id, {
      onEnterPrompt: 'Run the tests',
    });

    // Navigate to the kanban board
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Add session to "To Do" via UI
    const todoLaneEl = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await todoLaneEl.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Hover card and click the move button
    const card = todoLaneEl.locator('.kanban-card').first();
    await card.hover();
    await card.locator('.card-move-btn').click();

    // In the move modal, select the "Done" lane
    const doneLaneRadio = page
      .locator('.lane-row')
      .filter({ hasText: 'Done' })
      .locator('input[type="radio"]');
    await doneLaneRadio.check();

    await expect(page.locator('.automation-option')).toHaveCount(0);

    // Click Move
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Wait for child session to be created by the automation
    const childSession = await waitForChildSession(session.id, 15000);

    expect(childSession).toBeTruthy();
    expect(childSession.parentSessionId).toBe(session.id);
    expect(childSession.name).toContain('Lane prompt (lane: Done)');
  });

  // ----------------------------------------------------------------
  // Test 5 (UI): destination automation cannot be bypassed in the move modal
  // ----------------------------------------------------------------
  test('move modal does not offer an automation bypass', async ({ page }) => {
    const board = await getKanbanBoard(project.id);
    const doneLane = board.lanes.find((l: any) => l.name === 'Done');

    // Configure "Done" lane with an onEnterPrompt
    await configureLaneAutomation(project.id, doneLane.id, {
      onEnterPrompt: 'Run the tests',
    });

    // Navigate to the kanban board
    await navigateAndWait(page, `/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Add session to "To Do" via UI
    const todoLaneEl = page.locator('.kanban-lane').filter({ hasText: 'To Do' });
    await todoLaneEl.locator('.add-session-btn').click();
    await expect(page.locator('.modal-content')).toBeVisible();
    await page.waitForSelector('.session-item', { timeout: 10000 });
    await page.locator('.session-item').first().click();
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    // Open move modal
    const card = todoLaneEl.locator('.kanban-card').first();
    await card.hover();
    await card.locator('.card-move-btn').click();

    // Select "Done" lane
    const doneLaneRadio = page
      .locator('.lane-row')
      .filter({ hasText: 'Done' })
      .locator('input[type="radio"]');
    await doneLaneRadio.check();

    await expect(page.locator('.automation-option')).toHaveCount(0);

    // Click Move
    await page.click('.modal-footer .btn-primary');
    await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });

    expect(await waitForChildSession(session.id, 15000)).toBeTruthy();
  });
});
