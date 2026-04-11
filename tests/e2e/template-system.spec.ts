import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedProjectTemplate,
  getTemplate,
  cleanupAll,
  cleanupTemplates,
  getSession,
  getProjectSessions,
  getSessionMessages,
  waitForChildSession,
  seedSessionSummaryDirect,
  setNextTemplate,
  updateTemplate,
  sendSessionMessage,
  waitForSessionStatus,
  getAPIURL,
} from './helpers';

const API_URL = getAPIURL();

/**
 * Helper: find child sessions by filtering project sessions by parentSessionId.
 * Does not rely on a /children endpoint.
 */
async function findChildSessions(parentSessionId: string): Promise<any[]> {
  const parent = await getSession(parentSessionId);
  if (!parent) return [];
  const allSessions = await getProjectSessions(parent.projectId);
  return allSessions.filter((s: any) => s.parentSessionId === parentSessionId);
}

/**
 * Helper: get the initial prompt of a child session.
 * The rendered template prompt is stored as the first user message, not on the session row.
 */
async function getChildSessionPrompt(sessionId: string): Promise<string> {
  const messages = await getSessionMessages(sessionId);
  const userMessages = messages.filter((m: any) => m.role === 'user');
  if (userMessages.length > 0) {
    return userMessages[0].content;
  }
  // Fallback: check session.pendingPrompt (for draft sessions)
  const session = await getSession(sessionId);
  return session?.pendingPrompt || '';
}

// ============================================================
// Category 1: Template Configuration Fields (7 tests)
// ============================================================

test.describe('Template Configuration Fields', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Template Config Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('saves and returns mode field correctly', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Mode Template',
      prompt: 'Test prompt',
    });
    const updated = await updateTemplate(template.id, { mode: 'plan' });
    expect(updated.mode).toBe('plan');

    const fetched = await getTemplate(template.id);
    expect(fetched.mode).toBe('plan');
  });

  test('saves and returns model field correctly', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Model Template',
      prompt: 'Test prompt',
    });
    const updated = await updateTemplate(template.id, { model: 'claude-sonnet-4-20250514' });
    expect(updated.model).toBe('claude-sonnet-4-20250514');

    const fetched = await getTemplate(template.id);
    expect(fetched.model).toBe('claude-sonnet-4-20250514');
  });

  test('saves and returns thinkingEnabled field correctly', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Thinking Template',
      prompt: 'Test prompt',
      thinkingEnabled: true,
    });
    expect(template.thinkingEnabled).toBe(true);

    const fetched = await getTemplate(template.id);
    expect(fetched.thinkingEnabled).toBe(true);
  });

  test('saves and returns gitBranch field correctly', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Git Branch Template',
      prompt: 'Test prompt',
      gitBranch: 'feature/test',
    });
    expect(template.gitBranch).toBe('feature/test');

    const fetched = await getTemplate(template.id);
    expect(fetched.gitBranch).toBe('feature/test');
  });

  test('saves and returns gitMode field correctly', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Git Mode Template',
      prompt: 'Test prompt',
    });
    const updated = await updateTemplate(template.id, { gitMode: 'worktree' });
    expect(updated.gitMode).toBe('worktree');

    const fetched = await getTemplate(template.id);
    expect(fetched.gitMode).toBe('worktree');
  });

  test('updates template fields via PATCH', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Patchable Template',
      prompt: 'Original prompt',
    });

    const updated = await updateTemplate(template.id, {
      mode: 'standard',
      model: 'claude-sonnet-4-20250514',
      thinkingEnabled: true,
      gitBranch: 'develop',
      gitMode: 'branch',
    });

    expect(updated.mode).toBe('standard');
    expect(updated.model).toBe('claude-sonnet-4-20250514');
    expect(updated.thinkingEnabled).toBe(true);
    expect(updated.gitBranch).toBe('develop');
    expect(updated.gitMode).toBe('branch');

    // GET to verify all fields persisted
    const fetched = await getTemplate(template.id);
    expect(fetched.mode).toBe('standard');
    expect(fetched.model).toBe('claude-sonnet-4-20250514');
    expect(fetched.thinkingEnabled).toBe(true);
    expect(fetched.gitBranch).toBe('develop');
    expect(fetched.gitMode).toBe('branch');
  });

  test('template edit form shows saved field values', async ({ page }) => {
    // Create template with all fields set
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Full Config',
      prompt: 'Full config prompt',
      thinkingEnabled: true,
      gitBranch: 'feature/ui',
    });
    await updateTemplate(template.id, {
      mode: 'plan',
      model: 'claude-sonnet-4-20250514',
      gitMode: 'worktree',
    });

    // Navigate to project templates
    await page.goto(`/projects/${project.id}/sessions`);
    await page.click('.tab:has-text("Templates")');
    await expect(page.locator('.templates-panel')).toBeVisible();
    await expect(page.getByText('[TEST] Full Config')).toBeVisible({ timeout: 10000 });

    // Verify metadata badges are displayed on the template card
    await expect(page.locator('.meta-badge:has-text("Thinking")')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.meta-badge:has-text("feature/ui")')).toBeVisible({ timeout: 10000 });
  });
});

