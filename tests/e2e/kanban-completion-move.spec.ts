import { test, expect, Page, Locator } from '@playwright/test';
import {
  API_URL,
  BASE_URL,
  seedProject,
  seedSession,
  cleanupCreatedResources,
  navigateAndWait,
  openSessionOverlay,
  waitForStatus,
} from './helpers';

/**
 * UI-driven E2E coverage for the lane "On Completion" move feature.
 *
 * Implements the plan on the canvas (kanban-completion-move-e2e-plan.md):
 *  - Test 1: configure + persist the completion target through the UI.
 *  - Test 2: clearing the target through the UI prevents an auto move.
 *  - Test 3 (+4 folded in): a real session lifecycle moves the card from the
 *    source lane to the configured destination, exercised through the UI and
 *    backed by the existing VCR cassette system (no Playwright route mocking).
 *
 * No REST mocking. The REST API is used only for seeding setup and for final
 * state verification — every user-observable action (configuring the lane,
 * adding the card, starting the session) happens through the UI.
 */

// ============================================================
// Helpers (scoped to this spec)
// ============================================================

/**
 * The completion-move lifecycle test (Test 3) starts a draft session through
 * the chat input. To keep it deterministic and runnable in the default
 * `VCR_MODE=replay`, it reuses the prompt of an already-committed cassette
 * (runSession-ec0df80145f024e5.json). The cassette key is callType + a hash of
 * this exact prompt, so the text MUST match byte-for-byte.
 *
 * If you ever change this prompt, re-record with:
 *   VCR_MODE=record ./scripts/pw.sh test tests/e2e/kanban-completion-move.spec.ts \
 *     --grep "Session completion moves card"
 * and commit the new cassette under tests/e2e/cassettes/.
 */
const VCR_PROMPT = 'Claude E2E regression: reply with exactly "Claude E2E response."';
const VCR_MODEL = 'claude-haiku-4-5-20251001';

