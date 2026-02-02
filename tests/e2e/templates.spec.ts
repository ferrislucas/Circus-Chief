import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedProjectTemplate,
  seedGlobalTemplate,
  cleanupAll,
  cleanupTemplates,
  getTemplate,
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

  test('displays global templates', async ({ page }) => {
    await seedGlobalTemplate({
      name: '[TEST] Global Template 1',
      prompt: 'First global template',
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();

    await expect(page.getByText('[TEST] Global Template 1')).toBeVisible();
    await expect(page.getByText('Global Templates')).toBeVisible();
    await expect(page.locator('.meta-badge-global')).toBeVisible();
  });

  test('displays both project and global templates', async ({ page }) => {
    await seedProjectTemplate(project.id, {
      name: '[TEST] Project Only',
      prompt: 'Project template',
    });
    await seedGlobalTemplate({
      name: '[TEST] Global Only',
      prompt: 'Global template',
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();

    await expect(page.getByText('Project Templates')).toBeVisible();
    await expect(page.getByText('Global Templates')).toBeVisible();
    await expect(page.getByText('[TEST] Project Only')).toBeVisible();
    await expect(page.getByText('[TEST] Global Only')).toBeVisible();
  });

  test('truncates long prompts', async ({ page }) => {
    const longPrompt =
      'This is a very long prompt that exceeds the maximum display length and should be truncated with ellipsis to prevent the card from becoming too tall';
    await seedProjectTemplate(project.id, {
      name: '[TEST] Long Prompt',
      prompt: longPrompt,
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();

    // Should show truncated text with ellipsis
    await expect(page.locator('.template-prompt:has-text("...")')).toBeVisible();
  });

  test('displays template metadata badges', async ({ page }) => {
    await seedProjectTemplate(project.id, {
      name: '[TEST] Full Featured',
      prompt: 'Template with all features',
      thinkingEnabled: true,
      gitBranch: 'develop',
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();
    await expect(page.getByText('[TEST] Full Featured')).toBeVisible();

    await expect(page.locator('.meta-badge:has-text("Thinking")')).toBeVisible();
    await expect(page.locator('.meta-badge:has-text("develop")')).toBeVisible();
  });
});

test.describe('Session Templates - Edit', () => {
  let project: any;
  let template: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Test Project', '/tmp/test');
    template = await seedProjectTemplate(project.id, {
      name: '[TEST] Editable Template',
      prompt: 'Original prompt',
    });
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('edit button opens form with existing data', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.getByText('[TEST] Editable Template')).toBeVisible();
    await page.locator('.template-card').filter({ hasText: '[TEST] Editable Template' }).getByTestId('edit-btn').click();
    await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.template-form h3')).toHaveText('Edit Template');
  });

  test('form is pre-filled with existing template data', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.getByText('[TEST] Editable Template')).toBeVisible();
    await page.locator('.template-card').filter({ hasText: '[TEST] Editable Template' }).getByTestId('edit-btn').click();
    await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 10000 });

    // Check form is pre-filled
    await expect(page.locator('.template-form input[placeholder="Template name"]')).toHaveValue('[TEST] Editable Template');
    await expect(page.locator('.template-form textarea')).toHaveValue('Original prompt');
  });

  test('can update template name and prompt', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.getByText('[TEST] Editable Template')).toBeVisible();
    await page.locator('.template-card').filter({ hasText: '[TEST] Editable Template' }).getByTestId('edit-btn').click();
    await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 10000 });
    await page.fill('.template-form input[placeholder="Template name"]', '[TEST] Updated Template');
    await page.getByTestId('submit-btn').click();
    await expect(page.getByText('[TEST] Updated Template')).toBeVisible({ timeout: 10000 });
    // Old name should not be visible
    await expect(page.getByText('[TEST] Editable Template')).not.toBeVisible();
  });

  test('cancel edit returns to template list without changes', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.getByText('[TEST] Editable Template')).toBeVisible();
    await page.locator('.template-card').filter({ hasText: '[TEST] Editable Template' }).getByTestId('edit-btn').click();
    await expect(page.getByTestId('template-form')).toBeVisible({ timeout: 10000 });
    await page.fill('.template-form input[placeholder="Template name"]', '[TEST] Changed Name');
    await page.getByTestId('cancel-btn').click();
    await expect(page.getByTestId('template-form')).not.toBeVisible();
    // Original name should still be there
    await expect(page.getByText('[TEST] Editable Template')).toBeVisible();
  });
});

test.describe('Session Templates - Delete', () => {
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

  test('can delete a template', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] To Delete',
      prompt: 'Will be deleted',
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();

    await expect(page.getByText('[TEST] To Delete')).toBeVisible();

    // Handle confirmation dialog
    page.on('dialog', (dialog) => dialog.accept());

    // Click delete button (second btn-icon)
    await page
      .locator('.template-card')
      .filter({ hasText: '[TEST] To Delete' })
      .locator('.btn-icon-danger')
      .click();

    // Template should disappear
    await expect(page.getByText('[TEST] To Delete')).not.toBeVisible({ timeout: 10000 });

    // Verify via API
    const deleted = await getTemplate(template.id);
    expect(deleted).toBeNull();
  });

  test('cancel delete keeps template', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Keep Me',
      prompt: 'Should not be deleted',
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();
    await expect(page.getByText('[TEST] Keep Me')).toBeVisible();

    // Handle confirmation dialog - dismiss it
    page.on('dialog', (dialog) => dialog.dismiss());

    // Click delete button
    await page
      .locator('.template-card')
      .filter({ hasText: '[TEST] Keep Me' })
      .locator('.btn-icon-danger')
      .click();

    // Template should still be visible
    await expect(page.getByText('[TEST] Keep Me')).toBeVisible();

    // Verify via API
    const kept = await getTemplate(template.id);
    expect(kept).toBeTruthy();
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