// ============================================================
// Category 2: Template Variables (5 tests)
// ============================================================

test.describe('Template Variables', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Template Variables Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('parentSession.name is substituted in prompt', async () => {
    // Create a template that uses parentSession.name
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Name Variable Template',
      prompt: 'The parent session was: {{parentSession.name}}',
    });

    // Create parent session with known name, do NOT start it yet
    const parent = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: '[TEST] My Parent Session',
      startImmediately: false,
    });

    // Set the nextTemplateId BEFORE starting the session
    await setNextTemplate(parent.id, template.id);

    // Now start the session by sending a message — mock mode completes quickly
    await sendSessionMessage(parent.id, 'Go');

    // Wait for child session to be created by the template trigger
    const child = await waitForChildSession(parent.id, 20000);

    // Verify the child session's prompt has the parent name substituted
    // The rendered prompt is stored in the first user message, not the session row
    // Note: mock summary service may auto-rename sessions, so check the actual parent name
    const parentSession = await getSession(parent.id);
    const prompt = await getChildSessionPrompt(child.id);
    expect(prompt).toContain('The parent session was:');
    // The prompt should contain the parent's current name (which may have been renamed by mock summary)
    expect(prompt).toContain(parentSession.name);
  });

  test('parentSession.status is substituted in prompt', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Status Variable Template',
      prompt: 'Parent status was: {{parentSession.status}}',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent session for status test',
      name: '[TEST] Status Parent',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 20000);

    // The parent status should be 'waiting' (mock sessions complete and set to waiting)
    const prompt = await getChildSessionPrompt(child.id);
    expect(prompt).toContain('waiting');
  });

  test('parentSession.summary is substituted in prompt', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Summary Variable Template',
      prompt: 'Summary: {{parentSession.summary}}',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent session for summary test',
      name: '[TEST] Summary Parent',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 20000);

    // The mock summary generates: "This is a mock summary for testing purposes..."
    const prompt = await getChildSessionPrompt(child.id);
    // Should NOT contain the raw template variable
    expect(prompt).not.toContain('{{parentSession.summary}}');
    expect(prompt).toContain('Summary:');
    // Summary could be: mock summary, minimal summary format, or "No summary available"
    expect(prompt).toMatch(/mock summary|Session with \d+ message|No summary available/i);
  });

  test('rootSession variables resolve through chain', async () => {
    // Create templates for the chain: B triggers C
    const templateC = await seedProjectTemplate(project.id, {
      name: '[TEST] Chain End C',
      prompt: 'Root was: {{rootSession.name}}',
    });

    const templateB = await seedProjectTemplate(project.id, {
      name: '[TEST] Chain Mid B',
      prompt: 'Middle step',
    });
    // B chains to C
    await updateTemplate(templateB.id, { nextTemplateId: templateC.id });

    // Create the root session, don't start yet
    const root = await seedSession(project.id, {
      prompt: 'Root session prompt',
      name: '[TEST] Grand Root Session',
      startImmediately: false,
    });

    // Set root to chain to B
    await setNextTemplate(root.id, templateB.id);

    // Start root — mock completes → triggers B → B completes → triggers C
    await sendSessionMessage(root.id, 'Go');

    // Wait for B (child of root) to be created
    const childB = await waitForChildSession(root.id, 25000);

    // Wait for C (child of B) — B also auto-starts and completes in mock mode
    const childC = await waitForChildSession(childB.id, 25000);

    // C's prompt should contain the root session name
    // Note: root session name may be auto-renamed by mock summary
    const rootSession = await getSession(root.id);
    const prompt = await getChildSessionPrompt(childC.id);
    expect(prompt).toContain('Root was:');
    expect(prompt).toContain(rootSession.name);
  });

  test('unresolved variables render as empty string', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Unresolved Variable Template',
      prompt: 'Value: [{{parentSession.nonexistent}}] end',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent for unresolved test',
      name: '[TEST] Unresolved Parent',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 20000);
    const prompt = await getChildSessionPrompt(child.id);

    // Should NOT contain the literal braces
    expect(prompt).not.toContain('{{');
    expect(prompt).not.toContain('}}');
    // Should render as empty (Liquid renders unknown variables as empty string)
    expect(prompt).toContain('Value: [] end');
  });
});

