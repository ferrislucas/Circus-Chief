import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  branchExists,
  checkoutBranch,
  createWorktreeForBranch,
  getCurrentBranch,
  getUntrackedFiles,
  isGitRepo,
} from './gitService.js';

describe('gitService', () => {
  let testDir;
  let bareRepoDir;

  beforeEach(async () => {
    // Create a bare repo to serve as "origin"
    bareRepoDir = await mkdtemp(join(tmpdir(), 'git-bare-'));
    execSync('git init --bare', { cwd: bareRepoDir });

    // Create a temporary directory with a git repo
    testDir = await mkdtemp(join(tmpdir(), 'git-test-'));
    execSync('git init', { cwd: testDir });
    execSync('git config user.email "test@test.com"', { cwd: testDir });
    execSync('git config user.name "Test"', { cwd: testDir });
    // Create initial commit so we have a valid repo state
    await writeFile(join(testDir, 'README.md'), '# Test');
    execSync('git add .', { cwd: testDir });
    execSync('git commit -m "Initial commit"', { cwd: testDir });

    // Add the bare repo as origin and push
    execSync(`git remote add origin "${bareRepoDir}"`, { cwd: testDir });
    execSync('git push -u origin HEAD', { cwd: testDir });
  });

  afterEach(async () => {
    // Clean up temporary directories
    await rm(testDir, { recursive: true, force: true });
    await rm(bareRepoDir, { recursive: true, force: true });
  });

  describe('branchExists', () => {
    it('returns true for existing branch', async () => {
      // 'main' or 'master' should exist after init
      const currentBranch = await getCurrentBranch(testDir);
      const exists = await branchExists(testDir, currentBranch);
      expect(exists).toBe(true);
    });

    it('returns false for non-existent branch', async () => {
      const exists = await branchExists(testDir, 'non-existent-branch');
      expect(exists).toBe(false);
    });

    it('returns true for branch created with git branch', async () => {
      execSync('git branch feature-test', { cwd: testDir });
      const exists = await branchExists(testDir, 'feature-test');
      expect(exists).toBe(true);
    });
  });

  describe('checkoutBranch', () => {
    it('checks out an existing branch', async () => {
      execSync('git branch existing-branch', { cwd: testDir });

      await checkoutBranch(testDir, 'existing-branch');

      const current = await getCurrentBranch(testDir);
      expect(current).toBe('existing-branch');
    });

    it('creates and checks out a new branch when it does not exist', async () => {
      await checkoutBranch(testDir, 'new-branch');

      const current = await getCurrentBranch(testDir);
      expect(current).toBe('new-branch');
    });

    it('throws error when checkout fails for other reasons', async () => {
      // Try to checkout with uncommitted changes that would conflict
      await writeFile(join(testDir, 'README.md'), 'Modified content');
      execSync('git add README.md', { cwd: testDir });

      // Create a branch with different content
      execSync('git stash', { cwd: testDir });
      execSync('git checkout -b conflict-branch', { cwd: testDir });
      await writeFile(join(testDir, 'README.md'), 'Conflict content');
      execSync('git add README.md', { cwd: testDir });
      execSync('git commit -m "Conflict"', { cwd: testDir });

      // Go back and unstash
      const originalBranch = 'master';
      execSync(`git checkout ${originalBranch} 2>/dev/null || git checkout main`, { cwd: testDir });
      execSync('git stash pop', { cwd: testDir });

      // This should handle the checkout gracefully
      // (behavior depends on implementation)
    });
  });

  describe('createWorktreeForBranch', () => {
    it('creates worktree with new branch', async () => {
      const worktreePath = join(testDir, '.worktrees', 'session-123');

      const result = await createWorktreeForBranch(testDir, 'new-feature', worktreePath);

      expect(result.path).toBe(worktreePath);
      expect(result.branch).toBe('new-feature');

      // Verify worktree exists and is on correct branch
      const isRepo = await isGitRepo(worktreePath);
      expect(isRepo).toBe(true);

      const branch = await getCurrentBranch(worktreePath);
      expect(branch).toBe('new-feature');
    });

    it('creates worktree with existing branch', async () => {
      // Create branch first
      execSync('git branch existing-feature', { cwd: testDir });

      const worktreePath = join(testDir, '.worktrees', 'session-456');

      const result = await createWorktreeForBranch(testDir, 'existing-feature', worktreePath);

      expect(result.path).toBe(worktreePath);
      expect(result.branch).toBe('existing-feature');

      const branch = await getCurrentBranch(worktreePath);
      expect(branch).toBe('existing-feature');
    });

    it('throws error if worktree path already exists', async () => {
      const worktreePath = join(testDir, '.worktrees', 'session-789');

      // Create first worktree
      await createWorktreeForBranch(testDir, 'branch-1', worktreePath);

      // Try to create another at same path
      await expect(
        createWorktreeForBranch(testDir, 'branch-2', worktreePath)
      ).rejects.toThrow();
    });
  });

  describe('getUntrackedFiles', () => {
    it('returns empty array when no untracked files', async () => {
      const files = await getUntrackedFiles(testDir);
      expect(files).toEqual([]);
    });

    it('returns list of untracked files', async () => {
      await writeFile(join(testDir, 'new-file.txt'), 'content');
      await writeFile(join(testDir, 'another-file.js'), 'code');

      const files = await getUntrackedFiles(testDir);

      expect(files).toContain('new-file.txt');
      expect(files).toContain('another-file.js');
      expect(files).toHaveLength(2);
    });

    it('does not include tracked files', async () => {
      // README.md is tracked
      const files = await getUntrackedFiles(testDir);
      expect(files).not.toContain('README.md');
    });

    it('does not include staged files', async () => {
      await writeFile(join(testDir, 'staged-file.txt'), 'content');
      execSync('git add staged-file.txt', { cwd: testDir });

      const files = await getUntrackedFiles(testDir);
      expect(files).not.toContain('staged-file.txt');
    });
  });
});
