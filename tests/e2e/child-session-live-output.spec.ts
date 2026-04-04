import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  seedWorkLog,
  cleanupCreatedResources,
  navigateAndWait,
  updateSessionStatus,
  waitForSessionToExist,
} from './helpers';

test.describe('Child Session Live Output on Session List', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupCreatedResources();
    project = await seedProject('Child Live Output', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('running badge appears on parent card when child session is running', async ({ page }) => {
    // Create parent session
    const parent = await seedSession(project.id, {
      prompt: 'Parent task',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parent.id);
    await updateSessionStatus(parent.id, 'waiting');

    // Create a child session and set it to running
    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child task',
      name: 'Child Session',
    });
    await waitForSessionToExist(child.id);
    await updateSessionStatus(child.id, 'running');

    // Navigate to session list
    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
    });

    // The parent card should display a "running" status badge
    // because its child is running
    const runningBadge = page.locator('.status-running');
    await expect(runningBadge).toBeVisible({ timeout: 15000 });
    await expect(runningBadge).toContainText('running');
  });

  test('live output appears on parent card when child session emits work logs', async ({ page }) => {
    // Create parent session (NOT running)
    const parent = await seedSession(project.id, {
      prompt: 'Parent task',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parent.id);
    await updateSessionStatus(parent.id, 'waiting');

    // Create a running child session
    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child task',
      name: 'Child Session',
    });
    await waitForSessionToExist(child.id);
    await updateSessionStatus(child.id, 'running');

    // Navigate to session list
    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
    });

    // Seed a work log on the child session
    await seedWorkLog(child.id, {
      type: 'tool_input',
      content: JSON.stringify({ command: 'git status' }),
      toolName: 'Bash',
    });

    // The live output pane should be visible on the parent card
    const logStream = page.locator('.session-log-stream');
    await expect(logStream).toBeVisible({ timeout: 15000 });

    // Verify the "Live Output" header
    const headerLabel = page.locator('.log-header-label');
    await expect(headerLabel).toHaveText('Live Output');

    // Verify at least one log entry rendered
    const logEntry = page.locator('.log-entry');
    await expect(async () => {
      const count = await logEntry.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 10000 });
  });

  test('no running badge or live output when parent and children are all stopped', async ({ page }) => {
    const parent = await seedSession(project.id, {
      prompt: 'Parent task',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parent.id);
    await updateSessionStatus(parent.id, 'stopped');

    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child task',
      name: 'Child Session',
    });
    await waitForSessionToExist(child.id);
    await updateSessionStatus(child.id, 'stopped');

    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
    });

    // No running badge should appear
    const runningBadge = page.locator('.status-running');
    await expect(runningBadge).toHaveCount(0);

    // No live output pane should appear
    const logStream = page.locator('.session-log-stream');
    await expect(logStream).toHaveCount(0);
  });

  test('running badge and live output still work for a running parent session', async ({ page }) => {
    const parent = await seedSession(project.id, {
      prompt: 'Running parent',
      name: 'Running Parent',
    });
    await waitForSessionToExist(parent.id);
    await updateSessionStatus(parent.id, 'running');

    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
    });

    // Running badge should appear
    const runningBadge = page.locator('.status-running');
    await expect(runningBadge).toBeVisible({ timeout: 15000 });

    // Seed work log on parent
    await seedWorkLog(parent.id, {
      type: 'tool_input',
      content: JSON.stringify({ command: 'echo hello' }),
      toolName: 'Bash',
    });

    // Live output should appear
    const logStream = page.locator('.session-log-stream');
    await expect(logStream).toBeVisible({ timeout: 15000 });
  });

  test('grandchild running session shows live output on root card', async ({ page }) => {
    // Create parent → child → grandchild chain
    const parent = await seedSession(project.id, {
      prompt: 'Parent task',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parent.id);
    await updateSessionStatus(parent.id, 'waiting');

    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child task',
      name: 'Child Session',
    });
    await waitForSessionToExist(child.id);
    await updateSessionStatus(child.id, 'waiting');

    const grandchild = await seedChildSession(project.id, child.id, {
      prompt: 'Grandchild task',
      name: 'Grandchild Session',
    });
    await waitForSessionToExist(grandchild.id);
    await updateSessionStatus(grandchild.id, 'running');

    // Navigate to session list
    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
    });

    // Seed a work log on the grandchild session
    await seedWorkLog(grandchild.id, {
      type: 'tool_input',
      content: JSON.stringify({ command: 'git status' }),
      toolName: 'Bash',
    });

    // The live output pane should be visible on the root card
    const logStream = page.locator('.session-log-stream');
    await expect(logStream).toBeVisible({ timeout: 15000 });

    // Verify at least one log entry rendered
    const logEntry = page.locator('.log-entry');
    await expect(async () => {
      const count = await logEntry.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 10000 });
  });

  test('running badge appears on parent card when grandchild is running', async ({ page }) => {
    // Create parent → child → grandchild chain
    const parent = await seedSession(project.id, {
      prompt: 'Parent task',
      name: 'Parent Session GC Badge',
    });
    await waitForSessionToExist(parent.id);
    await updateSessionStatus(parent.id, 'waiting');

    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child task',
      name: 'Child Session GC Badge',
    });
    await waitForSessionToExist(child.id);
    await updateSessionStatus(child.id, 'waiting');

    const grandchild = await seedChildSession(project.id, child.id, {
      prompt: 'Grandchild task',
      name: 'Grandchild Session GC Badge',
    });
    await waitForSessionToExist(grandchild.id);
    await updateSessionStatus(grandchild.id, 'running');

    // Navigate to session list
    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
    });

    // The parent card should display a "running" status badge
    const runningBadge = page.locator('.status-running');
    await expect(runningBadge).toBeVisible({ timeout: 15000 });
    await expect(runningBadge).toContainText('running');
  });

  test('work logs from multiple running children appear in live output', async ({ page }) => {
    const parent = await seedSession(project.id, {
      prompt: 'Parent task',
      name: 'Parent Session',
    });
    await waitForSessionToExist(parent.id);
    await updateSessionStatus(parent.id, 'waiting');

    // Create two running child sessions
    const child1 = await seedChildSession(project.id, parent.id, {
      prompt: 'Child 1',
      name: 'Child 1',
    });
    await waitForSessionToExist(child1.id);
    await updateSessionStatus(child1.id, 'running');

    const child2 = await seedChildSession(project.id, parent.id, {
      prompt: 'Child 2',
      name: 'Child 2',
    });
    await waitForSessionToExist(child2.id);
    await updateSessionStatus(child2.id, 'running');

    await navigateAndWait(page, `/projects/${project.id}/sessions`, {
      waitFor: '.session-card',
    });

    // Seed work logs on both children
    await seedWorkLog(child1.id, {
      type: 'tool_input',
      content: JSON.stringify({ command: 'ls' }),
      toolName: 'Bash',
    });
    await new Promise(r => setTimeout(r, 100));
    await seedWorkLog(child2.id, {
      type: 'tool_input',
      content: JSON.stringify({ file: 'README.md' }),
      toolName: 'Read',
    });

    // Live output should appear
    const logStream = page.locator('.session-log-stream');
    await expect(logStream).toBeVisible({ timeout: 15000 });

    // Should have at least 2 log entries (one from each child)
    const logEntries = page.locator('.log-entry');
    await expect(async () => {
      const count = await logEntries.count();
      expect(count).toBeGreaterThanOrEqual(2);
    }).toPass({ timeout: 10000 });
  });
});
