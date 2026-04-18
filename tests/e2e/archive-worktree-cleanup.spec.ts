import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  updateSessionFields,
  cleanupCreatedResources,
  navigateAndWait,
} from './helpers';

test.describe('Archive Modal - Worktree Cleanup Checkbox', () => {
  let projectWithHook: any;
  let projectWithoutHook: any;

  test.beforeEach(async () => {
    projectWithHook = await seedProject('WT Cleanup Test', '/tmp/test', {
      onSessionDeleted: 'echo cleanup',
    });
    projectWithoutHook = await seedProject('No Hook Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('shows cleanup checkbox for worktree session on session detail view', async ({ page }) => {
    const session = await seedSession(projectWithHook.id, {
      prompt: 'Worktree session',
      name: 'WT Session Detail',
      startImmediately: false,
    });
    await updateSessionFields(session.id, { gitWorktree: '/tmp/fake-wt' });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);

    // Open kebab menu and click Archive
    await page.click('button[aria-label="Session actions"]');
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });
    await page.locator('button.menu-item').filter({ hasText: 'Archive' }).click({ timeout: 10000 });

    // Verify modal is visible
    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify cleanup checkbox is visible with correct text
    const cleanupOption = modal.locator('.cleanup-option');
    await expect(cleanupOption).toBeVisible();
    await expect(cleanupOption).toContainText('Run git worktree cleanup');

    // Cancel the modal
    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });

  test('hides cleanup checkbox for non-worktree session on session detail view', async ({ page }) => {
    const session = await seedSession(projectWithHook.id, {
      prompt: 'Branch session',
      name: 'Branch Session Detail',
      startImmediately: false,
    });
    // No gitWorktree set - defaults to null

    await navigateAndWait(page, `/sessions/${session.id}/summary`);

    // Open kebab menu and click Archive
    await page.click('button[aria-label="Session actions"]');
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });
    await page.locator('button.menu-item').filter({ hasText: 'Archive' }).click({ timeout: 10000 });

    // Verify modal is visible
    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify cleanup checkbox is NOT visible
    const cleanupOption = modal.locator('.cleanup-option');
    await expect(cleanupOption).not.toBeVisible();

    // Cancel the modal
    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });

  test('shows cleanup checkbox for worktree session on session list view', async ({ page }) => {
    const session = await seedSession(projectWithHook.id, {
      prompt: 'Worktree session',
      name: 'WT Session List',
      startImmediately: false,
    });
    await updateSessionFields(session.id, { gitWorktree: '/tmp/fake-wt' });

    await navigateAndWait(page, `/projects/${projectWithHook.id}/sessions`);

    // Click archive button on the session card
    await page.locator('button.archive-btn[title="Archive session"]').first().click();

    // Verify modal is visible
    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify cleanup checkbox is visible with correct text
    const cleanupOption = modal.locator('.cleanup-option');
    await expect(cleanupOption).toBeVisible();
    await expect(cleanupOption).toContainText('Run git worktree cleanup');

    // Cancel the modal
    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });

  test('hides cleanup checkbox for non-worktree session on session list view', async ({ page }) => {
    const session = await seedSession(projectWithHook.id, {
      prompt: 'Branch session',
      name: 'Branch Session List',
      startImmediately: false,
    });
    // No gitWorktree set

    await navigateAndWait(page, `/projects/${projectWithHook.id}/sessions`);

    // Click archive button on the session card
    await page.locator('button.archive-btn[title="Archive session"]').first().click();

    // Verify modal is visible
    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify cleanup checkbox is NOT visible
    const cleanupOption = modal.locator('.cleanup-option');
    await expect(cleanupOption).not.toBeVisible();

    // Cancel the modal
    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });

  test('hides cleanup checkbox when project has no onSessionDeleted hook', async ({ page }) => {
    const session = await seedSession(projectWithoutHook.id, {
      prompt: 'Worktree session no hook',
      name: 'WT No Hook',
      startImmediately: false,
    });
    await updateSessionFields(session.id, { gitWorktree: '/tmp/fake-wt' });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);

    // Open kebab menu and click Archive
    await page.click('button[aria-label="Session actions"]');
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });
    await page.locator('button.menu-item').filter({ hasText: 'Archive' }).click({ timeout: 10000 });

    // Verify modal is visible
    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify cleanup checkbox is NOT visible (no hook configured)
    const cleanupOption = modal.locator('.cleanup-option');
    await expect(cleanupOption).not.toBeVisible();

    // Cancel the modal
    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });
});
