import { test, expect, Page, Locator } from '@playwright/test';
import {
  API_URL,
  BASE_URL,
  seedProject,
  seedSession,
  seedProjectTemplate,
  cleanupCreatedResources,
  navigateAndWait,
  openSessionOverlay,
  waitForStatus,
  waitForChildSession,
  getProjectSessions,
} from './helpers';

/**
 * UI-driven E2E coverage for the lane "On Completion" move feature.
 *
 *  - Test 1: configure / change / clear the completion target through the UI and
 *    assert each variation persists across reload AND server-side.
 *  - Test 2: clearing the target prevents an auto move — proven by running a REAL
 *    session lifecycle (VCR replay) so the production completion hook actually
 *    fires and decides not to move (no direct status PATCH shortcut).
 *  - Test 3: a real session lifecycle moves the card from the source lane to the
 *    configured destination, through the UI and backed by the VCR cassette system.
 *  - Test 4: completing into a destination lane that has an on-enter CUSTOM PROMPT
 *    creates a child session (the automation runs as part of the completion move).
 *  - Test 5: same as Test 4 but the destination lane runs an on-enter TEMPLATE.
 *
 * No REST mocking. The REST API is used only for seeding setup (sessions,
 * templates, destination-lane on-enter automation) and for final state
 * verification. Every user-observable action for the feature under test —
 * configuring the completion target, adding the card, starting the session —
 * happens through the UI.
 */

// ============================================================
// Helpers (scoped to this spec)
// ============================================================

