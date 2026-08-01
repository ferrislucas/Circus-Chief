import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  seedProject,
  seedSession,
  seedProjectTemplate,
  cleanupCreatedResources,
  navigateAndWait,
  waitForStatus,
  waitForChildSession,
  updateSessionStatus,
} from './helpers';
import {
  VCR_PROMPT,
  VCR_MODEL,
  getBoard,
  getLaneByName,
  findLaneOfSession,
  setLaneOnEnter,
  countChildSessions,
  cardInLane,
  cardByIdInLane,
  openLaneSettings,
  saveLaneSettings,
  configureCompletionTarget,
  addSessionToLaneViaUI,
  runSessionTurnViaUI,
  expectCardSettlesInLane,
  moveCardViaUI,
  runFollowUpTurnViaUI,
} from './kanbanLaneRunHelpers';

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
 *  - Test 3s: the same move, but with on-enter automation configured on the
 *    SOURCE lane too, so a REAL structured lane run drives it end-to-end.
 *  - Test 3legacy: the same move again, with `completionMode` pinned explicitly
 *    to `legacy` — the deliberately-supported escape hatch for callers that
 *    still want the old single-session signal.
 *  - Test 4: completing into a destination lane that has an on-enter CUSTOM PROMPT
 *    creates a child session (the automation runs as part of the completion move).
 *  - Test 5: same as Test 4 but the destination lane runs an on-enter TEMPLATE.
 *
 * No REST mocking. The REST API is used only for seeding setup (sessions,
 * templates, destination-lane on-enter automation) and for final state
 * verification. Every user-observable action for the feature under test —
 * configuring the completion target, adding the card, starting the session —
 * happens through the UI.
 *
 * PR #1066 remediation (F1): this file used to force every lane back to
 * `completionMode: 'legacy'` after configuring a completion target, hiding the
 * structured lane-run path — which is what a real target selection opts into
 * by default (KanbanLaneRepository#update) — from this suite entirely. Board
 * / lane / card plumbing now lives in `kanbanLaneRunHelpers.ts`, shared with
 * `kanban-lane-run-structured.spec.ts` (the dedicated structured-mode E2E
 * suite), and no helper here silently forces a completion mode any more.
 * Most tests below still end up exercising the legacy per-session hook simply
 * because their source lane has no on-enter automation at the time its card
 * is added — see kanbanService.js's `hasOnEnterAutomation` gate — which is
 * itself real, load-bearing coverage: a completion target with no automation
 * must keep behaving exactly as it always has, never opening a dead lane run.
 */

// ============================================================
// Tests
// ============================================================

test.describe('Kanban lane completion move', () => {
  test.describe.configure({ timeout: 120000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kanban Completion Move Test', '/tmp/test-kanban-completion');
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
    await configureCompletionTarget(page, project.id, 'In Progress', 'Review');
    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await openLaneSettings(page, 'In Progress');
    await expect(page.locator('#completion-target-lane-select')).toHaveValue(reviewLane.id);
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionTargetLaneId).toBe(
      reviewLane.id
    );
    await page.click('.modal-footer .btn-secondary');

    // (c) Clear it back to "do not move" and confirm it persists as null.
    await configureCompletionTarget(page, project.id, 'In Progress', 'Do not move automatically');
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
    await configureCompletionTarget(page, project.id, 'In Progress', 'Done');
    await configureCompletionTarget(page, project.id, 'In Progress', 'Do not move automatically');

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
    await configureCompletionTarget(page, project.id, 'In Progress', 'Done');

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
  // Test 3s (PR #1066 remediation, F1): same move as Test 3, but the source
  // lane ALSO has on-enter automation, so entering it (with a completion
  // target already configured) opens a REAL structured lane run — the
  // on-entry worker becomes the run's root, and its own successful,
  // childless completion is what advances the card (AC-2). This is the "at
  // least one completion case runs in structured mode end-to-end" case for
  // this file; the broader structured-mode surface (transient limits,
  // permanent failures, scheduled descendants, manual-move supersession,
  // target on-entry-exactly-once) has its own dedicated coverage in
  // kanban-lane-run-structured.spec.ts.
  // ----------------------------------------------------------------
  test('Session completion moves card from source lane to completion target (structured mode, real lane run)', async ({
    page,
  }) => {
    const sessionName = 'Structured Completion Move Session';
    const board = await getBoard(project.id);
    const inProgressLane = getLaneByName(board, 'In Progress');
    const doneLane = getLaneByName(board, 'Done');

    // The source lane has its own on-enter automation, configured BEFORE the
    // completion target so the target select's later PATCH auto-derives
    // completionMode='structured' (KanbanLaneRepository#update, F3) on a lane
    // that genuinely has an on-entry worker to own the run.
    await setLaneOnEnter(project.id, inProgressLane.id, { onEnterPrompt: VCR_PROMPT });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: sessionName,
      startImmediately: false,
    });

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    await configureCompletionTarget(page, project.id, 'In Progress', 'Done');
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionMode).toBe('structured');

    await addSessionToLaneViaUI(page, 'In Progress', sessionName);

    // Entering the lane spawns the on-entry worker — the lane run's root —
    // as a child of the workspace, NOT of the workspace itself completing.
    const worker = await waitForChildSession(workspace.id, 15000);
    expect(worker.parentSessionId).toBe(workspace.id);
    await waitForStatus(worker.id, 'waiting', 20000);

    // The worker's own, childless success is what moves the card (AC-2) —
    // this is the real structured engine, not the legacy per-session hook.
    await expectCardSettlesInLane(project.id, workspace.id, 'Done');

    const finalBoard = await getBoard(project.id);
    const done = getLaneByName(finalBoard, 'Done');
    const card = done.cards.find((c: any) => (c.sessions || []).some((s: any) => s.id === workspace.id));
    expect(card).toBeTruthy();
    expect(card.laneId).toBe(doneLane.id);
    expect(card.activeLaneRun).toBeNull(); // run completed and cleared
  });

  // ----------------------------------------------------------------
  // Test 3legacy (PR #1066 remediation, F1): `completionMode: 'legacy'` is a
  // deliberately supported, explicit escape hatch — pin it directly via the
  // REST API (not achievable through the lane-settings UI, which only
  // exposes the target-lane selector) and confirm the original single-session
  // completion signal still moves the card correctly. This is the "keep a
  // separate, explicit legacy case, labeled as such" half of the remediation
  // — legacy is not being conflated behind `configureCompletionTarget` any
  // more; a caller that wants it must ask for it by name.
  // ----------------------------------------------------------------
  test('Session completion moves card from source lane to completion target (explicit legacy mode)', async ({
    page,
  }) => {
    const sessionName = 'Explicit Legacy Completion Session';
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

    await configureCompletionTarget(page, project.id, 'In Progress', 'Done');
    // Explicitly pin legacy mode (the UI never sets this directly).
    const inProgressLane = getLaneByName(await getBoard(project.id), 'In Progress');
    await setLaneOnEnter(project.id, inProgressLane.id, { completionMode: 'legacy' });
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionMode).toBe('legacy');

    await addSessionToLaneViaUI(page, 'In Progress', sessionName);
    await expect(cardInLane(page, 'In Progress', sessionName)).toBeVisible();

    await runSessionTurnViaUI(page, session.id);
    await expectCardSettlesInLane(project.id, session.id, 'Done');

    const finalBoard = await getBoard(project.id);
    const done = getLaneByName(finalBoard, 'Done');
    const card = done.cards.find((c: any) => (c.sessions || []).some((s: any) => s.id === session.id));
    expect(card).toBeTruthy();
    expect(card.laneId).toBe(doneLane.id);
    // Legacy mode never opens a lane run.
    expect(card.activeLaneRun).toBeNull();
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

    await configureCompletionTarget(page, project.id, 'In Progress', 'Done');
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

    await configureCompletionTarget(page, project.id, 'In Progress', 'Done');
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
  // Test 6: completing the original/root session must not advance a lane whose
  // on-enter automation has created an active child session to do that lane's
  // work. This reproduces the observed failure mode where the parent session
  // finished after moving the workspace card into Implementation, causing the
  // card to jump to Testing before the Implementation child finished.
  // ----------------------------------------------------------------
  test('root completion does not advance a lane while its on-enter child is still running', async ({
    page,
  }) => {
    const sessionName = 'Completion Guard Parent';
    const board = await getBoard(project.id);
    const inProgressLane = getLaneByName(board, 'In Progress');

    // "In Progress" represents the implementation lane: entering it creates a
    // child session to perform the work, and completion should eventually move
    // the workspace to Done.
    await setLaneOnEnter(project.id, inProgressLane.id, { onEnterPrompt: VCR_PROMPT });

    const session = await seedSession(project.id, {
      prompt: VCR_PROMPT,
      name: sessionName,
      model: VCR_MODEL,
      startImmediately: false,
    });

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Adding the root workspace to In Progress fires the real on-enter prompt
    // and creates a child implementation session. The completion target is NOT
    // configured yet: the on-enter child replays its VCR turn almost instantly,
    // and a child's own completion legitimately advances the card. Configuring
    // the target only after that turn has settled keeps this child completion
    // from moving the card, isolating the behavior under test (the *root*
    // completing while the child is still active).
    await addSessionToLaneViaUI(page, 'In Progress', sessionName);
    const child = await waitForChildSession(session.id, 15000);
    expect(child).toBeTruthy();
    expect(child.parentSessionId).toBe(session.id);
    expect(child.name).toContain('Lane prompt (lane: In Progress)');

    // Let the child's on-enter turn finish (no target configured yet, so this
    // does not move the card), then park it as running so it represents the
    // lane's still-in-progress work for the remainder of the test.
    await waitForStatus(child.id, 'waiting', 15000);
    await updateSessionStatus(child.id, 'running');
    await waitForStatus(child.id, 'running', 10000);

    // Now configure the completion target. With the child held running, the only
    // completion that follows is the root's.
    await configureCompletionTarget(page, project.id, 'In Progress', 'Done');

    await runSessionTurnViaUI(page, session.id);

    // Regression assertion: parent/root completion is not the lane work
    // completion, so the card must stay in In Progress while the child remains
    // running. The current bug moves it to Done here.
    await expect
      .poll(async () => findLaneOfSession(await getBoard(project.id), session.id), { timeout: 8000 })
      .toBe('In Progress');

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });
    await expect(cardByIdInLane(page, 'In Progress', session.id)).toBeVisible();
    await expect(cardByIdInLane(page, 'Done', session.id)).toHaveCount(0);
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
    await configureCompletionTarget(page, project.id, 'In Progress', 'Done');

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