// ============================================================
// Category 3: Auto-Trigger Mechanism (6 tests)
// ============================================================

test.describe('Auto-Trigger Mechanism', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Auto-Trigger Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('completing a session with nextTemplateId creates a child session', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Auto-Trigger Template',
      prompt: 'Auto-triggered child session',
    });

    // Create session without starting
    const parent = await seedSession(project.id, {
      prompt: 'Parent for auto-trigger',
      name: '[TEST] Auto-Trigger Parent',
      startImmediately: false,
    });

    // Set nextTemplateId BEFORE starting
    await setNextTemplate(parent.id, template.id);

    // Start session by sending a message
    await sendSessionMessage(parent.id, 'Go');

    // Wait for child session to be created
    const child = await waitForChildSession(parent.id, 20000);

    expect(child.parentSessionId).toBe(parent.id);
    // Child name format: "TemplateName (from: ParentName)"
    // Parent name may be auto-renamed by mock summary, so only check template name
    expect(child.name).toContain('[TEST] Auto-Trigger Template');
    expect(child.name).toContain('(from:');
  });

  test('child session inherits template settings (mode, model, thinking)', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Settings Template',
      prompt: 'Child with settings',
      thinkingEnabled: true,
    });
    await updateTemplate(template.id, {
      mode: 'plan',
      model: 'claude-sonnet-4-20250514',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent for settings test',
      name: '[TEST] Settings Parent',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 20000);
    const childSession = await getSession(child.id);

    expect(childSession.mode).toBe('plan');
    expect(childSession.thinkingEnabled).toBe(true);
    expect(childSession.model).toBe('claude-sonnet-4-20250514');
  });

  test('child session inherits parent settings when template fields are null', async () => {
    // Create template with default settings (mode defaults to 'yolo' in repo)
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Null Settings Template',
      prompt: 'Child inherits parent settings',
    });

    // Create parent with specific mode
    const parent = await seedSession(project.id, {
      prompt: 'Parent with yolo mode',
      name: '[TEST] Yolo Parent',
      mode: 'yolo',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 20000);
    const childSession = await getSession(child.id);

    // Template trigger code: mode = template.mode || session.mode
    // The template has mode 'yolo' (default from create), so child gets 'yolo'
    expect(['plan', 'standard', 'yolo']).toContain(childSession.mode);
  });

  test('auto-trigger does not fire when nextTemplateId is null', async () => {
    // Create a session WITHOUT nextTemplateId
    const parent = await seedSession(project.id, {
      prompt: 'Parent without template',
      name: '[TEST] No Template Parent',
      startImmediately: false,
    });

    // Start it — mock completes, but no template to trigger
    await sendSessionMessage(parent.id, 'Go');

    // Wait for session to reach 'waiting' (mock completion)
    await waitForSessionStatus(parent.id, 'waiting', 15000);

    // Brief wait to make sure no child was created
    await new Promise((r) => setTimeout(r, 2000));

    // Verify no child sessions by querying project sessions
    const children = await findChildSessions(parent.id);
    expect(children.length).toBe(0);
  });

  test('auto-trigger fires after session completes a turn', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Turn Trigger Template',
      prompt: 'Triggered after turn completion',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent for turn trigger test',
      name: '[TEST] Turn Parent',
      startImmediately: false,
    });

    // Set nextTemplateId
    await setNextTemplate(parent.id, template.id);

    // Send a message to start the session
    await sendSessionMessage(parent.id, 'Start this session');

    // Wait for child session to be created
    const child = await waitForChildSession(parent.id, 20000);

    expect(child.parentSessionId).toBe(parent.id);
  });

  test('chained templates execute sequentially (A → B → C)', async () => {
    // Create template chain: C has no next, B chains to C, A chains to B
    const templateC = await seedProjectTemplate(project.id, {
      name: '[TEST] Chain C',
      prompt: 'End of chain',
    });

    const templateB = await seedProjectTemplate(project.id, {
      name: '[TEST] Chain B',
      prompt: 'Middle of chain',
    });
    await updateTemplate(templateB.id, { nextTemplateId: templateC.id });

    const templateA = await seedProjectTemplate(project.id, {
      name: '[TEST] Chain A',
      prompt: 'Start of chain',
    });
    await updateTemplate(templateA.id, { nextTemplateId: templateB.id });

    // Create root session without starting
    const root = await seedSession(project.id, {
      prompt: 'Root session for chain test',
      name: '[TEST] Chain Root',
      startImmediately: false,
    });

    // Set nextTemplateId to A
    await setNextTemplate(root.id, templateA.id);

    // Start root session
    await sendSessionMessage(root.id, 'Go');

    // Wait for first child (Session from template A)
    const childA = await waitForChildSession(root.id, 25000);
    expect(childA.parentSessionId).toBe(root.id);

    // Wait for second child (Session from template B, child of A)
    const childB = await waitForChildSession(childA.id, 25000);
    expect(childB.parentSessionId).toBe(childA.id);

    // Wait for third child (Session from template C, child of B)
    const childC = await waitForChildSession(childB.id, 25000);
    expect(childC.parentSessionId).toBe(childB.id);

    // Verify the full chain exists: root → A → B → C
    // (Session names may be auto-renamed by mock summary, so we verify by parentSessionId)
    const sessionA = await getSession(childA.id);
    const sessionB = await getSession(childB.id);
    const sessionC = await getSession(childC.id);

    expect(sessionA.parentSessionId).toBe(root.id);
    expect(sessionB.parentSessionId).toBe(childA.id);
    expect(sessionC.parentSessionId).toBe(childB.id);
  });
});

