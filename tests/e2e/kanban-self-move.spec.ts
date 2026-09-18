import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources, seedProject, seedSession, waitForChildSession, waitForChildSessions,
  navigateAndWait, getSession, stopSession,
} from './helpers';
import {
  addSessionToLaneViaUI, configureAutomatedLane, expectCardSettlesInLane,
  findCardOfSession, findLaneOfSession, getBoard, getLaneByName,
  PARKED_PROMPT, waitForPendingPrompt,
} from './kanbanLaneRunHelpers';

test.describe('Kanban unified lane routing', () => {
  test.describe.configure({ timeout: 120000 });
  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Kanban unified lane routing', process.cwd());
    await getBoard(project.id);
  });

  test.afterEach(async () => { await cleanupCreatedResources(); });

  test('moves immediately and starts structured destination automation while the source run is active', async ({ page, request }) => {
    const board = await getBoard(project.id);
    const source = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');
    const exit = getLaneByName(board, 'Review');
    const altExit = getLaneByName(board, 'To Do');
    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await configureAutomatedLane(page, project.id, source.name, { prompt: PARKED_PROMPT, targetLabel: done.name });
    await configureAutomatedLane(page, project.id, altExit.name, { prompt: PARKED_PROMPT, targetLabel: done.name });
    const workspace = await seedSession(project.id, { name: 'Self move workspace', prompt: 'root', startImmediately: false });

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await addSessionToLaneViaUI(page, source.name, workspace.name);
    const worker = await waitForChildSession(workspace.id, 15000);
    await waitForPendingPrompt(worker.id);

    const exitLaneUrl = `/api/projects/${project.id}/kanban/cards/by-workspace/${workspace.id}/lane`;
    const response = await request.put(exitLaneUrl, { data: { laneId: exit.id } });
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'moved', laneId: exit.id });
    expect((await getSession(worker.id)).status).toBe('running');
    expect(findLaneOfSession(await getBoard(project.id), workspace.id)).toBe(exit.name);
    expect(findCardOfSession(await getBoard(project.id), workspace.id).activeLaneRun).toBeNull();

    // A second manual move is also immediate and supersedes the first
    // destination run rather than declaring a deferred exit.
    const redeclare = await request.put(exitLaneUrl, { data: { laneId: altExit.id } });
    expect(redeclare.status()).toBe(200);
    await expect(redeclare.json()).resolves.toEqual({ status: 'moved', laneId: altExit.id });
    await expectCardSettlesInLane(project.id, workspace.id, altExit.name);
    expect(findCardOfSession(await getBoard(project.id), workspace.id).activeLaneRun.status).toBe('open');
    expect(findLaneOfSession(await getBoard(project.id), workspace.id)).not.toBe(done.name);
    const children = await waitForChildSessions(workspace.id, 2, 15000);
    expect(children).toHaveLength(2);
  });

  test('stopping a superseded source worker does not pause the destination run', async ({ page, request }) => {
    const board = await getBoard(project.id);
    const source = getLaneByName(board, 'In Progress');
    const done = getLaneByName(board, 'Done');
    const exit = getLaneByName(board, 'Review');
    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await configureAutomatedLane(page, project.id, source.name, { prompt: PARKED_PROMPT, targetLabel: done.name });
    await configureAutomatedLane(page, project.id, exit.name, { prompt: PARKED_PROMPT, targetLabel: done.name });
    const workspace = await seedSession(project.id, { name: 'Cancelled run workspace', prompt: 'root', startImmediately: false });

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await addSessionToLaneViaUI(page, source.name, workspace.name);
    const worker = await waitForChildSession(workspace.id, 15000);
    await waitForPendingPrompt(worker.id);

    const exitLaneUrl = `/api/projects/${project.id}/kanban/cards/by-workspace/${workspace.id}/lane`;
    const response = await request.put(exitLaneUrl, { data: { laneId: exit.id } });
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'moved', laneId: exit.id });
    await expect.poll(async () => (
      findLaneOfSession(await getBoard(project.id), workspace.id)
    )).toBe(exit.name);
    const destinationWorker = (await waitForChildSessions(workspace.id, 2, 15000))
      .find((session) => session.id !== worker.id);
    expect(destinationWorker).toBeTruthy();
    await waitForPendingPrompt(destinationWorker!.id);

    // The source worker no longer owns the card after the manual move.
    await stopSession(worker.id);

    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = await getBoard(project.id);
    expect(findLaneOfSession(after, workspace.id)).toBe(exit.name);
    const card = findCardOfSession(after, workspace.id);
    expect(card.activeLaneRun.status).toBe('open');
    expect(card.activeLaneRun.blockerKind).toBe('open_work');
    expect(card.activeLaneRun.pausedCount).toBe(0);
    expect(card.activeLaneRun.chosenExitLaneId).toBeNull();

    // Repeating the current destination remains idempotent.
    const late = await request.put(exitLaneUrl, { data: { laneId: exit.id } });
    expect(late.status()).toBe(200);
    await expect(late.json()).resolves.toEqual({ status: 'noop', laneId: exit.id });
  });
});
