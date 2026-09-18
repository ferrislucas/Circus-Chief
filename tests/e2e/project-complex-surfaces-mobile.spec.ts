import { test, expect } from '@playwright/test';
import {
  cleanupCreatedResources,
  navigateAndWait,
  seedCommandButton,
  seedKanbanCard,
  seedKanbanLane,
  seedProject,
  seedProjectTemplate,
  seedSession,
} from './helpers';

const IPHONE_12_MINI = { width: 375, height: 812 };

async function expectNoDocumentOverflow(page: import('@playwright/test').Page) {
  const metrics = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
}

test.describe('Project complex surfaces — iPhone 12 mini audit', () => {
  let project: any;

  test.beforeEach(async ({ page }) => {
    project = await seedProject('Visual audit project with a deliberately long console name '.repeat(4), process.cwd());
    const session = await seedSession(project.id, {
      prompt: 'Exercise the Kanban audit surface.',
      name: 'A workspace with a long name to pressure the compact Kanban card layout',
      startImmediately: false,
    });
    const lane = await seedKanbanLane(project.id, { name: 'A long active lane name for narrow-board testing' });
    await seedKanbanCard(project.id, { sessionId: session.id, laneId: lane.id });
    await seedCommandButton(project.id, {
      label: 'A deliberately long Circus Command label for a compact table',
      command: 'node -e "console.log(\'mobile command surface audit with long output\')"',
    });
    await seedProjectTemplate(project.id, {
      name: 'A deliberately long template name for phone card wrapping',
      prompt: 'Use this template to verify that long operational copy remains contained in the project surface.',
      showInQuickResponses: true,
    });
    await page.setViewportSize(IPHONE_12_MINI);
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('keeps project control surfaces reachable in both Kanban layouts', async ({ page }) => {
    await navigateAndWait(page, `/projects/${project.id}/kanban`, { waitFor: '.kanban-board', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    expect((await page.getByRole('button', { name: 'Use list layout' }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    expect((await page.locator('.lane-settings-btn').first().boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: 'test-results/visual-audit/kanban-vertical-375x812.png', fullPage: true });

    await page.getByRole('button', { name: 'Use column layout' }).click();
    const laneScroller = page.locator('.kanban-lanes-container');
    await expect(laneScroller).toHaveClass(/layout-horizontal/);
    await expectNoDocumentOverflow(page);
    await laneScroller.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(page.locator('.add-lane-btn')).toBeInViewport();
    await page.screenshot({ path: 'test-results/visual-audit/kanban-horizontal-375x812.png', fullPage: true });

    await navigateAndWait(page, `/projects/${project.id}/circus-time`, { waitFor: '.circus-time-tab', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    const circusTimeAction = page.getByRole('link', { name: 'Get Circus Time' });
    await circusTimeAction.scrollIntoViewIfNeeded();
    await expect(circusTimeAction).toBeInViewport();
    expect((await circusTimeAction.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: 'test-results/visual-audit/circus-time-375x812.png', fullPage: true });

    await navigateAndWait(page, `/projects/${project.id}/commands`, { waitFor: '.command-buttons-panel', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    const newCommand = page.getByTestId('new-command-btn');
    await newCommand.scrollIntoViewIfNeeded();
    await expect(newCommand).toBeInViewport();
    expect((await newCommand.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: 'test-results/visual-audit/project-commands-375x812.png', fullPage: true });

    await navigateAndWait(page, `/projects/${project.id}/templates`, { waitFor: '.templates-panel', timeout: 15000 });
    await expectNoDocumentOverflow(page);
    const newTemplate = page.getByTestId('new-template-btn');
    await newTemplate.scrollIntoViewIfNeeded();
    await expect(newTemplate).toBeInViewport();
    expect((await newTemplate.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: 'test-results/visual-audit/templates-375x812.png', fullPage: true });
  });
});