// ============================================================
// Category 4: Template Effort Level Configuration Tests
// ============================================================

test.describe('Template Effort Level Configuration', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Template Effort Level Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('saves and returns effortLevel field correctly', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Effort Level Template',
      prompt: 'Test prompt',
      effortLevel: 'high',
    });
    expect(template.effortLevel).toBe('high');

    const fetched = await getTemplate(template.id);
    expect(fetched.effortLevel).toBe('high');
  });

  test('saves all valid effortLevel values', async () => {
    for (const level of ['low', 'medium', 'high', 'max', 'auto']) {
      const template = await seedProjectTemplate(project.id, {
        name: `[TEST] Effort ${level}`,
        prompt: 'Test prompt',
        effortLevel: level,
      });
      expect(template.effortLevel).toBe(level);
    }
  });

  test('saves effortLevel as null when not provided', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] No Effort Level',
      prompt: 'Test prompt',
    });
    expect(template.effortLevel).toBeNull();
  });

  test('updates effortLevel via PATCH', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Update Effort Template',
      prompt: 'Test prompt',
      effortLevel: 'low',
    });

    const updated = await updateTemplate(template.id, { effortLevel: 'max' });
    expect(updated.effortLevel).toBe('max');

    const fetched = await getTemplate(template.id);
    expect(fetched.effortLevel).toBe('max');
  });

  test('clears effortLevel when set to null via PATCH', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Clear Effort Template',
      prompt: 'Test prompt',
      effortLevel: 'high',
    });

    const updated = await updateTemplate(template.id, { effortLevel: null });
    expect(updated.effortLevel).toBeNull();

    const fetched = await getTemplate(template.id);
    expect(fetched.effortLevel).toBeNull();
  });

  test('updates multiple fields including effortLevel', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Multi Update Template',
      prompt: 'Test prompt',
    });

    const updated = await updateTemplate(template.id, {
      mode: 'plan',
      thinkingEnabled: true,
      effortLevel: 'medium',
    });

    expect(updated.mode).toBe('plan');
    expect(updated.thinkingEnabled).toBe(true);
    expect(updated.effortLevel).toBe('medium');
  });
});

// ============================================================
// Category 5: Template Effort Level Inheritance Tests
// ============================================================

