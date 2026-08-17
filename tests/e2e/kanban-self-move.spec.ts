import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources, seedProject, seedSession, waitForChildSession,
  navigateAndWait, openSessionOverlay, getSession,
} from './helpers';
import {
  addSessionToLaneViaUI, configureAutomatedLane, expectCardSettlesInLane,
  findCardOfSession, findLaneOfSession, getBoard, getLaneByName, waitForPendingPrompt,
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
    const source = getLaneByName(board, 'Review PR');
    const done = getLaneByName(board, 'Done');
    const exit = getLaneByName(board, 'Needs attention');
    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board' });
    await configureAutomatedLane(page, project.id, source.name, { prompt: PARKED_PROMPT, targetLabel: done.name });
    const workspace = await seedSession(project.id, { name: 'Self move workspace', prompt: 'root', startImmediately: false });

    await page.reload();
    await expect(page.locator('.kanban-board')).toBeVisible();
    await addSessionToLaneViaUI(page, source.name, workspace.name);
    const worker = await waitForChildSession(workspace.id, 15000);
    await waitForPendingPrompt(worker.id);

    const response = await request.put(
      `/api/projects/${project.id}/kanban/cards/by-workspace/${workspace.id}/exit-lane`,
      { data: { laneId: exit.id } }
    );
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ deferred: true, chosenExitLaneId: exit.id }));
    expect((await getSession(worker.id)).status).toBe('running');
    expect(findLaneOfSession(await getBoard(project.id), workspace.id)).toBe(source.name);
    expect(findCardOfSession(await getBoard(project.id), workspace.id).activeLaneRun.status).toBe('open');

    await navigateAndWait(page, `/sessions/${worker.id}`, { waitFor: '[data-testid="session-detail"][data-ready="true"]' });
    const prompt = (await openSessionOverlay(page)).locator('.agent-prompt-card');
    await prompt.locator('.option-card').first().click();
    await prompt.locator('button.prompt-primary-action').click();
    await expectCardSettlesInLane(project.id, workspace.id, exit.name, 60000);
  });
});
