import { test, expect } from '@playwright/test';
import {
  cleanupAll,
  cleanupTemplates,
  getSession,
  navigateAndWait,
  openSessionOverlay,
  seedGlobalTemplate,
  seedProject,
  seedProjectTemplate,
  seedSession,
  setNextTemplate,
  TEST_PREFIX,
  updateSessionStatus,
} from './helpers';

async function openOverlayAndWaitForTemplates(page, sessionId: string) {
  const templatesLoaded = page.waitForResponse(
    (resp) => resp.url().includes('/templates') && resp.status() === 200,
    { timeout: 30000 }
  );

  await navigateAndWait(page, `/sessions/${sessionId}/summary`);
  await openSessionOverlay(page);
  await templatesLoaded;
}

async function waitForSessionFields(sessionId: string, predicate: (session: any) => boolean, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const session = await getSession(sessionId);
    if (session && predicate(session)) return session;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Session ${sessionId} did not reach expected fields`);
}

test.describe('Use Template in existing session', () => {
  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('selector lists project and global templates on editable sessions and hides while running', async ({ page }) => {
    const project = await seedProject('Use Template Visibility', '/tmp/use-template-existing-visibility');
    await seedProjectTemplate(project.id, {
      name: 'Project Apply Template',
      prompt: 'Project prompt',
    });
    await seedGlobalTemplate({
      name: `${TEST_PREFIX}Global Apply Template`,
      prompt: 'Global prompt',
    });
    const waitingSession = await seedSession(project.id, {
      prompt: 'Waiting prompt',
      name: 'Waiting Apply Template',
      startImmediately: false,
    });

    await openOverlayAndWaitForTemplates(page, waitingSession.id);

    const selector = page.locator('.template-apply-selector select');
    await expect(selector).toBeVisible();
    await expect(page.locator('.template-apply-selector optgroup[label="Project Templates"]')).toHaveCount(1);
    await expect(page.locator('.template-apply-selector optgroup[label="Global Templates"]')).toHaveCount(1);
    await expect(selector.locator('option', { hasText: 'Project Apply Template' })).toHaveCount(1);
    await expect(selector.locator('option', { hasText: 'Global Apply Template' })).toHaveCount(1);

    const runningSession = await seedSession(project.id, {
      prompt: 'Running prompt',
      name: 'Running Apply Template',
      startImmediately: false,
    });
    await updateSessionStatus(runningSession.id, 'running');

    await openOverlayAndWaitForTemplates(page, runningSession.id);
    await expect(page.locator('.template-apply-selector')).not.toBeVisible();
  });

  test('selecting a template appends its prompt and resets the selector', async ({ page }) => {
    const project = await seedProject('Use Template Prompt', '/tmp/use-template-existing-prompt');
    const template = await seedProjectTemplate(project.id, {
      name: 'Append Prompt Template',
      prompt: 'Template prompt content',
    });
    const session = await seedSession(project.id, {
      prompt: 'Original draft',
      name: 'Append Prompt Session',
      startImmediately: false,
    });

    await openOverlayAndWaitForTemplates(page, session.id);

    const textarea = page.locator('textarea').first();
    await textarea.fill('Existing draft');
    const selector = page.locator('.template-apply-selector select');
    await selector.selectOption(template.id);

    await expect(textarea).toHaveValue('Existing draft\n\nTemplate prompt content');
    await expect(selector).toHaveValue('');
  });

  test('selecting a template applies compatible settings and preserves nextTemplateId', async ({ page }) => {
    const project = await seedProject('Use Template Settings', '/tmp/use-template-existing-settings');
    const nextTemplate = await seedProjectTemplate(project.id, {
      name: 'Existing Next Template',
      prompt: 'Next prompt',
    });
    const applyTemplate = await seedProjectTemplate(project.id, {
      name: 'Settings Apply Template',
      prompt: 'Settings prompt',
      model: 'claude-opus-4-8',
      mode: 'yolo',
      thinkingEnabled: true,
      effortLevel: 'high',
      gitMode: 'worktree',
      gitBranch: 'should-not-apply',
      nextTemplateId: nextTemplate.id,
    });
    const session = await seedSession(project.id, {
      prompt: 'Initial prompt',
      name: 'Settings Apply Session',
      startImmediately: false,
      mode: 'standard',
      model: 'claude-sonnet-4-6',
      effortLevel: 'auto',
    });
    await setNextTemplate(session.id, nextTemplate.id);

    await openOverlayAndWaitForTemplates(page, session.id);
    await page.locator('.template-apply-selector select').selectOption(applyTemplate.id);

    await expect(page.locator('#mode-select')).toHaveValue('yolo');
    await expect(page.locator('#effort-select')).toHaveValue('high');
    await expect(page.locator('.thinking-toggle input[type="checkbox"]')).toBeChecked();
    await expect(page.locator('.model-selector')).toHaveAttribute('data-model', 'claude-opus-4-8');

    const updated = await waitForSessionFields(session.id, (value) =>
      value.model === 'claude-opus-4-8' &&
      value.mode === 'yolo' &&
      value.thinkingEnabled === true &&
      value.effortLevel === 'high'
    );

    expect(updated.nextTemplateId).toBe(nextTemplate.id);
    expect(updated.gitBranch).not.toBe('should-not-apply');
  });
});
