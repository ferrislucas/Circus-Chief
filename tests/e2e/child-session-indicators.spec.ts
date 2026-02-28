import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  cleanupAll,
  navigateAndWait,
  waitForSessionToExist,
  updateSessionWithPR,
} from './helpers';

/**
 * E2E Tests for PR Indicators in Child Session Workflow View
 *
 * This test suite covers the feature that displays PR indicators in the
 * expanded workflow view on the session list page.
 */

test.describe('Child Session Indicators - Workflow View PR Indicators', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;
  let parentSession: any;
  let childSessions: any[];

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Workflow PR Test', '/tmp/test');
    parentSession = await seedSession(project.id, {
      prompt: 'Parent session prompt',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parentSession.id);

    childSessions = [];
    for (let i = 1; i <= 3; i++) {
      const child = await seedChildSession(project.id, parentSession.id, {
        prompt: `Child ${i} prompt`,
        name: `Child Session ${i}`,
      });
      await waitForSessionToExist(child.id);
      childSessions.push(child);
    }
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('should show PR indicators in expanded workflow view', async ({ page }) => {
    // Set PR data for first child
    await updateSessionWithPR(childSessions[0].id, {
      prUrl: 'https://github.com/user/repo/pull/111',
    });

    // Navigate to session list view
    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.expand-toggle-btn',
      timeout: 15000,
    });

    // Expand parent session
    const parentCard = page.locator('.session-card').filter({ hasText: 'Parent Session' });
    const expandButton = parentCard.locator('.expand-toggle-btn');
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    await page.waitForTimeout(500);

    // Look for PR indicators in workflow items
    const prLink = page.locator('.workflow-session-item .pr-link');
    await expect(prLink).toBeVisible({ timeout: 5000 });
    await expect(prLink).toContainText('PR 111');
  });
});
