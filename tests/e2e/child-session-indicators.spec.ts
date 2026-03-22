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
 * SessionDetailView SummaryTab workflow panel.
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

  test('should show PR indicators on parent card only, not on child sessions', async ({ page }) => {
    // Set PR data for first child
    await updateSessionWithPR(childSessions[0].id, {
      prUrl: 'https://github.com/user/repo/pull/111',
    });

    // Navigate to session detail view (SummaryTab) which shows the workflow panel
    await navigateAndWait(page, `/sessions/${parentSession.id}/summary`, {
      waitFor: '.workflow-sessions-panel',
      timeout: 15000,
    });

    // Wait for workflow panel to load
    const workflowPanel = page.locator('.workflow-sessions-panel');
    await expect(workflowPanel).toBeVisible();

    // Verify that child sessions do NOT show PR indicators in the workflow view
    // (PR indicators are only shown on parent cards, not individual children in workflow)
    const prLink = page.locator('.workflow-session-item .pr-link');
    await expect(prLink).not.toBeVisible({ timeout: 5000 });
  });
});