async function getBoard(projectId: string) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/kanban`);
  if (!response.ok) throw new Error(`Failed to fetch board: ${response.status}`);
  return response.json();
}

function getLaneByName(board: any, name: string) {
  return board.lanes.find((lane: any) => lane.name === name);
}

/** Return the name of the lane that currently holds the given session's card, or null. */
function findLaneOfSession(board: any, sessionId: string): string | null {
  for (const lane of board.lanes) {
    for (const card of lane.cards || []) {
      if ((card.sessions || []).some((s: any) => s.id === sessionId)) {
        return lane.name;
      }
    }
  }
  return null;
}

/** Locate a kanban lane by its exact title (avoids matching card text). */
function laneByTitle(page: Page, title: string): Locator {
  return page.locator('.kanban-lane').filter({
    has: page.locator('.lane-title', { hasText: new RegExp(`^${title}$`) }),
  });
}

/** Locate a card (by session name) inside a specific lane. */
function cardInLane(page: Page, laneTitle: string, sessionName: string): Locator {
  return laneByTitle(page, laneTitle).locator('.kanban-card').filter({ hasText: sessionName });
}

async function openLaneSettings(page: Page, laneTitle: string) {
  await laneByTitle(page, laneTitle).locator('.lane-settings-btn').click();
  await expect(page.locator('.modal-content')).toBeVisible();
  await expect(page.locator('#completion-target-lane-select')).toBeVisible();
}

async function saveLaneSettings(page: Page) {
  await page.click('.modal-footer .btn-primary');
  await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });
}

/** Add a (draft) session to a lane via the lane's "Add Session" modal. */
async function addSessionToLaneViaUI(page: Page, laneTitle: string, sessionName: string) {
  await laneByTitle(page, laneTitle).locator('.add-session-btn').click();
  await expect(page.locator('.modal-content')).toBeVisible();
  await page.waitForSelector('.session-item', { timeout: 10000 });
  await page.locator('.session-item').filter({ hasText: sessionName }).first().click();
  await page.click('.modal-footer .btn-primary');
  await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });
}

// ============================================================
// Tests
// ============================================================

test.describe('Kanban lane completion move', () => {
  test.describe.configure({ timeout: 120000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kanban Completion Move Test', '/tmp/test-kanban-completion', {
      kanbanEnabled: true,
    });
    // Force board + default lanes to exist before the UI loads.
    await getBoard(project.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // ----------------------------------------------------------------
  // Test 1: configure + persist completion target through the UI
  // ----------------------------------------------------------------
  test('configures and persists the completion target through the UI', async ({ page }) => {
    const board = await getBoard(project.id);
    const doneLane = getLaneByName(board, 'Done');

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    await openLaneSettings(page, 'In Progress');

    // The select should list "do not move" plus every OTHER lane, but never
    // the lane being configured.
    const optionTexts = await page
      .locator('#completion-target-lane-select option')
      .allTextContents();
    const trimmed = optionTexts.map((t) => t.trim());
    expect(trimmed).toContain('Do not move automatically');
    expect(trimmed).toContain('To Do');
    expect(trimmed).toContain('Review');
    expect(trimmed).toContain('Done');
    expect(trimmed).not.toContain('In Progress');

    // Configure the move to "Done" and save through the real API.
    await page.selectOption('#completion-target-lane-select', { label: 'Done' });
    await saveLaneSettings(page);

    // Survives a full reload + reopen.
    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await openLaneSettings(page, 'In Progress');

    const select = page.locator('#completion-target-lane-select');
    await expect(select).toHaveValue(doneLane.id);
    await expect(page.locator('#completion-target-lane-select option:checked')).toHaveText('Done');

    // Persisted server-side too.
    const afterBoard = await getBoard(project.id);
    const inProgress = getLaneByName(afterBoard, 'In Progress');
    expect(inProgress.completionTargetLaneId).toBe(doneLane.id);
  });

  // ----------------------------------------------------------------
  // Test 2: clearing the completion target through the UI prevents auto move
  // ----------------------------------------------------------------
  test('clearing the completion target through the UI prevents auto move', async ({ page }) => {
    const sessionName = 'Completion Clear Session';
    const session = await seedSession(project.id, {
      prompt: 'Draft for clear test',
      name: sessionName,
      startImmediately: false,
    });

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // First set a target...
    await openLaneSettings(page, 'In Progress');
    await page.selectOption('#completion-target-lane-select', { label: 'Done' });
    await saveLaneSettings(page);

    // ...then clear it back to "do not move".
    await openLaneSettings(page, 'In Progress');
    await page.selectOption('#completion-target-lane-select', { label: 'Do not move automatically' });
    await saveLaneSettings(page);

    // Add the draft to "In Progress" through the UI.
    await addSessionToLaneViaUI(page, 'In Progress', sessionName);
    await expect(cardInLane(page, 'In Progress', sessionName)).toBeVisible();

    // The cleared setting is persisted as null.
    const board = await getBoard(project.id);
    const inProgress = getLaneByName(board, 'In Progress');
    expect(inProgress.completionTargetLaneId).toBeNull();

    // Simulate the session settling into the natural-completion status. With the
    // target cleared, the card must stay put. (No LLM lifecycle is spent here.)
    await fetch(`${API_URL}/api/sessions/${session.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'waiting' }),
    });

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await expect(cardInLane(page, 'In Progress', sessionName)).toBeVisible();
    await expect(cardInLane(page, 'Done', sessionName)).toHaveCount(0);

    // And server-side the card never left "In Progress".
    const afterBoard = await getBoard(project.id);
    expect(findLaneOfSession(afterBoard, session.id)).toBe('In Progress');
  });

  // ----------------------------------------------------------------
  // Test 3 (+ Test 4): a real session lifecycle moves the card via the
  // completion hook, driven through the UI and replayed via VCR.
  // ----------------------------------------------------------------
  test('Session completion moves card from source lane to completion target', async ({ page }) => {
    const sessionName = 'Completion Move VCR Session';
    const board = await getBoard(project.id);
    const doneLane = getLaneByName(board, 'Done');

    const session = await seedSession(project.id, {
      prompt: VCR_PROMPT,
      name: sessionName,
      model: VCR_MODEL,
      startImmediately: false,
    });

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Configure "In Progress" → "Done" on completion, through the UI.
    await openLaneSettings(page, 'In Progress');
    await page.selectOption('#completion-target-lane-select', { label: 'Done' });
    await saveLaneSettings(page);

    // Add the draft session to "In Progress" through the UI.
    await addSessionToLaneViaUI(page, 'In Progress', sessionName);
    await expect(cardInLane(page, 'In Progress', sessionName)).toBeVisible();

    // Start the session via the visible chat input (no direct /message call).
    await navigateAndWait(page, `${BASE_URL}/sessions/${session.id}/summary`);
    await openSessionOverlay(page);
    const textarea = page.locator('.input-form textarea');
    await textarea.fill(VCR_PROMPT);
    await page.locator('.btn-send-full').first().click();

    // Wait for the agent turn to complete naturally (VCR replay → 'waiting').
    await waitForStatus(session.id, 'waiting', 60000);

    // The completion hook runs right after the status flips to 'waiting', so
    // poll the API until the card lands in "Done" (avoids the status/hook race).
    await expect
      .poll(async () => findLaneOfSession(await getBoard(project.id), session.id), {
        timeout: 15000,
      })
      .toBe('Done');

    // Back on the board, the card is shown in "Done" and gone from "In Progress"
    // — first live (no manual reload), then again after a reload (Test 4).
    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });
    await expect(cardInLane(page, 'Done', sessionName)).toBeVisible({ timeout: 15000 });
    await expect(cardInLane(page, 'In Progress', sessionName)).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await expect(cardInLane(page, 'Done', sessionName)).toBeVisible();
    await expect(cardInLane(page, 'In Progress', sessionName)).toHaveCount(0);

    // Final server-side verification.
    const finalBoard = await getBoard(project.id);
    const done = getLaneByName(finalBoard, 'Done');
    const card = done.cards.find((c: any) => (c.sessions || []).some((s: any) => s.id === session.id));
    expect(card).toBeTruthy();
    expect(card.laneId).toBe(doneLane.id);
  });
});
