import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources, seedProject, seedSession, waitForChildSession,
  navigateAndWait, openSessionOverlay, getSession, stopSession,
} from './helpers';
import {
  addSessionToLaneViaUI, configureAutomatedLane, expectCardSettlesInLane,
  findCardOfSession, findLaneOfSession, getBoard, getLaneByName, laneByTitle,
  waitForPendingPrompt,
} from './kanbanLaneRunHelpers';

const PARKED_PROMPT = 'E2E demo: ask the user which deployment target to use before proceeding.';
test.describe('Kanban exit-lane declaration', () => {
  test.describe.configure({ timeout: 120000 });
  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kanban exit-lane declaration', process.cwd());
    await getBoard(project.id);
  });

  test.afterEach(async () => { await cleanupCreatedResources(); });

  test('a worker declaring its own exit is not aborted and takes that exit on completion', async ({ page, request }) => {
    const board = await getBoard(project.id);
    const source = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');
    const exit = getLaneByName(board, 'Review');
    const altExit = getLaneByName(board, 'To Do');
    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await configureAutomatedLane(page, project.id, source.name, { prompt: PARKED_PROMPT, targetLabel: done.name });
    const workspace = await seedSession(project.id, { name: 'Self move workspace', prompt: 'root', startImmediately: false });

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await addSessionToLaneViaUI(page, source.name, workspace.name);
    const worker = await waitForChildSession(workspace.id, 15000);
    await waitForPendingPrompt(worker.id);

    const exitLaneUrl = `/api/projects/${project.id}/kanban/cards/by-workspace/${workspace.id}/exit-lane`;
    const response = await request.put(exitLaneUrl, { data: { laneId: exit.id } });
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ deferred: true, chosenExitLaneId: exit.id }));
    expect((await getSession(worker.id)).status).toBe('running');
    expect(findLaneOfSession(await getBoard(project.id), workspace.id)).toBe(source.name);
    expect(findCardOfSession(await getBoard(project.id), workspace.id).activeLaneRun.status).toBe('open');

    // The declaration is pushed to the open board over WebSocket: the card
    // shows the chosen exit without a reload.
    const chip = laneByTitle(page, source.name).locator('.lane-run-exit-lane');
    await expect(chip).toHaveText(`Exit lane: ${exit.name}`);

    // Re-declaring overwrites the previous choice; the last declaration wins.
    const redeclare = await request.put(exitLaneUrl, { data: { laneId: altExit.id } });
    expect(redeclare.status()).toBe(200);
    await expect(redeclare.json()).resolves.toEqual(expect.objectContaining({ deferred: true, chosenExitLaneId: altExit.id }));
    await expect(chip).toHaveText(`Exit lane: ${altExit.name}`);

    await navigateAndWait(page, `/sessions/${worker.id}`, { waitFor: '[data-testid="session-detail"][data-ready="true"]' });
    const prompt = (await openSessionOverlay(page)).locator('.agent-prompt-card');
    await prompt.locator('.option-card').first().click();
    await prompt.locator('button.prompt-primary-action').click();
    // The card takes the declared exit, not the lane's configured completion target.
    await expectCardSettlesInLane(project.id, workspace.id, altExit.name, 60000);
    expect(findLaneOfSession(await getBoard(project.id), workspace.id)).not.toBe(done.name);
  });

  test('a cancelled run discards the declaration instead of moving the card', async ({ page, request }) => {
    const board = await getBoard(project.id);
    const source = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');
    const exit = getLaneByName(board, 'Review');
    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await configureAutomatedLane(page, project.id, source.name, { prompt: PARKED_PROMPT, targetLabel: done.name });
    const workspace = await seedSession(project.id, { name: 'Cancelled run workspace', prompt: 'root', startImmediately: false });

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await addSessionToLaneViaUI(page, source.name, workspace.name);
    const worker = await waitForChildSession(workspace.id, 15000);
    await waitForPendingPrompt(worker.id);

    const exitLaneUrl = `/api/projects/${project.id}/kanban/cards/by-workspace/${workspace.id}/exit-lane`;
    const response = await request.put(exitLaneUrl, { data: { laneId: exit.id } });
    expect(response.status()).toBe(200);

    // Stop the parked worker: the run is cancelled while the declaration is
    // still outstanding. The declaration must be discarded, never applied —
    // the card stays in the source lane.
    await stopSession(worker.id);

    await expect.poll(async () => (
      findCardOfSession(await getBoard(project.id), workspace.id)?.activeLaneRun?.status
    ), { timeout: 15000 }).toBe('cancelled');

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = await getBoard(project.id);
    expect(findLaneOfSession(after, workspace.id)).toBe(source.name);
    const card = findCardOfSession(after, workspace.id);
    expect(card.activeLaneRun.status).toBe('cancelled');
    // Kept on the terminal run for diagnosis, but never applied as a move.
    expect(card.activeLaneRun.chosenExitLaneId).toBe(exit.id);

    // Once the run is terminal there is nothing left to declare an exit for.
    const late = await request.put(exitLaneUrl, { data: { laneId: exit.id } });
    expect(late.status()).toBe(409);
    await expect(late.json()).resolves.toEqual(expect.objectContaining({ code: 'KANBAN_NO_ACTIVE_LANE_RUN' }));
  });
});
