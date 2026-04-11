import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  cleanupAll,
  waitForSessionStatus,
  navigateAndWait,
  openSessionOverlay,
  waitForSessionToExist,
} from './helpers';

test.describe('Slash Commands', () => {
  // Session creation and command execution can be slow
  test.describe.configure({ timeout: 90000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Slash Command Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  /**
   * Helper to navigate to a session and wait for the slash command button.
   * The button only appears when the session is in a sendable state (waiting/stopped/error)
   * AND the project's working directory is loaded.
   */
  async function navigateToSessionWithSlashCommands(page: any, projectId: string, sessionId: string) {
    // Wait for session to reach 'waiting' state in the API
    await waitForSessionStatus(sessionId, 'waiting', 30000);

    // Navigate directly to the session conversation
    await page.goto(`/sessions/${sessionId}/summary`);
    await page.waitForLoadState('networkidle');
    await openSessionOverlay(page);

    // Wait for the input form to be visible (indicates session loaded and in sendable state)
    const inputForm = page.locator('.input-form');
    await expect(inputForm).toBeVisible({ timeout: 30000 });

    // Wait for the slash command button to appear
    // ConversationTab.onMounted fetches the project asynchronously, so we need to wait
    const slashCommandButton = page.locator('[data-testid="slash-command-button"]');
    await expect(slashCommandButton).toBeVisible({ timeout: 15000 });

    return slashCommandButton;
  }

  test('slash command wizard opens and shows available commands', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test slash commands',
      name: 'Slash Command Test Session',
    });

    await waitForSessionToExist(session.id);

    // Navigate to session and wait for slash command button
    const slashCommandButton = await navigateToSessionWithSlashCommands(page, project.id, session.id);
    await slashCommandButton.click();

    // Verify wizard is open
    const wizard = page.locator('[data-testid="slash-command-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 10000 });

    // Verify the title shows "Slash Commands"
    await expect(wizard.locator('#wizard-title')).toHaveText('Slash Commands');

    // Verify at least one command is shown (help should always be available as builtin)
    const commandCards = wizard.locator('[data-testid^="command-"]');
    await expect(commandCards.first()).toBeVisible({ timeout: 10000 });
  });

  test('slash command wizard can be closed with escape key', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test slash commands',
      name: 'Slash Command Test Session',
    });

    await waitForSessionToExist(session.id);

    // Navigate to session and wait for slash command button
    const slashCommandButton = await navigateToSessionWithSlashCommands(page, project.id, session.id);
    await slashCommandButton.click();

    const wizard = page.locator('[data-testid="slash-command-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 10000 });

    // Press Escape to close
    await page.keyboard.press('Escape');

    // Wizard should be closed
    await expect(wizard).not.toBeVisible({ timeout: 5000 });
  });

  test('slash command wizard can be closed with close button', async ({ page }) => {
    const session = await seedSession(project.id, {
      prompt: 'Test slash commands',
      name: 'Slash Command Test Session',
    });

    await waitForSessionToExist(session.id);

    // Navigate to session and wait for slash command button
    const slashCommandButton = await navigateToSessionWithSlashCommands(page, project.id, session.id);
    await slashCommandButton.click();

    const wizard = page.locator('[data-testid="slash-command-wizard"]');
    await expect(wizard).toBeVisible({ timeout: 10000 });

    // Click the close button
    await wizard.locator('.close-btn').click();

    // Wizard should be closed
    await expect(wizard).not.toBeVisible({ timeout: 5000 });
  });
});