/**
 * The lifecycle tests start a draft session through the chat input. To keep
 * them deterministic and runnable in the default `VCR_MODE=replay`, they reuse
 * the prompt of an already-committed cassette (runSession-ec0df80145f024e5.json).
 * The cassette key is callType + a hash of this exact prompt, so the text MUST
 * match byte-for-byte. The same prompt is reused for the on-enter automation in
 * Tests 4/5 so the spawned child session also replays cleanly from that cassette.
 *
 * If you ever change this prompt, re-record with:
 *   VCR_MODE=record ./scripts/pw.sh test tests/e2e/kanban-completion-move.spec.ts
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

/** Configure a destination lane's on-enter automation via the REST API (test setup). */
async function setLaneOnEnter(projectId: string, laneId: string, settings: object) {
  const response = await fetch(`${API_URL}/api/projects/${projectId}/kanban/lanes/${laneId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    throw new Error(`Failed to set lane on-enter automation: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

/** Count child sessions of a parent (used for negative assertions). */
async function countChildSessions(parentSessionId: string, projectId: string): Promise<number> {
  const all = await getProjectSessions(projectId);
  return all.filter((s: any) => s.parentSessionId === parentSessionId).length;
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

/**
 * Locate a card by SESSION ID inside a specific lane, via the card's
 * `/sessions/{id}` link. Use this when the card's title may change out from
 * under the test — e.g. after a turn completes, summary generation can rename
 * the session, so matching on the seeded name becomes unreliable.
 */
function cardByIdInLane(page: Page, laneTitle: string, sessionId: string): Locator {
  return laneByTitle(page, laneTitle)
    .locator('.kanban-card')
    .filter({ has: page.locator(`a[href$="/sessions/${sessionId}"]`) });
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

/** Open "In Progress" lane settings, pick a completion target by label, and save. */
async function configureCompletionTarget(page: Page, sourceLane: string, targetLabel: string) {
  await openLaneSettings(page, sourceLane);
  await page.selectOption('#completion-target-lane-select', { label: targetLabel });
  await saveLaneSettings(page);
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

/**
 * Drive a real agent turn through the UI: open the session, type the VCR prompt
 * into the visible chat input, send, and wait for the turn to settle to
 * 'waiting' (VCR replay). This is what triggers the production completion hook.
 */
async function runSessionTurnViaUI(page: Page, sessionId: string) {
  await navigateAndWait(page, `${BASE_URL}/sessions/${sessionId}/summary`);
  await openSessionOverlay(page);
  const textarea = page.locator('.input-form textarea');
  await textarea.fill(VCR_PROMPT);
  await page.locator('.btn-send-full').first().click();
  await waitForStatus(sessionId, 'waiting', 60000);
}

/** Poll the board until the given session's card lands in the expected lane. */
async function expectCardSettlesInLane(projectId: string, sessionId: string, laneName: string) {
  await expect
    .poll(async () => findLaneOfSession(await getBoard(projectId), sessionId), { timeout: 15000 })
    .toBe(laneName);
}

/**
 * Move a card between lanes through the kanban move modal (same flow as
 * kanban-move-card.spec.ts): hover the card, click its move button, select the
 * target lane radio, and confirm. Used to simulate a user moving an
 * already-conversing session's card into the completion-target lane.
 */
async function moveCardViaUI(page: Page, card: Locator, toLane: string) {
  await card.hover();
  await card.locator('.card-move-btn').click();
  await expect(page.locator('.modal-title')).toHaveText('Move to Lane');
  await page
    .locator('.lane-row')
    .filter({ hasText: toLane })
    .locator('input[type="radio"]')
    .check();
  await page.click('.modal-footer .btn-primary');
  await expect(page.locator('.modal-backdrop')).toBeHidden({ timeout: 5000 });
}

/**
 * Drive a FOLLOW-UP agent turn (turn 2+) through the UI.
 *
 * Unlike `runSessionTurnViaUI`, this must NOT wait for status 'waiting' up front:
 * between turns the session is already 'waiting', so that check would return
 * immediately without ever observing the new turn. Instead we send the prompt and
 * let the caller use `expectCardSettlesInLane` (board poll) as the completion
 * signal — the production completion hook fires only after the turn actually
 * finishes, so the card landing in the target lane is proof the turn completed.
 */
async function runFollowUpTurnViaUI(page: Page, sessionId: string) {
  await navigateAndWait(page, `${BASE_URL}/sessions/${sessionId}/summary`);
  await openSessionOverlay(page);
  const textarea = page.locator('.input-form textarea');
  await textarea.fill(VCR_PROMPT);
  await page.locator('.btn-send-full').first().click();
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
  // Test 1: configure / change / clear the completion target through the UI
  // ----------------------------------------------------------------
  test('configures, changes, and clears the completion target through the UI', async ({ page }) => {
    const board = await getBoard(project.id);
    const doneLane = getLaneByName(board, 'Done');
    const reviewLane = getLaneByName(board, 'Review');
    const otherLaneNames = board.lanes
      .filter((l: any) => l.name !== 'In Progress')
      .map((l: any) => l.name)
      .sort();

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    await openLaneSettings(page, 'In Progress');

    // The select lists "do not move" + every OTHER lane, and never the lane
    // being configured. Assert the exact set, not just a few members.
    const optionTexts = (
      await page.locator('#completion-target-lane-select option').allTextContents()
    ).map((t) => t.trim());
    expect(optionTexts[0]).toBe('Do not move automatically');
    expect(optionTexts.slice(1).sort()).toEqual(otherLaneNames);
    expect(optionTexts).not.toContain('In Progress');

    // (a) Configure the move to "Done" and save through the real API.
    await page.selectOption('#completion-target-lane-select', { label: 'Done' });
    await saveLaneSettings(page);

    // Survives a full reload + reopen.
    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await openLaneSettings(page, 'In Progress');
    await expect(page.locator('#completion-target-lane-select')).toHaveValue(doneLane.id);
    await expect(page.locator('#completion-target-lane-select option:checked')).toHaveText('Done');
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionTargetLaneId).toBe(
      doneLane.id
    );
    await page.click('.modal-footer .btn-secondary'); // Cancel out

    // (b) Change the target to a DIFFERENT lane ("Review") and confirm it updates.
    await configureCompletionTarget(page, 'In Progress', 'Review');
    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await openLaneSettings(page, 'In Progress');
    await expect(page.locator('#completion-target-lane-select')).toHaveValue(reviewLane.id);
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionTargetLaneId).toBe(
      reviewLane.id
    );
    await page.click('.modal-footer .btn-secondary');

    // (c) Clear it back to "do not move" and confirm it persists as null.
    await configureCompletionTarget(page, 'In Progress', 'Do not move automatically');
    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await openLaneSettings(page, 'In Progress');
    await expect(page.locator('#completion-target-lane-select option:checked')).toHaveText(
      'Do not move automatically'
    );
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionTargetLaneId).toBeNull();
  });

  // ----------------------------------------------------------------
  // Test 2: clearing the completion target prevents an auto move — proven by a
  // REAL session lifecycle so the completion hook actually runs and declines.
  // ----------------------------------------------------------------
  test('clearing the completion target prevents auto move across a real session lifecycle', async ({
    page,
  }) => {
    const sessionName = 'Completion Clear VCR Session';
    const session = await seedSession(project.id, {
      prompt: VCR_PROMPT,
      name: sessionName,
      model: VCR_MODEL,
      startImmediately: false,
    });

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // First set a target, then clear it back to "do not move" — both via the UI.
    await configureCompletionTarget(page, 'In Progress', 'Done');
    await configureCompletionTarget(page, 'In Progress', 'Do not move automatically');

    // The cleared setting is persisted as null.
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionTargetLaneId).toBeNull();

    // Add the draft to "In Progress" through the UI.
    await addSessionToLaneViaUI(page, 'In Progress', sessionName);
    await expect(cardInLane(page, 'In Progress', sessionName)).toBeVisible();

    // Run a REAL agent turn. The completion hook fires for this session, but with
    // the target cleared it must leave the card exactly where it is.
    await runSessionTurnViaUI(page, session.id);

    // Give the completion hook (which runs just after status flips to 'waiting')
    // time to run, then assert the card never moved — live and after reload.
    await expect
      .poll(async () => findLaneOfSession(await getBoard(project.id), session.id), { timeout: 8000 })
      .toBe('In Progress');

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });
    await expect(cardInLane(page, 'In Progress', sessionName)).toBeVisible();
    await expect(cardInLane(page, 'Done', sessionName)).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await expect(cardInLane(page, 'In Progress', sessionName)).toBeVisible();
    await expect(cardInLane(page, 'Done', sessionName)).toHaveCount(0);

    // Server-side, the card never left "In Progress".
    expect(findLaneOfSession(await getBoard(project.id), session.id)).toBe('In Progress');
  });

  // ----------------------------------------------------------------
  // Test 3: a real session lifecycle moves the card from source to target.
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
    await configureCompletionTarget(page, 'In Progress', 'Done');

    // Add the draft session to "In Progress" through the UI.
    await addSessionToLaneViaUI(page, 'In Progress', sessionName);
    await expect(cardInLane(page, 'In Progress', sessionName)).toBeVisible();

    // Start the session via the visible chat input (no direct /message call).
    await runSessionTurnViaUI(page, session.id);

    // The completion hook runs right after the status flips to 'waiting', so
    // poll the API until the card lands in "Done" (avoids the status/hook race).
    await expectCardSettlesInLane(project.id, session.id, 'Done');

    // Back on the board, the card is shown in "Done" and gone from "In Progress"
    // — first live (no manual reload), then again after a reload.
    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });
    await expect(cardInLane(page, 'Done', sessionName)).toBeVisible({ timeout: 15000 });
    await expect(cardInLane(page, 'In Progress', sessionName)).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await expect(cardInLane(page, 'Done', sessionName)).toBeVisible();
    await expect(cardInLane(page, 'In Progress', sessionName)).toHaveCount(0);

    // "Done" has no on-enter automation, so no child session should be spawned.
    expect(await countChildSessions(session.id, project.id)).toBe(0);

    // Final server-side verification.
    const finalBoard = await getBoard(project.id);
    const done = getLaneByName(finalBoard, 'Done');
    const card = done.cards.find((c: any) => (c.sessions || []).some((s: any) => s.id === session.id));
    expect(card).toBeTruthy();
    expect(card.laneId).toBe(doneLane.id);
  });

  // ----------------------------------------------------------------
  // Test 4: completing into a destination lane with an on-enter CUSTOM PROMPT
  // moves the card AND runs the automation (spawns a child session).
  // ----------------------------------------------------------------
  test('completion move runs the destination lane on-enter prompt (spawns child session)', async ({
    page,
  }) => {
    const sessionName = 'Completion Prompt Parent';
    const board = await getBoard(project.id);
    const doneLane = getLaneByName(board, 'Done');

    // Destination lane runs a custom prompt on entry (test setup via API).
    // Reuse VCR_PROMPT so the spawned child also replays from the cassette.
    await setLaneOnEnter(project.id, doneLane.id, { onEnterPrompt: VCR_PROMPT });

    const session = await seedSession(project.id, {
      prompt: VCR_PROMPT,
      name: sessionName,
      model: VCR_MODEL,
      startImmediately: false,
    });

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    await configureCompletionTarget(page, 'In Progress', 'Done');
    await addSessionToLaneViaUI(page, 'In Progress', sessionName);
    await expect(cardInLane(page, 'In Progress', sessionName)).toBeVisible();

    await runSessionTurnViaUI(page, session.id);

    // Card moves to Done...
    await expectCardSettlesInLane(project.id, session.id, 'Done');

    // ...and the on-enter prompt automation spawns a child session.
    const child = await waitForChildSession(session.id, 15000);
    expect(child).toBeTruthy();
    expect(child.parentSessionId).toBe(session.id);
    expect(child.name).toContain('Lane prompt (lane: Done)');
  });

  // ----------------------------------------------------------------
  // Test 5: completing into a destination lane with an on-enter TEMPLATE moves
  // the card AND runs the template (spawns a child session named after it).
  // ----------------------------------------------------------------
  test('completion move runs the destination lane on-enter template (spawns child session)', async ({
    page,
  }) => {
    const sessionName = 'Completion Template Parent';
    const board = await getBoard(project.id);
    const doneLane = getLaneByName(board, 'Done');

    // Seed a project template and attach it as the destination lane's on-enter
    // automation. Reuse VCR_PROMPT so the spawned child replays from the cassette.
    const template = await seedProjectTemplate(project.id, {
      name: 'Completion Template',
      prompt: VCR_PROMPT,
      model: VCR_MODEL,
    });
    await setLaneOnEnter(project.id, doneLane.id, { onEnterTemplateId: template.id });

    const session = await seedSession(project.id, {
      prompt: VCR_PROMPT,
      name: sessionName,
      model: VCR_MODEL,
      startImmediately: false,
    });

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    await configureCompletionTarget(page, 'In Progress', 'Done');
    await addSessionToLaneViaUI(page, 'In Progress', sessionName);
    await expect(cardInLane(page, 'In Progress', sessionName)).toBeVisible();

    await runSessionTurnViaUI(page, session.id);

    // Card moves to Done...
    await expectCardSettlesInLane(project.id, session.id, 'Done');

    // ...and the on-enter template automation spawns a child session named after
    // the template.
    const child = await waitForChildSession(session.id, 15000);
    expect(child).toBeTruthy();
    expect(child.parentSessionId).toBe(session.id);
    expect(child.name).toContain('Completion Template (lane: Done)');
  });

  // ----------------------------------------------------------------
  // Test B: a card MOVED into a completion-target lane while the session is
  // already in progress (has already conversed) must NOT advance on entry —
  // only the NEXT turn completion while parked there triggers the move.
  //
  // Timing note: VCR replay turns settle in well under a second, so reliably
  // moving a card during the literal `running` millisecond would be flaky.
  // Instead we exercise the same guarantee deterministically with a two-turn
  // sequence: run turn 1 in a neutral lane (no target), MOVE the card into the
  // completion-target lane, assert lane entry alone does NOT advance it (the
  // exact regression this branch fixes), then run turn 2 and assert the turn
  // completion advances it. This honors "moved there while in progress" (an
  // active, already-conversing session) without depending on a race.
  // ----------------------------------------------------------------
  test('card moved into completion-target lane advances only on the next turn, not on entry', async ({
    page,
  }) => {
    const sessionName = 'Completion Move-In VCR Session';
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

    // "In Progress" → "Done" on completion. "To Do" has NO completion target.
    await configureCompletionTarget(page, 'In Progress', 'Done');

    // Add the draft to the neutral "To Do" lane and run turn 1 there. The
    // session is now an in-progress / already-conversed session, parked in a
    // lane with no completion target, so it must stay put.
    //
    // NOTE: cards are located by SESSION ID (not the seeded name) because turn
    // completion triggers summary generation, which can rename the session — so
    // matching on the original name becomes unreliable later in the test.
    await addSessionToLaneViaUI(page, 'To Do', sessionName);
    await expect(cardByIdInLane(page, 'To Do', session.id)).toBeVisible();

    await runSessionTurnViaUI(page, session.id);

    // Turn 1 completed; with no target on "To Do" the card never moved.
    await expect
      .poll(async () => findLaneOfSession(await getBoard(project.id), session.id), { timeout: 8000 })
      .toBe('To Do');

    // MOVE the card into the completion-target lane ("In Progress") via the UI.
    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });
    await moveCardViaUI(page, cardByIdInLane(page, 'To Do', session.id), 'In Progress');
    await expect(cardByIdInLane(page, 'In Progress', session.id)).toBeVisible();

    // KEY REGRESSION GUARD: entering the completion-target lane must NOT advance
    // the card by itself. Give any (incorrect) on-enter move time to fire, then
    // assert the card is still parked in "In Progress" — live and after reload.
    await expect
      .poll(async () => findLaneOfSession(await getBoard(project.id), session.id), { timeout: 8000 })
      .toBe('In Progress');
    await expect(cardByIdInLane(page, 'Done', session.id)).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await expect(cardByIdInLane(page, 'In Progress', session.id)).toBeVisible();
    await expect(cardByIdInLane(page, 'Done', session.id)).toHaveCount(0);
    expect(findLaneOfSession(await getBoard(project.id), session.id)).toBe('In Progress');

    // Now run turn 2 (a follow-up message). Completing this turn while parked in
    // the completion-target lane is the ONLY thing that should advance the card.
    await runFollowUpTurnViaUI(page, session.id);

    // The completion hook moves the card to "Done" on turn completion.
    await expectCardSettlesInLane(project.id, session.id, 'Done');

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });
    await expect(cardByIdInLane(page, 'Done', session.id)).toBeVisible({ timeout: 15000 });
    await expect(cardByIdInLane(page, 'In Progress', session.id)).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await expect(cardByIdInLane(page, 'Done', session.id)).toBeVisible();
    await expect(cardByIdInLane(page, 'In Progress', session.id)).toHaveCount(0);

    // Final server-side verification: the card lives in "Done".
    const finalBoard = await getBoard(project.id);
    const done = getLaneByName(finalBoard, 'Done');
    const card = done.cards.find((c: any) => (c.sessions || []).some((s: any) => s.id === session.id));
    expect(card).toBeTruthy();
    expect(card.laneId).toBe(doneLane.id);
  });
});
