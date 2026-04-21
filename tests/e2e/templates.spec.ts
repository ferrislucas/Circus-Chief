import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedProjectTemplate,
  seedGlobalTemplate,
  cleanupAll,
  cleanupTemplates,
} from './helpers';

test.describe('Session Templates - Tab Navigation', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('displays Sessions and Templates tabs', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);

    await expect(page.locator('.tabs')).toBeVisible();
    await expect(page.locator('.tab:has-text("Sessions")')).toBeVisible();
    await expect(page.locator('.tab:has-text("Templates")')).toBeVisible();
  });

  test('Sessions tab is active by default', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);

    await expect(page.locator('.tab.active')).toHaveText('Sessions');
  });

  test('can switch to Templates tab', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);

    await page.click('.tab:has-text("Templates")');

    await expect(page.locator('.tab.active')).toHaveText('Templates');
    await expect(page.locator('.templates-panel')).toBeVisible();
  });

  test('can switch back to Sessions tab', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);

    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.tab.active')).toHaveText('Templates');

    await page.click('.tab:has-text("Sessions")');
    await expect(page.locator('.tab.active')).toHaveText('Sessions');
  });
});

test.describe('Session Templates - Create Form', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('New Template button opens create form', async ({ page }) => {
    await seedProjectTemplate(project.id, { name: '[TEST] Existing', prompt: 'Test prompt' });
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.getByText('[TEST] Existing')).toBeVisible();
    await page.getByTestId('new-template-btn').click();
    await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Session Templates - Display', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('displays project templates', async ({ page }) => {
    await seedProjectTemplate(project.id, {
      name: '[TEST] Project Template 1',
      prompt: 'First project template',
    });
    await seedProjectTemplate(project.id, {
      name: '[TEST] Project Template 2',
      prompt: 'Second project template',
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();

    await expect(page.getByText('[TEST] Project Template 1')).toBeVisible();
    await expect(page.getByText('[TEST] Project Template 2')).toBeVisible();
    await expect(page.getByText('Project Templates')).toBeVisible();
  });

  test('truncates long prompts', async ({ page }) => {
    const longPrompt =
      'This is a very long prompt that exceeds the maximum display length and should be truncated with ellipsis to prevent the card from becoming too tall';
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Long Prompt',
      prompt: longPrompt,
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();

    // Should show truncated text with ellipsis — scope to the template we created
    // so unrelated global/project templates don't cause strict-mode violations.
    const card = page.getByTestId(`template-card-${template.id}`);
    await expect(card.locator('.template-prompt')).toContainText('...');
  });

  test('displays template metadata badges', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Full Featured',
      prompt: 'Template with all features',
      thinkingEnabled: true,
      gitBranch: 'develop',
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();
    await expect(page.getByText('[TEST] Full Featured')).toBeVisible();

    // Scope badge assertions to this template's card so other templates in
    // the database don't cause strict-mode violations.
    const card = page.getByTestId(`template-card-${template.id}`);
    await expect(card.locator('.meta-badge:has-text("Thinking")')).toBeVisible();
    await expect(card.locator('.meta-badge:has-text("develop")')).toBeVisible();
  });
});


test.describe('Session Templates - Chaining', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('can chain templates when creating', async ({ page }) => {
    const target = await seedProjectTemplate(project.id, {
      name: '[TEST] Target Template',
      prompt: 'Target prompt',
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.getByText('[TEST] Target Template')).toBeVisible();
    await page.getByTestId('new-template-btn').click();
    await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 10000 });
    await page.fill('.template-form input[placeholder="Template name"]', '[TEST] Chained Template');
    await page.fill('.template-form textarea', 'Chain to another template');
    // Select next template (second select dropdown)
    await page.locator('.template-form select').nth(1).selectOption(target.id);
    await page.getByTestId('submit-btn').click();
    await expect(page.locator('.meta-badge-chain')).toBeVisible({ timeout: 10000 });
  });

  test('displays chain badge with target template name', async ({ page }) => {
    const target = await seedProjectTemplate(project.id, {
      name: '[TEST] Chain Target',
      prompt: 'Target',
    });
    await seedProjectTemplate(project.id, {
      name: '[TEST] Chain Source',
      prompt: 'Source',
      nextTemplateId: target.id,
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();

    await expect(page.locator('.meta-badge-chain:has-text("[TEST] Chain Target")')).toBeVisible({ timeout: 10000 });
  });
});
