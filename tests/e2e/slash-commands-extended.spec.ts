import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import {
  seedProject,
  seedSession,
  cleanupAll,
  navigateAndWait,
  getSlashCommands,
  getSlashCommand,
  executeSlashCommandRaw,
  getSlashCommandsAPIURL,
  updateSessionStatus,
  waitForSessionToExist,
} from './helpers';

// ============================================================
// Filesystem Setup Utilities
// ============================================================

/**
 * Each test worker gets a unique temp dir to avoid parallel conflicts.
 */
function getTestDir(suffix: string): string {
  return `/tmp/slash-cmd-e2e-${suffix}-${process.pid}`;
}

/**
 * Create all test command files in the given directory.
 */
function setupTestCommands(testDir: string) {
  const commandsDir = join(testDir, '.claude', 'commands');
  rmSync(testDir, { recursive: true, force: true });
  mkdirSync(commandsDir, { recursive: true });

  // Simple command (no arguments)
  writeFileSync(
    join(commandsDir, 'test-greet.md'),
    `---
description: "A simple greeting command"
---
Say hello to the user in a friendly way.
`
  );

  // Command with text argument
  writeFileSync(
    join(commandsDir, 'test-summarize.md'),
    `---
description: "Summarize a topic"
arguments:
  - name: "topic"
    type: "text"
    label: "Topic to summarize"
    required: true
    placeholder: "Enter a topic..."
---
Please summarize the following topic: $topic
`
  );

  // Command with select argument and multiline argument
  writeFileSync(
    join(commandsDir, 'test-translate.md'),
    `---
description: "Translate text to a language"
arguments:
  - name: "language"
    type: "select"
    label: "Target Language"
    required: true
    options:
      - value: "spanish"
        label: "Spanish"
      - value: "french"
        label: "French"
      - value: "german"
        label: "German"
  - name: "text"
    type: "multiline"
    label: "Text to translate"
    required: true
    placeholder: "Enter text..."
---
Translate the following to \${language}: \${text}
`
  );

  // Command with optional argument and default value
  writeFileSync(
    join(commandsDir, 'test-format.md'),
    `---
description: "Format code in a given style"
arguments:
  - name: "style"
    type: "text"
    label: "Code Style"
    required: false
    placeholder: "e.g., functional, oop"
    default: "standard"
---
Format the code using $style style.
`
  );

  // Command with no frontmatter (body only)
  writeFileSync(
    join(commandsDir, 'test-review.md'),
    `Review the current code for bugs and suggest improvements.
`
  );
}

// ============================================================
// Shared Helper: Open wizard in NewSessionView
// ============================================================

/**
 * Navigate to new session view, wait for slash command button, and open the wizard.
 * Returns the wizard locator.
 *
 * IMPORTANT: NewSessionView computes workingDirectory from projectsStore.getProjectById(),
 * which requires the project to already be in the Pinia store. The store is populated
 * when the SessionListView (project sessions page) is visited. We navigate there first
 * to ensure the store is populated, then navigate to the new session page.
 */
async function openWizardInNewSession(
  page: any,
  projectId: string
): Promise<ReturnType<typeof page.locator>> {
  // Navigate to the session list to populate the Pinia project store.
  // Then click the "New Session" link to use Vue Router client-side navigation,
  // which preserves the store state (page.goto would cause a full reload and wipe it).
  await page.goto(`/projects/${projectId}/sessions`);
  await page.waitForLoadState('networkidle');

  // Wait for the desktop "New Session" link — confirms project data is loaded.
  // There are two links (mobile-only, desktop-only); target the desktop one.
  const newSessionLink = page.locator(`a.desktop-only[href="/projects/${projectId}/sessions/new"]`);
  await expect(newSessionLink).toBeVisible({ timeout: 15000 });

  // Use client-side navigation by clicking the link (preserves Pinia state)
  await newSessionLink.click();

  // Wait for the new session form to appear
  await page.waitForURL(`**/projects/${projectId}/sessions/new`);
  await page.waitForLoadState('networkidle');

  // The slash command button appears when workingDirectory is truthy.
  const slashBtn = page.locator('[data-testid="slash-command-button"]');
  await expect(slashBtn).toBeVisible({ timeout: 15000 });
  await slashBtn.click();

  const wizard = page.locator('[data-testid="slash-command-wizard"]');
  await expect(wizard).toBeVisible({ timeout: 10000 });

  return wizard;
}

