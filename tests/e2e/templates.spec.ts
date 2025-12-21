import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedProjectTemplate,
  seedGlobalTemplate,
  cleanupAll,
  cleanupTemplates,
  getTemplate,
  getProjectTemplates,
  getGlobalTemplates,
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

test.describe('Session Templates - Empty State', () => {
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

  test('displays empty state when no templates exist', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');

    await expect(page.getByText('No templates yet')).toBeVisible();
    await expect(page.locator('.empty-state button:has-text("Create Template")')).toBeVisible();
  });

  test('empty state Create Template button opens form', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');

    // Wait for templates panel and empty state to be visible
    await expect(page.locator('.templates-panel')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.empty-state')).toBeVisible();

    // Click the Create Template button in the empty state using force
    const createBtn = page.locator('.empty-state button:has-text("Create Template")');
    await expect(createBtn).toBeVisible();
    await createBtn.click({ force: true });

    // Wait for form to appear
    await expect(page.locator('.template-form')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.template-form h3')).toHaveText('Create Template');
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

  // Helper to open the create form
  async function openCreateForm(page: any, projectId: string) {
    await page.goto(`/projects/${projectId}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.empty-state')).toBeVisible();
    const createBtn = page.locator('.empty-state button:has-text("Create Template")');
    await expect(createBtn).toBeVisible();
    await createBtn.click({ force: true });
    await expect(page.locator('.template-form')).toBeVisible({ timeout: 10000 });
  }

  test('New Template button opens create form', async ({ page }) => {
    // First, add a template to show the header button
    await seedProjectTemplate(project.id, { name: '[TEST] Existing', prompt: 'Test prompt' });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();
    await page.waitForLoadState('networkidle');

    // Wait for template to appear
    await expect(page.getByText('[TEST] Existing')).toBeVisible();

    const newTemplateBtn = page.locator('.templates-header button:has-text("New Template")');
    await expect(newTemplateBtn).toBeVisible();
    await newTemplateBtn.click({ force: true });

    await expect(page.locator('.template-form')).toBeVisible({ timeout: 10000 });
  });

  test('form has all required fields', async ({ page }) => {
    await openCreateForm(page, project.id);

    // Check form fields exist
    await expect(page.locator('.template-form input[placeholder="Template name"]')).toBeVisible();
    await expect(page.locator('.template-form textarea')).toBeVisible();
    await expect(page.locator('.template-form select').first()).toBeVisible(); // Scope select
    await expect(page.locator('.template-form select').nth(1)).toBeVisible(); // Next template select
    await expect(page.locator('.template-form input[type="checkbox"]')).toBeVisible(); // Thinking checkbox
    await expect(page.locator('.template-form input[placeholder="Branch name"]')).toBeVisible();
  });

  test('form shows available Liquid variables', async ({ page }) => {
    await openCreateForm(page, project.id);

    await expect(page.getByText('{{parentSession.summary}}')).toBeVisible();
    await expect(page.getByText('{{parentSession.status}}')).toBeVisible();
    await expect(page.getByText('{{parentSession.name}}')).toBeVisible();
  });

  test('can create a project template', async ({ page }) => {
    await openCreateForm(page, project.id);

    // Fill form
    await page.fill('.template-form input[placeholder="Template name"]', '[TEST] My Template');
    await page.fill('.template-form textarea', 'This is the template prompt');

    // Submit
    await page.locator('.template-form button[type="submit"]').click();

    // Wait for form to close and template to appear
    await expect(page.locator('.template-form')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('[TEST] My Template')).toBeVisible();

    // Verify via API
    const templates = await getProjectTemplates(project.id);
    const created = templates.find((t: any) => t.name === '[TEST] My Template');
    expect(created).toBeTruthy();
    expect(created.prompt).toBe('This is the template prompt');
  });

  test('can create a global template', async ({ page }) => {
    await openCreateForm(page, project.id);

    // Fill form
    await page.fill('.template-form input[placeholder="Template name"]', '[TEST] Global Template');
    await page.fill('.template-form textarea', 'Global template prompt');

    // Select global scope
    await page.locator('.template-form select').first().selectOption({ label: 'Global (all projects)' });

    // Submit
    await page.locator('.template-form button[type="submit"]').click();

    // Wait for form to close and template to appear
    await expect(page.locator('.template-form')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('[TEST] Global Template')).toBeVisible();
    await expect(page.locator('.meta-badge-global')).toBeVisible();

    // Verify via API
    const templates = await getGlobalTemplates();
    const created = templates.find((t: any) => t.name === '[TEST] Global Template');
    expect(created).toBeTruthy();
    expect(created.projectId).toBeNull();
  });

  test('can create template with thinking enabled', async ({ page }) => {
    await openCreateForm(page, project.id);

    // Fill form
    await page.fill('.template-form input[placeholder="Template name"]', '[TEST] Thinking Template');
    await page.fill('.template-form textarea', 'Template with thinking');

    // Enable thinking
    await page.check('.template-form input[type="checkbox"]');

    // Submit
    await page.locator('.template-form button[type="submit"]').click();

    // Verify thinking badge shows
    await expect(page.locator('.meta-badge:has-text("Thinking")')).toBeVisible({ timeout: 10000 });

    // Verify via API
    const templates = await getProjectTemplates(project.id);
    const created = templates.find((t: any) => t.name === '[TEST] Thinking Template');
    expect(created).toBeTruthy();
    expect(created.thinkingEnabled).toBe(true);
  });

  test('can create template with git branch', async ({ page }) => {
    await openCreateForm(page, project.id);

    // Fill form
    await page.fill('.template-form input[placeholder="Template name"]', '[TEST] Branch Template');
    await page.fill('.template-form textarea', 'Template with branch');
    await page.fill('.template-form input[placeholder="Branch name"]', 'feature/test');

    // Submit
    await page.locator('.template-form button[type="submit"]').click();

    // Verify branch badge shows
    await expect(page.locator('.meta-badge:has-text("feature/test")')).toBeVisible({ timeout: 10000 });

    // Verify via API
    const templates = await getProjectTemplates(project.id);
    const created = templates.find((t: any) => t.name === '[TEST] Branch Template');
    expect(created).toBeTruthy();
    expect(created.gitBranch).toBe('feature/test');
  });

  test('cancel button closes form without creating', async ({ page }) => {
    await openCreateForm(page, project.id);

    // Fill form
    await page.fill('.template-form input[placeholder="Template name"]', '[TEST] Cancelled');

    // Cancel
    await page.locator('.template-form button:has-text("Cancel")').click();

    // Form should close
    await expect(page.locator('.template-form')).not.toBeVisible({ timeout: 10000 });

    // Verify nothing was created
    const templates = await getProjectTemplates(project.id);
    const cancelled = templates.find((t: any) => t.name === '[TEST] Cancelled');
    expect(cancelled).toBeUndefined();
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
    await expect(page.locator('.templates-panel')).toBeVisible();

    // Wait for template to appear
    await expect(page.getByText('[TEST] Editable Template')).toBeVisible();

    // Click edit button on the template card
    await page.locator('.template-card').filter({ hasText: '[TEST] Editable Template' }).locator('.btn-icon').first().click();

    // Form should be visible with Edit title
    await expect(page.locator('.template-form')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.template-form h3')).toHaveText('Edit Template');

    // Fields should be pre-populated
    await expect(page.locator('.template-form input[placeholder="Template name"]')).toHaveValue('[TEST] Editable Template');
    await expect(page.locator('.template-form textarea')).toHaveValue('Original prompt');
  });

  test('can update template name and prompt', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();
    await expect(page.getByText('[TEST] Editable Template')).toBeVisible();

    // Click edit
    await page.locator('.template-card').filter({ hasText: '[TEST] Editable Template' }).locator('.btn-icon').first().click();
    await expect(page.locator('.template-form')).toBeVisible({ timeout: 10000 });

    // Update fields
    await page.fill('.template-form input[placeholder="Template name"]', '[TEST] Updated Template');
    await page.fill('.template-form textarea', 'Updated prompt content');

    // Submit
    await page.locator('.template-form button[type="submit"]').click();

    // Verify UI updated
    await expect(page.locator('.template-form')).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('[TEST] Updated Template')).toBeVisible();

    // Verify via API
    const updated = await getTemplate(template.id);
    expect(updated.name).toBe('[TEST] Updated Template');
    expect(updated.prompt).toBe('Updated prompt content');
  });

  test('scope selector is disabled when editing', async ({ page }) => {
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();
    await expect(page.getByText('[TEST] Editable Template')).toBeVisible();

    // Click edit
    await page.locator('.template-card').filter({ hasText: '[TEST] Editable Template' }).locator('.btn-icon').first().click();
    await expect(page.locator('.template-form')).toBeVisible({ timeout: 10000 });

    // Scope selector should be disabled
    await expect(page.locator('.template-form select').first()).toBeDisabled();
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
    // Create a target template first
    const target = await seedProjectTemplate(project.id, {
      name: '[TEST] Target Template',
      prompt: 'Target prompt',
    });

    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('[TEST] Target Template')).toBeVisible();

    // Click the New Template button
    const newTemplateBtn = page.locator('.templates-header button:has-text("New Template")');
    await expect(newTemplateBtn).toBeVisible();
    await newTemplateBtn.click({ force: true });
    await expect(page.locator('.template-form')).toBeVisible({ timeout: 10000 });

    // Fill form
    await page.fill('.template-form input[placeholder="Template name"]', '[TEST] Chained Template');
    await page.fill('.template-form textarea', 'Chain to another template');

    // Select next template
    await page.locator('.template-form select').nth(1).selectOption(target.id);

    // Submit
    await page.locator('.template-form button[type="submit"]').click();

    // Verify chain badge shows
    await expect(page.locator('.meta-badge-chain')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Chains to:')).toBeVisible();

    // Verify via API
    const templates = await getProjectTemplates(project.id);
    const chained = templates.find((t: any) => t.name === '[TEST] Chained Template');
    expect(chained).toBeTruthy();
    expect(chained.nextTemplateId).toBe(target.id);
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
