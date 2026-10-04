import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  seedProject,
  seedSession,
  seedProjectTemplate,
  navigateAndWait,
  openSessionOverlay,
  getSession,
  getProjectSessions,
  waitForChildSession,
  waitForStatus,
} from './helpers';
import {
  VCR_PROMPT,
  VCR_MODEL,
  PARKED_PROMPT,
  getBoard,
  getLaneByName,
  findCardOfSession,
  findLaneOfSession,
  configureAutomatedLane,
  addSessionToLaneViaUI,
  expectCardSettlesInLane,
  waitForPendingPrompt,
} from './kanbanLaneRunHelpers';

/**
 * E2E coverage for a multi-session chain sharing ONE lane run (root A creates
 * child B via template chaining, both members of the same structured lane
 * run — packages/server/src/services/workflowSessionService.js's subtree
 * roll-up). This was previously covered only at the unit level (see
 * workflowSessionService.test.js's "AC-4: arbitrary depth" test, which
 * manipulates DB rows directly); no end-to-end test drove a real multi-hop
 * chain through the UI/REST surface until this file.
 *
 * Recipe: lane automation is a TEMPLATE (Chain A) with nextTemplateId
 * pointing at a second template (Chain B). When A's turn completes,
 * checkAndTriggerNextTemplate() creates B as A's child — inheriting the same
 * lane_run_id while A's own_work_state is still 'open' (the template trigger
 * runs inside handleTurnCompletion, before finalizeOwnWorkCompletion). B's
 * prompt (PARKED_PROMPT) gates on a user question instead of completing, so
 * the run stays open and the card stays put until the test answers it — at
 * which point B finishes, the whole subtree succeeds, and the card advances
 * exactly once.
 */
test.describe('Kanban deep lane-run chains', () => {
  test.describe.configure({ timeout: 120000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Deep Chain Test', '/tmp/test-kanban-deep-chain');
    await getBoard(project.id);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('a template-chained child (A->B) joins the same lane run and holds the card until the subtree completes', async ({
    page,
  }) => {
    const board = await getBoard(project.id);
    const source = getLaneByName(board, 'To Do');
    const done = getLaneByName(board, 'Done');

    const templateB = await seedProjectTemplate(project.id, {
      name: 'Chain B',
      prompt: PARKED_PROMPT,
    });
    const templateA = await seedProjectTemplate(project.id, {
      name: 'Chain A',
      prompt: VCR_PROMPT,
      model: VCR_MODEL,
      nextTemplateId: templateB.id,
    });

    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await configureAutomatedLane(page, project.id, source.name, {
      templateLabel: templateA.name,
      targetLabel: done.name,
    });

    const workspace = await seedSession(project.id, {
      prompt: 'Workspace root',
      name: 'Deep Chain Workspace',
      startImmediately: false,
    });

    await addSessionToLaneViaUI(page, source.name, workspace.name);

    // Worker A: the lane run's root, a direct child of the workspace.
    const workerA = await waitForChildSession(workspace.id, 15000);
    expect(workerA.parentSessionId).toBe(workspace.id);
    await waitForStatus(workerA.id, 'waiting', 20000);

    // Worker B: created by checkAndTriggerNextTemplate() as A's own child,
    // during A's post-turn completion. Poll separately — B's creation can
    // land a beat after A's status flips to 'waiting'.
    let workerB: any;
    await expect
      .poll(
        async () => {
          const all = await getProjectSessions(project.id);
          workerB = all.find((s: any) => s.parentSessionId === workerA.id);
          return Boolean(workerB);
        },
        { timeout: 15000 }
      )
      .toBe(true);

    // B joined the SAME lane run as A (not a new one) — the whole subtree,
    // not just the root, must succeed before the card can advance.
    const freshA = await getSession(workerA.id);
    const freshB = await getSession(workerB.id);
    expect(freshA.laneRunId).toBeTruthy();
    expect(freshB.laneRunId).toBe(freshA.laneRunId);

    // B parks on its own question prompt instead of completing.
    await waitForPendingPrompt(workerB.id);

    // The run stays open and the card stays put while B is parked.
    let boardNow = await getBoard(project.id);
    expect(findLaneOfSession(boardNow, workspace.id)).toBe(source.name);
    const parkedCard = findCardOfSession(boardNow, workspace.id);
    expect(parkedCard.activeLaneRun).toBeTruthy();
    expect(parkedCard.activeLaneRun.status).toBe('open');

    // Still exactly one grandchild (B) — no duplicate/parallel chain work.
    const descendantsOfA = (await getProjectSessions(project.id)).filter(
      (s: any) => s.parentSessionId === workerA.id
    );
    expect(descendantsOfA).toHaveLength(1);

    // Release B's parked prompt via the UI (the proven cassette-safe path —
    // see kanban-self-move.spec.ts, which drives the identical continuation).
    await navigateAndWait(page, `/sessions/${workerB.id}`, {
      waitFor: '[data-testid="session-detail"][data-ready="true"]',
    });
    const prompt = (await openSessionOverlay(page)).locator('.agent-prompt-card');
    await prompt.locator('.option-card').first().click();
    await prompt.locator('button.prompt-primary-action').click();

    // B finishes -> the whole subtree succeeds -> the card advances exactly once.
    await expectCardSettlesInLane(project.id, workspace.id, done.name, 60000);
    boardNow = await getBoard(project.id);
    const settledCard = findCardOfSession(boardNow, workspace.id);
    expect(settledCard.laneId).toBe(done.id);
    expect(settledCard.activeLaneRun).toBeNull();

    // No further children anywhere in the chain (Done has no automation).
    const allSessionsAfter = await getProjectSessions(project.id);
    expect(allSessionsAfter.filter((s: any) => s.parentSessionId === workspace.id)).toHaveLength(1); // just A
    expect(allSessionsAfter.filter((s: any) => s.parentSessionId === workerA.id)).toHaveLength(1); // just B

    // Stays in Done — no further, duplicate movement.
    await new Promise((r) => setTimeout(r, 1500));
    expect(findLaneOfSession(await getBoard(project.id), workspace.id)).toBe(done.name);
  });
});