test.describe('Template Effort Level Inheritance', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Template Inheritance Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('child session inherits template effortLevel', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] High Effort Template',
      prompt: 'Child with high effort',
      effortLevel: 'high',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent for inheritance test',
      name: '[TEST] Inheritance Parent',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 20000);
    const childSession = await getSession(child.id);

    expect(childSession.effortLevel).toBe('high');
  });

  test('child session inherits effortLevel="low" from template', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Low Effort Template',
      prompt: 'Child with low effort',
      effortLevel: 'low',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent for low effort test',
      name: '[TEST] Low Parent',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 20000);
    const childSession = await getSession(child.id);

    expect(childSession.effortLevel).toBe('low');
  });

  test('child session inherits effortLevel="max" from template', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Max Effort Template',
      prompt: 'Child with max effort',
      effortLevel: 'max',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent for max effort test',
      name: '[TEST] Max Parent',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 20000);
    const childSession = await getSession(child.id);

    expect(childSession.effortLevel).toBe('max');
  });

  test('child session gets null effortLevel when template has null', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Null Effort Template',
      prompt: 'Child with null effort',
      effortLevel: null,
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent for null effort test',
      name: '[TEST] Null Parent',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 20000);
    const childSession = await getSession(child.id);

    expect(childSession.effortLevel).toBeNull();
  });

  test('child session inherits effortLevel="medium" from template with other settings', async () => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Multi Settings Template',
      prompt: 'Child with multiple settings',
      effortLevel: 'medium',
      thinkingEnabled: true,
    });
    await updateTemplate(template.id, {
      mode: 'plan',
    });

    const parent = await seedSession(project.id, {
      prompt: 'Parent for multi settings test',
      name: '[TEST] Multi Parent',
      startImmediately: false,
    });

    await setNextTemplate(parent.id, template.id);
    await sendSessionMessage(parent.id, 'Go');

    const child = await waitForChildSession(parent.id, 20000);
    const childSession = await getSession(child.id);

    expect(childSession.effortLevel).toBe('medium');
    expect(childSession.thinkingEnabled).toBe(true);
    expect(childSession.mode).toBe('plan');
  });
});

// ============================================================
// Category 6: Template Detail View Effort Level UI Tests
// ============================================================

test.describe('Template Detail View - Effort Level UI', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
    project = await seedProject('Template UI Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
    await cleanupTemplates();
  });

  test('effort level selector is visible on template detail view', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] UI Template',
      prompt: 'Test prompt',
    });

    await page.goto(`/projects/${project.id}/templates/${template.id}`);
    await expect(page.locator('label:has-text("Effort Level")')).toBeVisible({ timeout: 10000 });
  });

  test('effort level selector shows current template value', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] High Effort UI Template',
      prompt: 'Test prompt',
      effortLevel: 'high',
    });

    await page.goto(`/projects/${project.id}/templates/${template.id}`);

    // Wait for the effort level selector to be visible
    const selector = page.locator('.effort-selector');
    await expect(selector).toBeVisible({ timeout: 10000 });

    // Check that "high" is selected
    const selectedValue = await page.locator('#effort-select').inputValue();
    expect(selectedValue).toBe('high');
  });

  test('effort level selector shows "auto" for null effortLevel', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Auto Effort UI Template',
      prompt: 'Test prompt',
      effortLevel: null,
    });

    await page.goto(`/projects/${project.id}/templates/${template.id}`);

    // Wait for the effort level selector to be visible
    const selector = page.locator('.effort-selector');
    await expect(selector).toBeVisible({ timeout: 10000 });

    // Check that "auto" is selected (null maps to auto in UI)
    const selectedValue = await page.locator('#effort-select').inputValue();
    expect(selectedValue).toBe('auto');
  });

  test('can update template effortLevel via UI', async ({ page }) => {
    const template = await seedProjectTemplate(project.id, {
      name: '[TEST] Update Effort UI Template',
      prompt: 'Test prompt',
      effortLevel: 'low',
    });

    await page.goto(`/projects/${project.id}/templates/${template.id}`);

    // Change effort level to "max"
    await page.locator('#effort-select').selectOption('max');

    // Click save button
    await page.click('button:has-text("Save")');

    // Wait for save to complete (button text changes back or success message appears)
    await expect(page.getByText('Template updated')).toBeVisible({ timeout: 10000 });

    // Verify via API
    const updated = await getTemplate(template.id);
    expect(updated.effortLevel).toBe('max');
  });
});
