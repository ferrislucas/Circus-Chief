import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  cleanupCreatedResources,
  navigateAndWait,
  openSessionOverlay,
  seedProject,
  seedSession,
  updateSessionStatus,
  waitForSessionToExist,
} from './helpers';

async function expectTextareaCanResize(page: Page, wrapper: Locator) {
  const textarea = wrapper.locator('textarea');
  const handle = wrapper.locator('.resize-handle');

  await expect(textarea).toBeVisible();
  await expect(handle).toBeVisible();

  const before = await textarea.boundingBox();
  const handleBox = await handle.boundingBox();
  expect(before).toBeTruthy();
  expect(handleBox).toBeTruthy();

  await handle.hover();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2 + 80, {
    steps: 8,
  });
  await page.mouse.up();

  await expect.poll(async () => {
    const after = await textarea.boundingBox();
    return after?.height ?? 0;
  }).toBeGreaterThan(before!.height + 40);
}

test.describe('Prompt textarea resizing', () => {
  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('new session prompt resizes when dragging the handle', async ({ page }) => {
    const project = await seedProject('Prompt Resize New Session', '/tmp/prompt-resize-new');

    await navigateAndWait(page, `/projects/${project.id}/sessions/new`, {
      waitFor: 'textarea#prompt',
      timeout: 15000,
    });

    const wrapper = page.locator('.resizable-textarea-wrapper').filter({
      has: page.locator('textarea#prompt'),
    });
    await expectTextareaCanResize(page, wrapper);
  });

  test('session chat overlay prompt resizes when dragging the handle', async ({ page }) => {
    const project = await seedProject('Prompt Resize Overlay', '/tmp/prompt-resize-overlay');
    const session = await seedSession(project.id, {
      prompt: 'Initial prompt',
      name: 'Resizable Overlay Session',
    });
    await waitForSessionToExist(session.id);
    await updateSessionStatus(session.id, 'waiting');

    await navigateAndWait(page, `/sessions/${session.id}`, {
      waitFor: '[data-testid="session-detail"][data-ready="true"]',
      timeout: 15000,
    });
    const overlay = await openSessionOverlay(page);
    await page.waitForTimeout(400);
    const wrapper = overlay.locator('.input-form .resizable-textarea-wrapper');
    await expectTextareaCanResize(page, wrapper);
  });
});