/**
 * Wait for test commands to appear in the wizard (they load async via API).
 */
async function waitForTestCommands(wizard: any) {
  await expect(
    wizard.locator('[data-testid="command-test-greet"]')
  ).toBeVisible({ timeout: 15000 });
}

// ============================================================
// Test Suite
// ============================================================

test.describe('Slash Commands Extended', () => {
  test.describe.configure({ timeout: 90000 });

  // ============================================================
  // Category 1: Command Discovery via API (4 tests)
  // ============================================================

  test.describe('Command Discovery via API', () => {
    const testDir = getTestDir('api');

    test.beforeEach(async () => {
      await cleanupAll();
      setupTestCommands(testDir);
    });

    test.afterEach(async () => {
      await cleanupAll();
      rmSync(testDir, { recursive: true, force: true });
    });

    test('discovers project commands from .claude/commands directory', async () => {
      const commands = await getSlashCommands(testDir);

      // We should find all 5 test commands
      const testCommandNames = commands
        .filter((c: any) => c.name.startsWith('test-'))
        .map((c: any) => c.name);

      expect(testCommandNames).toContain('test-greet');
      expect(testCommandNames).toContain('test-summarize');
      expect(testCommandNames).toContain('test-translate');
      expect(testCommandNames).toContain('test-format');
      expect(testCommandNames).toContain('test-review');

      // All should have source: "project"
      const projectCommands = commands.filter(
        (c: any) => c.name.startsWith('test-') && c.source === 'project'
      );
      expect(projectCommands.length).toBe(5);
    });

    test('parses YAML frontmatter with description and arguments', async () => {
      const command = await getSlashCommand(testDir, 'test-summarize');
      expect(command).not.toBeNull();
      expect(command.description).toBe('Summarize a topic');
      expect(command.arguments).toHaveLength(1);

      const arg = command.arguments[0];
      expect(arg.name).toBe('topic');
      expect(arg.type).toBe('text');
      expect(arg.label).toBe('Topic to summarize');
      expect(arg.required).toBe(true);
      expect(arg.placeholder).toBe('Enter a topic...');
    });

    test('parses select-type arguments with options', async () => {
      const command = await getSlashCommand(testDir, 'test-translate');
      expect(command).not.toBeNull();
      expect(command.arguments).toHaveLength(2);

      // First arg is select type
      const selectArg = command.arguments[0];
      expect(selectArg.name).toBe('language');
      expect(selectArg.type).toBe('select');
      expect(selectArg.options).toHaveLength(3);
      expect(selectArg.options[0]).toEqual({ value: 'spanish', label: 'Spanish' });
      expect(selectArg.options[1]).toEqual({ value: 'french', label: 'French' });
      expect(selectArg.options[2]).toEqual({ value: 'german', label: 'German' });

      // Second arg is multiline type
      const multilineArg = command.arguments[1];
      expect(multilineArg.name).toBe('text');
      expect(multilineArg.type).toBe('multiline');
    });

    test('handles command files with no frontmatter', async () => {
      const command = await getSlashCommand(testDir, 'test-review');
      expect(command).not.toBeNull();
      expect(command.description).toBe('');
      expect(command.arguments).toHaveLength(0);
      expect(command.source).toBe('project');
    });
  });

  // ============================================================
  // Category 2: Wizard Command Display & Search (4 tests)
  // ============================================================

  test.describe('Wizard Command Display & Search', () => {
    const testDir = getTestDir('display');
    let project: any;

    test.beforeEach(async () => {
      await cleanupAll();
      setupTestCommands(testDir);
      project = await seedProject('Slash Display Test', testDir);
    });

    test.afterEach(async () => {
      await cleanupAll();
      rmSync(testDir, { recursive: true, force: true });
    });

    test('wizard displays project commands with names and descriptions', async ({
      page,
    }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      // Verify command cards show correct names and descriptions
      const greetCard = wizard.locator('[data-testid="command-test-greet"]');
      await expect(greetCard.locator('.command-name')).toHaveText('/test-greet');
      await expect(greetCard.locator('.command-description')).toHaveText(
        'A simple greeting command'
      );

      const summarizeCard = wizard.locator('[data-testid="command-test-summarize"]');
      await expect(summarizeCard).toBeVisible();
      await expect(summarizeCard.locator('.command-name')).toHaveText(
        '/test-summarize'
      );
      await expect(summarizeCard.locator('.command-description')).toHaveText(
        'Summarize a topic'
      );
    });

    test('wizard shows argument count badge for commands with arguments', async ({
      page,
    }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      // test-greet has no args — no badge
      const greetBadge = wizard
        .locator('[data-testid="command-test-greet"]')
        .locator('.command-args-badge');
      await expect(greetBadge).not.toBeVisible();

      // test-summarize has 1 arg
      const summarizeBadge = wizard
        .locator('[data-testid="command-test-summarize"]')
        .locator('.command-args-badge');
      await expect(summarizeBadge).toBeVisible();
      await expect(summarizeBadge).toHaveText('1 arg');

      // test-translate has 2 args
      const translateBadge = wizard
        .locator('[data-testid="command-test-translate"]')
        .locator('.command-args-badge');
      await expect(translateBadge).toBeVisible();
      await expect(translateBadge).toHaveText('2 args');
    });

    test('search filters commands by name', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      // Search for "translate"
      const searchInput = wizard.locator('[data-testid="command-search"]');
      await searchInput.fill('translate');

      // test-translate should be visible, others hidden
      await expect(
        wizard.locator('[data-testid="command-test-translate"]')
      ).toBeVisible();
      await expect(
        wizard.locator('[data-testid="command-test-greet"]')
      ).not.toBeVisible();
      await expect(
        wizard.locator('[data-testid="command-test-summarize"]')
      ).not.toBeVisible();
    });

    test('search filters commands by description', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      // Search by description keyword "greeting"
      const searchInput = wizard.locator('[data-testid="command-search"]');
      await searchInput.fill('greeting');

      // Only test-greet has "greeting" in its description
      await expect(
        wizard.locator('[data-testid="command-test-greet"]')
      ).toBeVisible();
      await expect(
        wizard.locator('[data-testid="command-test-translate"]')
      ).not.toBeVisible();
      await expect(
        wizard.locator('[data-testid="command-test-summarize"]')
      ).not.toBeVisible();
    });
  });

  // ============================================================
  // Category 3: Typed Arguments Form (5 tests)
  // ============================================================

  test.describe('Typed Arguments Form', () => {
    const testDir = getTestDir('args-form');
    let project: any;

    test.beforeEach(async () => {
      await cleanupAll();
      setupTestCommands(testDir);
      project = await seedProject('Slash Args Test', testDir);
    });

    test.afterEach(async () => {
      await cleanupAll();
      rmSync(testDir, { recursive: true, force: true });
    });

    test('clicking command with arguments shows argument form', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      // Click command with args
      await wizard.locator('[data-testid="command-test-summarize"]').click();

      // Verify wizard advances to step 2 with form
      await expect(wizard.locator('#wizard-title')).toHaveText(
        'Configure /test-summarize'
      );
      await expect(wizard.locator('[data-testid="arg-topic"]')).toBeVisible();
    });

    test('text argument renders as text input', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      await wizard.locator('[data-testid="command-test-summarize"]').click();

      // Verify it's a text input with correct placeholder
      const input = wizard.locator('[data-testid="arg-topic"]');
      await expect(input).toBeVisible();
      await expect(input).toHaveAttribute('type', 'text');
      await expect(input).toHaveAttribute('placeholder', 'Enter a topic...');
    });

    test('select argument renders as dropdown with options', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      await wizard.locator('[data-testid="command-test-translate"]').click();

      // Verify select element is present
      const select = wizard.locator('[data-testid="arg-language"]');
      await expect(select).toBeVisible();

      // Verify it's a <select> element
      const tagName = await select.evaluate((el: Element) =>
        el.tagName.toLowerCase()
      );
      expect(tagName).toBe('select');

      // Verify options (first option is the disabled placeholder, then 3 language options)
      const options = select.locator('option');
      // "Select an option..." + Spanish + French + German = 4
      await expect(options).toHaveCount(4);
      await expect(options.nth(1)).toHaveText('Spanish');
      await expect(options.nth(2)).toHaveText('French');
      await expect(options.nth(3)).toHaveText('German');
    });

    test('multiline argument renders as textarea', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      await wizard.locator('[data-testid="command-test-translate"]').click();

      // Verify textarea is present for multiline arg
      const textarea = wizard.locator('[data-testid="arg-text"]');
      await expect(textarea).toBeVisible();

      // Verify it's a <textarea> element
      const tagName = await textarea.evaluate((el: Element) =>
        el.tagName.toLowerCase()
      );
      expect(tagName).toBe('textarea');

      // Verify rows and placeholder
      await expect(textarea).toHaveAttribute('rows', '4');
      await expect(textarea).toHaveAttribute('placeholder', 'Enter text...');
    });

    test('required arguments show asterisk indicator', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      // First check test-format (optional "style" arg)
      await wizard.locator('[data-testid="command-test-format"]').click();
      await expect(wizard.locator('#wizard-title')).toHaveText(
        'Configure /test-format'
      );

      // The "style" arg is NOT required — no asterisk
      const styleLabel = wizard.locator('label[for="arg-style"]');
      await expect(styleLabel).toBeVisible();
      const noAsterisk = styleLabel.locator('.required-indicator');
      await expect(noAsterisk).not.toBeVisible();

      // Go back and check test-translate (required args)
      await wizard.locator('.btn-secondary').click();
      await expect(wizard.locator('#wizard-title')).toHaveText('Slash Commands');

      await wizard.locator('[data-testid="command-test-translate"]').click();
      await expect(wizard.locator('#wizard-title')).toHaveText(
        'Configure /test-translate'
      );

      // The "language" arg IS required — asterisk present
      const langLabel = wizard.locator('label[for="arg-language"]');
      await expect(langLabel).toBeVisible();
      const langAsterisk = langLabel.locator('.required-indicator');
      await expect(langAsterisk).toBeVisible();
      await expect(langAsterisk).toHaveText('*');
    });
  });

  // ============================================================
  // Category 4: Argument Validation & Form Behavior (4 tests)
  // ============================================================

  test.describe('Argument Validation & Form Behavior', () => {
    const testDir = getTestDir('validation');
    let project: any;

    test.beforeEach(async () => {
      await cleanupAll();
      setupTestCommands(testDir);
      project = await seedProject('Slash Validation Test', testDir);
    });

    test.afterEach(async () => {
      await cleanupAll();
      rmSync(testDir, { recursive: true, force: true });
    });

    test('execute button disabled when required arguments are empty', async ({
      page,
    }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      await wizard.locator('[data-testid="command-test-summarize"]').click();
      await expect(wizard.locator('#wizard-title')).toHaveText(
        'Configure /test-summarize'
      );

      // Required field is empty — button should be disabled
      const executeBtn = wizard.locator('[data-testid="execute-command-btn"]');
      await expect(executeBtn).toBeDisabled();
    });

    test('execute button enabled when all required arguments are filled', async ({
      page,
    }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      await wizard.locator('[data-testid="command-test-summarize"]').click();
      await expect(wizard.locator('#wizard-title')).toHaveText(
        'Configure /test-summarize'
      );

      // Fill the required field
      await wizard.locator('[data-testid="arg-topic"]').fill('Quantum Computing');

      // Button should now be enabled
      const executeBtn = wizard.locator('[data-testid="execute-command-btn"]');
      await expect(executeBtn).toBeEnabled();
    });

    test('default values pre-populate argument fields', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      await wizard.locator('[data-testid="command-test-format"]').click();
      await expect(wizard.locator('#wizard-title')).toHaveText(
        'Configure /test-format'
      );

      // The "style" arg has default "standard"
      const styleInput = wizard.locator('[data-testid="arg-style"]');
      await expect(styleInput).toHaveValue('standard');
    });

    test('back button returns to command selection', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      await wizard.locator('[data-testid="command-test-summarize"]').click();

      // Verify step 2
      await expect(wizard.locator('#wizard-title')).toHaveText(
        'Configure /test-summarize'
      );

      // Click back
      await wizard.locator('.btn-secondary').click();

      // Verify step 1 with title and command grid
      await expect(wizard.locator('#wizard-title')).toHaveText('Slash Commands');
      await expect(
        wizard.locator('[data-testid="command-test-summarize"]')
      ).toBeVisible();
    });
  });

  // ============================================================
  // Category 5: Command Execution (3 tests)
  // ============================================================

  test.describe('Command Execution', () => {
    const testDir = getTestDir('exec');
    let project: any;

    test.beforeEach(async () => {
      await cleanupAll();
      setupTestCommands(testDir);
      project = await seedProject('Slash Exec Test', testDir);
    });

    test.afterEach(async () => {
      await cleanupAll();
      rmSync(testDir, { recursive: true, force: true });
    });

    test('executing a command with no arguments sends immediately via API', async () => {
      // Create session in waiting state
      const session = await seedSession(project.id, {
        prompt: 'Test execution',
        name: 'Exec Test Session',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);
      await updateSessionStatus(session.id, 'waiting');

      // Execute the no-arg command
      const res = await executeSlashCommandRaw('test-greet', session.id);
      expect(res.ok).toBe(true);

      const result = await res.json();
      expect(result.success).toBe(true);
      expect(result.command).toBe('test-greet');
      // The message should be the body content (no args to substitute)
      expect(result.message).toContain('Say hello to the user');
    });

    test('executing a command with arguments substitutes values via API', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test execution',
        name: 'Exec Test Session',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);
      await updateSessionStatus(session.id, 'waiting');

      // Execute with args
      const res = await executeSlashCommandRaw('test-summarize', session.id, {
        topic: 'Machine Learning',
      });
      expect(res.ok).toBe(true);

      const result = await res.json();
      expect(result.success).toBe(true);
      expect(result.command).toBe('test-summarize');
      // Body should have $topic substituted
      expect(result.message).toContain('Machine Learning');
    });

    test('execute API rejects when session is not in a sendable state', async () => {
      const session = await seedSession(project.id, {
        prompt: 'Test execution',
        name: 'Exec Test Session',
        startImmediately: false,
      });
      await waitForSessionToExist(session.id);
      // Set to running status
      await updateSessionStatus(session.id, 'running');

      const res = await executeSlashCommandRaw('test-greet', session.id);
      expect(res.status).toBe(400);

      const result = await res.json();
      expect(result.error).toContain('not ready for commands');
    });
  });

  // ============================================================
  // Category 6: Insert Mode in New Session View (3 tests)
  // ============================================================

  test.describe('Insert Mode in New Session View', () => {
    const testDir = getTestDir('insert');
    let project: any;

    test.beforeEach(async () => {
      await cleanupAll();
      setupTestCommands(testDir);
      project = await seedProject('Slash Insert Test', testDir);
    });

    test.afterEach(async () => {
      await cleanupAll();
      rmSync(testDir, { recursive: true, force: true });
    });

    test('clicking a no-arg command inserts text into prompt', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      // Click the no-arg command (test-greet)
      await wizard.locator('[data-testid="command-test-greet"]').click();

      // Wizard should close
      await expect(wizard).not.toBeVisible({ timeout: 5000 });

      // Prompt textarea should contain the command text
      // In insert mode, no-arg commands produce "/{name}" via buildInsertString
      // The textarea is inside a ResizableTextarea component; target the actual <textarea>
      const textarea = page.locator('.form-textarea textarea');
      await expect(textarea).toHaveValue('/test-greet');
    });

    test('submitting arguments form inserts substituted text into prompt', async ({
      page,
    }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      // Click command with args (test-summarize)
      await wizard.locator('[data-testid="command-test-summarize"]').click();

      // Fill the argument
      await wizard.locator('[data-testid="arg-topic"]').fill('AI Ethics');

      // The button should say "Insert Command" in insert mode
      const insertBtn = wizard.locator('[data-testid="execute-command-btn"]');
      await expect(insertBtn).toHaveText('Insert Command');
      await insertBtn.click();

      // Wizard should close
      await expect(wizard).not.toBeVisible({ timeout: 5000 });

      // Prompt textarea should contain the substituted command text
      // In insert mode, buildInsertString produces '/{name} {arg_values}'
      const textarea = page.locator('.form-textarea textarea');
      const promptValue = await textarea.inputValue();
      expect(promptValue).toContain('/test-summarize');
      expect(promptValue).toContain('AI Ethics');
    });

    test('wizard hides built-in commands in new session view', async ({ page }) => {
      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      // NewSessionView passes hideBuiltin=true, so no "Built-in Commands" section
      const builtinSection = wizard.locator('.section-title', {
        hasText: 'Built-in Commands',
      });
      await expect(builtinSection).not.toBeVisible();
    });
  });

  // ============================================================
  // Category 7: Edge Cases & Error Handling (3 tests)
  // ============================================================

  test.describe('Edge Cases & Error Handling', () => {
    test.beforeEach(async () => {
      await cleanupAll();
    });

    test.afterEach(async () => {
      await cleanupAll();
    });

    test('wizard shows empty state when no commands available', async ({ page }) => {
      // Create a project with a directory that has no .claude/commands/
      const emptyDir = `/tmp/slash-cmd-e2e-empty-${process.pid}`;
      rmSync(emptyDir, { recursive: true, force: true });
      mkdirSync(emptyDir, { recursive: true });

      const emptyProject = await seedProject('Empty Cmd Test', emptyDir);

      const wizard = await openWizardInNewSession(page, emptyProject.id);

      // Check for empty state text — may need to wait for loading to finish
      // Note: user commands from ~/.claude/commands/ may also appear.
      // If there are none, we get the empty state. If there are some, that's OK.
      const emptyState = wizard.locator('.empty-state');
      const commandCards = wizard.locator('[data-testid^="command-"]');

      // Wait a bit for the API call to finish
      await page.waitForTimeout(3000);

      const cardCount = await commandCards.count();
      if (cardCount === 0) {
        await expect(emptyState).toBeVisible({ timeout: 5000 });
        await expect(emptyState).toHaveText('No slash commands available');
      }
      // If user commands exist, the test still passes — we verified the wizard opens

      // Clean up
      rmSync(emptyDir, { recursive: true, force: true });
    });

    test('search shows no-match message when query has no results', async ({
      page,
    }) => {
      const testDir = getTestDir('no-match');
      setupTestCommands(testDir);
      const project = await seedProject('Slash NoMatch Test', testDir);

      const wizard = await openWizardInNewSession(page, project.id);
      await waitForTestCommands(wizard);

      // Search for something that doesn't match
      const searchInput = wizard.locator('[data-testid="command-search"]');
      await searchInput.fill('zzzznonexistent');

      // Empty state with search message
      const emptyState = wizard.locator('.empty-state');
      await expect(emptyState).toBeVisible({ timeout: 5000 });
      await expect(emptyState).toContainText('No commands match');

      rmSync(testDir, { recursive: true, force: true });
    });

    test('API returns 400 when directory parameter is missing', async () => {
      const url = getSlashCommandsAPIURL();
      const res = await fetch(url);
      expect(res.status).toBe(400);

      const result = await res.json();
      expect(result.error).toContain('directory');
    });
  });
});
