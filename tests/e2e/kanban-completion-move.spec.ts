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
  getProjectSessions,
} from './helpers';
import {
  VCR_PROMPT,
  VCR_MODEL,
  LANE_AUTOMATION_PROMPT,
  getBoard,
  getLaneByName,
  findLaneOfSession,
  setLaneOnEnter,
  countChildSessions,
  cardInLane,
  openLaneSettings,
  configureAutomatedLane,
  addSessionToLaneViaUI,
  expectCardSettlesInLane,
} from './kanbanLaneRunHelpers';

/**
 * UI-driven E2E coverage for the lane "On Completion" move feature.
 *
 * Kanban lane hard-cutover contract (KanbanLaneRepository#assertConfiguration,
 * see `packages/server/src/db/KanbanLaneRepository.js`): a lane can only carry
 * a `completionTargetLaneId` if it also has on-entry automation (a prompt or a
 * template). There is no more legacy per-session completion signal — every
 * automatic completion is owned by a persisted, structured lane run
 * (`workflowSessionService.js`), and only the automation's own ON-ENTRY WORKER
 * ever participates in that run; a workspace's own top-level session cannot
 * (`attachRootSession` explicitly rejects attaching the workspace root as a
 * run's root). Practically: any lane with a completion target ALWAYS spawns a
 * worker child on entry, and only that worker's own, childless success can
 * advance the card.
 *
 * This file used to cover the OLD legacy per-session hook (a target-only lane,
 * no automation required, whose plain session's own completion moved the
 * card) plus an explicit `completionMode: 'legacy'` escape hatch. Both are
 * gone post-cutover — a target-only lane is now rejected at save time (client
 * and server), so those scenarios are not just outdated, they describe a
 * configuration the product no longer allows.
 *
 * What remains here:
 *  - Test 1: configure / change / clear a completion target through the UI,
 *    with the required on-entry automation present throughout.
 *  - Test 2: clearing the completion target (automation still configured)
 *    means the automation worker's own success stops the card in place.
 *  - Test 3: a real session lifecycle — automation worker spawns, completes,
 *    the card moves from source to target — end to end, through the UI.
 *  - Test 5 (template automation): completing into a destination lane whose
 *    on-entry automation is a TEMPLATE (not a prompt) still spawns the
 *    correctly-named child. Template automation is not covered anywhere in
 *    `kanban-lane-run-structured.spec.ts`.
 *
 * The former Test 3s / Test 3legacy / Test 4 / Test 6 / Test B scenarios are
 * intentionally NOT reinvented here: their coverage — a target lane's
 * on-entry automation firing exactly once on transition (AC-14), a scheduled
 * continuation holding the card open (AC-7), a manual move superseding an
 * open run (AC-9), and a root session advancing alone (AC-2) — already lives,
 * more thoroughly, in `kanban-lane-run-structured.spec.ts`. Reinventing them
 * here would only require the same automated-worker plumbing that file
 * already exercises, duplicating coverage rather than adding any.
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
  // Test 1: configure / change / clear the completion target through the UI.
  // A completion target requires on-entry automation, so automation is
  // configured once (through the UI) and left in place for the rest of the
  // test — only the target selection itself changes.
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
    await page.click('.modal-footer .btn-secondary'); // Cancel out, nothing saved yet

    // (a) Configure on-entry automation + the move to "Done", in one save
    // (target-only saves are rejected — see LaneSettingsModal's isValid rule).
    await configureAutomatedLane(page, project.id, 'In Progress', {
      prompt: LANE_AUTOMATION_PROMPT,
      targetLabel: 'Done',
    });

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
    // Automation is still required in the same save.
    await configureAutomatedLane(page, project.id, 'In Progress', {
      prompt: LANE_AUTOMATION_PROMPT,
      targetLabel: 'Review',
    });
    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await openLaneSettings(page, 'In Progress');
    await expect(page.locator('#completion-target-lane-select')).toHaveValue(reviewLane.id);
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionTargetLaneId).toBe(
      reviewLane.id
    );
    await page.click('.modal-footer .btn-secondary');

    // (c) Clear it back to "do not move" and confirm it persists as null. The
    // lane keeps its on-entry automation — it now simply stops in place.
    await configureAutomatedLane(page, project.id, 'In Progress', {
      prompt: LANE_AUTOMATION_PROMPT,
      targetLabel: 'Do not move automatically',
    });
    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await openLaneSettings(page, 'In Progress');
    await expect(page.locator('#completion-target-lane-select option:checked')).toHaveText(
      'Do not move automatically'
    );
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionTargetLaneId).toBeNull();
  });

  // ----------------------------------------------------------------
  // Test 2: clearing the completion target (automation stays configured)
  // means the automation worker's own success stops the card in place —
  // proven by a REAL session lifecycle so the production completion hook
  // actually runs and declines to move the card.
  // ----------------------------------------------------------------
  test('clearing the completion target leaves the automation worker stopped in place', async ({
    page,
  }) => {
    const sessionName = 'Completion Clear VCR Session';

    // On-entry automation only, no target yet.
    const board = await getBoard(project.id);
    const inProgressLane = getLaneByName(board, 'In Progress');
    await setLaneOnEnter(project.id, inProgressLane.id, { onEnterPrompt: VCR_PROMPT });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: sessionName,
      startImmediately: false,
    });

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Through the UI: first set a target, then clear it back to "do not move".
    // Automation must be re-affirmed in the same save each time.
    await configureAutomatedLane(page, project.id, 'In Progress', {
      prompt: VCR_PROMPT,
      targetLabel: 'Done',
    });
    await configureAutomatedLane(page, project.id, 'In Progress', {
      prompt: VCR_PROMPT,
      targetLabel: 'Do not move automatically',
    });

    // The cleared setting is persisted as null.
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionTargetLaneId).toBeNull();

    // Add the workspace to "In Progress" through the UI. Entering an
    // automated lane always spawns its on-entry worker.
    await addSessionToLaneViaUI(page, 'In Progress', sessionName);
    const worker = await waitForChildSession(workspace.id, 15000);
    expect(worker.parentSessionId).toBe(workspace.id);
    await waitForStatus(worker.id, 'waiting', 20000);

    // The worker's own, childless success has nowhere configured to go, so
    // the card stays exactly where it is — live and after reload.
    await expect
      .poll(async () => findLaneOfSession(await getBoard(project.id), workspace.id), { timeout: 8000 })
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
    expect(findLaneOfSession(await getBoard(project.id), workspace.id)).toBe('In Progress');
  });

  // ----------------------------------------------------------------
  // Test 3: a real session lifecycle moves the card from source to target —
  // the automation worker spawns on entry, completes with no descendants,
  // and its childless success advances the card exactly once.
  // ----------------------------------------------------------------
  test('a real automation worker completion moves the card from source lane to completion target', async ({
    page,
  }) => {
    const sessionName = 'Completion Move VCR Session';
    const board = await getBoard(project.id);
    const doneLane = getLaneByName(board, 'Done');

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: sessionName,
      startImmediately: false,
    });

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // Configure "In Progress" on-entry automation + "Done" target, through
    // the UI, in the same save.
    await configureAutomatedLane(page, project.id, 'In Progress', {
      prompt: VCR_PROMPT,
      targetLabel: 'Done',
    });
    expect(getLaneByName(await getBoard(project.id), 'In Progress').completionTargetLaneId).toBe(
      doneLane.id
    );

    // Add the workspace to "In Progress" through the UI — this spawns the
    // on-entry worker (the lane run's root), a child of the workspace. Do NOT
    // assert the card is still visible in "In Progress" here: VCR replay is
    // fast enough that the worker can spawn, complete, and move the card to
    // "Done" before this assertion would even run (see the identical fix in
    // the template-automation test below).
    await addSessionToLaneViaUI(page, 'In Progress', sessionName);

    const worker = await waitForChildSession(workspace.id, 15000);
    expect(worker.parentSessionId).toBe(workspace.id);
    await waitForStatus(worker.id, 'waiting', 20000);

    // The worker's own, childless success is what moves the card.
    await expectCardSettlesInLane(project.id, workspace.id, 'Done');

    // Back on the board, the card is shown in "Done" and gone from
    // "In Progress" — first live (no manual reload), then again after a reload.
    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });
    await expect(cardInLane(page, 'Done', sessionName)).toBeVisible({ timeout: 15000 });
    await expect(cardInLane(page, 'In Progress', sessionName)).toHaveCount(0);

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await expect(cardInLane(page, 'Done', sessionName)).toBeVisible();
    await expect(cardInLane(page, 'In Progress', sessionName)).toHaveCount(0);

    // "Done" has no on-enter automation, so no further child is spawned.
    expect(await countChildSessions(workspace.id, project.id)).toBe(1); // just the In Progress worker

    // Final server-side verification: the run closed, the card is in Done.
    const finalBoard = await getBoard(project.id);
    const done = getLaneByName(finalBoard, 'Done');
    const card = done.cards.find((c: any) => (c.sessions || []).some((s: any) => s.id === workspace.id));
    expect(card).toBeTruthy();
    expect(card.laneId).toBe(doneLane.id);
    expect(card.activeLaneRun).toBeNull();
  });

  // ----------------------------------------------------------------
  // Test 5: completing into a destination lane with an on-enter TEMPLATE
  // (rather than a prompt) moves the card AND runs the template. Template
  // on-entry automation is not covered by kanban-lane-run-structured.spec.ts,
  // which only exercises prompt-based automation.
  // ----------------------------------------------------------------
  test('completion move runs the destination lane on-enter template (spawns child session)', async ({
    page,
  }) => {
    const sessionName = 'Completion Template Parent';
    const board = await getBoard(project.id);
    const doneLane = getLaneByName(board, 'Done');

    // Seed a project template and attach it as the destination lane's
    // on-enter automation. Reuse VCR_PROMPT so the spawned child replays
    // from the committed cassette.
    const template = await seedProjectTemplate(project.id, {
      name: 'Completion Template',
      prompt: VCR_PROMPT,
      model: VCR_MODEL,
    });
    await setLaneOnEnter(project.id, doneLane.id, { onEnterTemplateId: template.id });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: sessionName,
      startImmediately: false,
    });

    await navigateAndWait(page, `${BASE_URL}/projects/${project.id}/kanban`, {
      waitFor: '.kanban-board',
    });

    // The source lane needs its own on-entry automation to carry a target.
    await configureAutomatedLane(page, project.id, 'In Progress', {
      prompt: VCR_PROMPT,
      targetLabel: 'Done',
    });
    await addSessionToLaneViaUI(page, 'In Progress', sessionName);

    // Identify the source-lane worker by its on-enter naming convention
    // rather than trusting "the first child found" — under VCR replay the
    // whole source-turn -> completion -> target-automation chain can finish
    // before the first poll even runs, so a plain waitForChildSession() could
    // non-deterministically return either worker (see the identical caution
    // in kanban-lane-run-structured.spec.ts's AC-14 test).
    await waitForChildSession(workspace.id, 15000);
    let sourceWorker: any;
    await expect
      .poll(
        async () => {
          const all = await getProjectSessions(project.id);
          sourceWorker = all.find(
            (s: any) => s.parentSessionId === workspace.id && s.name.includes('lane: In Progress')
          );
          return Boolean(sourceWorker);
        },
        { timeout: 15000 }
      )
      .toBe(true);
    await waitForStatus(sourceWorker.id, 'waiting', 20000);

    // The source worker's childless success moves the card to Done...
    await expectCardSettlesInLane(project.id, workspace.id, 'Done');

    // ...and Done's on-enter TEMPLATE automation spawns a second child,
    // named after the template.
    let targetWorker: any;
    await expect
      .poll(
        async () => {
          const all = await getProjectSessions(project.id);
          targetWorker = all.find(
            (s: any) => s.parentSessionId === workspace.id && s.name.includes('lane: Done')
          );
          return Boolean(targetWorker);
        },
        { timeout: 15000 }
      )
      .toBe(true);
    expect(targetWorker.id).not.toBe(sourceWorker.id);
    expect(targetWorker.name).toContain('Completion Template (lane: Done)');
  });
});
