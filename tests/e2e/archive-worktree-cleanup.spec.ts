import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import { join } from 'path';
import {
  archiveSession,
  getSession,
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
    await page.click('button[aria-label="Workspace actions"]');
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });
    await page.locator('button.menu-item').filter({ hasText: 'Archive' }).click({ timeout: 10000 });

    // Verify modal is visible
    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify cleanup checkbox is visible with correct text
    const cleanupCheckbox = modal.getByRole('checkbox', { name: 'Run git worktree cleanup' });
    await expect(cleanupCheckbox).toBeVisible();

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
    await page.click('button[aria-label="Workspace actions"]');
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
    await page.locator('button.archive-btn[title="Archive workspace"]').first().click();

    // Verify modal is visible
    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify cleanup checkbox is visible with correct text
    const cleanupCheckbox = modal.getByRole('checkbox', { name: 'Run git worktree cleanup' });
    await expect(cleanupCheckbox).toBeVisible();

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
    await page.locator('button.archive-btn[title="Archive workspace"]').first().click();

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
    await page.click('button[aria-label="Workspace actions"]');
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });
    await page.locator('button.menu-item').filter({ hasText: 'Archive' }).click({ timeout: 10000 });

    // Verify modal is visible
    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Verify cleanup checkbox is NOT visible (no hook configured).
    // Note: the "Delete git worktree" checkbox IS visible here — it does not
    // need a hook — so scope the assertion to the cleanup checkbox itself.
    await expect(modal.getByRole('checkbox', { name: 'Run git worktree cleanup' })).toHaveCount(0);

    // Cancel the modal
    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });
});

test.describe('Archive Modal - Delete Git Worktree Checkbox', () => {
  let projectWithoutHook: any;

  test.beforeEach(async () => {
    projectWithoutHook = await seedProject('Delete WT No Hook', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('shows Delete git worktree checkbox (checked by default) without a hook', async ({ page }) => {
    const session = await seedSession(projectWithoutHook.id, {
      prompt: 'Worktree session no hook',
      name: 'Delete WT Visible',
      startImmediately: false,
    });
    await updateSessionFields(session.id, { gitWorktree: '/tmp/fake-wt' });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);

    await page.click('button[aria-label="Workspace actions"]');
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });
    await page.locator('button.menu-item').filter({ hasText: 'Archive' }).click({ timeout: 10000 });

    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    const deleteCheckbox = modal.getByRole('checkbox', { name: 'Delete git worktree' });
    await expect(deleteCheckbox).toBeVisible();
    await expect(deleteCheckbox).toBeChecked();

    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });

  test('hides Delete git worktree checkbox for non-worktree session', async ({ page }) => {
    const session = await seedSession(projectWithoutHook.id, {
      prompt: 'Branch session',
      name: 'Delete WT Hidden',
      startImmediately: false,
    });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);

    await page.click('button[aria-label="Workspace actions"]');
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });
    await page.locator('button.menu-item').filter({ hasText: 'Archive' }).click({ timeout: 10000 });

    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });
    await expect(modal.getByRole('checkbox', { name: 'Delete git worktree' })).toHaveCount(0);

    await modal.locator('.btn-secondary').filter({ hasText: 'Cancel' }).click();
  });

  test('unchecking Delete git worktree archives but keeps gitWorktree', async ({ page }) => {
    const session = await seedSession(projectWithoutHook.id, {
      prompt: 'Worktree session opt out',
      name: 'Delete WT Opt Out',
      startImmediately: false,
    });
    await updateSessionFields(session.id, { gitWorktree: '/tmp/fake-wt-opt-out' });

    await navigateAndWait(page, `/sessions/${session.id}/summary`);

    await page.click('button[aria-label="Workspace actions"]');
    await expect(page.locator('.menu-items')).toBeVisible({ timeout: 5000 });
    await page.locator('button.menu-item').filter({ hasText: 'Archive' }).click({ timeout: 10000 });

    const modal = page.locator('.modal-backdrop');
    await expect(modal).toBeVisible({ timeout: 5000 });

    await modal.getByRole('checkbox', { name: 'Delete git worktree' }).click();
    await modal.getByRole('button', { name: 'Archive' }).click();

    // Modal closes after archiving; verify via the API.
    await expect(modal).not.toBeVisible({ timeout: 10000 });
    const archived = await getSession(session.id);
    expect(archived.archived).toBe(true);
    expect(archived.gitWorktree).toBe('/tmp/fake-wt-opt-out');
  });

  test('deleteWorktree removes a real worktree and clears gitWorktree', async () => {
    const repoDir = mkdtempSync(join(os.tmpdir(), 'cc-wt-repo-'));
    try {
      execSync('git init -b main', { cwd: repoDir });
      execSync('git config user.email "e2e@test.local" && git config user.name "e2e"', { cwd: repoDir });
      writeFileSync(join(repoDir, 'README.md'), 'worktree delete test');
      execSync('git add .', { cwd: repoDir });
      execSync('git -c user.email="e2e@test.local" -c user.name="e2e" commit -m init', { cwd: repoDir });
      const wtDir = `${repoDir}-wt`;
      execSync(`git worktree add "${wtDir}" -b wt-branch`, { cwd: repoDir });
      expect(existsSync(wtDir)).toBe(true);

      const project = await seedProject('Delete WT Real', repoDir);
      const session = await seedSession(project.id, {
        prompt: 'Real worktree session',
        name: 'Delete WT Real',
        startImmediately: false,
      });
      await updateSessionFields(session.id, { gitWorktree: wtDir });

      const archived = await archiveSession(session.id, { deleteWorktree: true });

      expect(archived.archived).toBe(true);
      expect(archived.gitWorktree).toBeNull();
      expect(existsSync(wtDir)).toBe(false);
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
      rmSync(`${repoDir}-wt`, { recursive: true, force: true });
    }
  });

  test('deleteWorktree failure still archives and keeps gitWorktree', async () => {
    const session = await seedSession(projectWithoutHook.id, {
      prompt: 'Worktree session bad path',
      name: 'Delete WT Failure',
      startImmediately: false,
    });
    await updateSessionFields(session.id, { gitWorktree: '/tmp/definitely-not-a-worktree' });

    const archived = await archiveSession(session.id, { deleteWorktree: true });

    expect(archived.archived).toBe(true);
    expect(archived.gitWorktree).toBe('/tmp/definitely-not-a-worktree');
  });
});
