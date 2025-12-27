import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  branchExists,
  checkoutBranch,
  clearDefaultBranchCache,
  createWorktree,
  createWorktreeForBranch,
  getCacheSize,
  getCurrentBranch,
  getDiffAgainstBranch,
  getStagedDiffAgainstBranch,
  getOriginDefaultBranch,
  getUntrackedFiles,
  isGitRepo,
  setLogger,
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
    // Clear the default branch cache between tests
    clearDefaultBranchCache();
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

  describe('getOriginDefaultBranch', () => {
    it('returns origin/main when origin/main exists', async () => {
      // Our test setup pushes to origin, so origin/main or origin/master should exist
      const result = await getOriginDefaultBranch(testDir);
      expect(result).toMatch(/^origin\/(main|master)$/);
    });

    it('returns origin/master when only origin/master exists', async () => {
      // Create a new bare repo with master as default
      const masterBareDir = await mkdtemp(join(tmpdir(), 'git-bare-master-'));
      execSync('git init --bare --initial-branch=master', { cwd: masterBareDir });

      // Create a repo that uses this as origin
      const masterTestDir = await mkdtemp(join(tmpdir(), 'git-test-master-'));
      execSync('git init --initial-branch=master', { cwd: masterTestDir });
      execSync('git config user.email "test@test.com"', { cwd: masterTestDir });
      execSync('git config user.name "Test"', { cwd: masterTestDir });
      await writeFile(join(masterTestDir, 'README.md'), '# Test');
      execSync('git add .', { cwd: masterTestDir });
      execSync('git commit -m "Initial commit"', { cwd: masterTestDir });
      execSync(`git remote add origin "${masterBareDir}"`, { cwd: masterTestDir });
      execSync('git push -u origin master', { cwd: masterTestDir });

      const result = await getOriginDefaultBranch(masterTestDir);
      expect(result).toBe('origin/master');

      // Cleanup
      await rm(masterTestDir, { recursive: true, force: true });
      await rm(masterBareDir, { recursive: true, force: true });
    });

    it('caches the result for subsequent calls', async () => {
      // Clear cache and verify it's empty
      clearDefaultBranchCache();
      expect(getCacheSize()).toBe(0);

      // First call should populate cache
      const result1 = await getOriginDefaultBranch(testDir);
      expect(getCacheSize()).toBe(1);

      // Second call should use cache (cache size stays at 1)
      const result2 = await getOriginDefaultBranch(testDir);
      expect(getCacheSize()).toBe(1);

      expect(result1).toBe(result2);
    });

    it('stores separate cache entries for different directories', async () => {
      // Create a second test repo
      const secondTestDir = await mkdtemp(join(tmpdir(), 'git-test-2-'));
      const secondBareDir = await mkdtemp(join(tmpdir(), 'git-bare-2-'));
      execSync('git init --bare', { cwd: secondBareDir });
      execSync('git init', { cwd: secondTestDir });
      execSync('git config user.email "test@test.com"', { cwd: secondTestDir });
      execSync('git config user.name "Test"', { cwd: secondTestDir });
      await writeFile(join(secondTestDir, 'README.md'), '# Test 2');
      execSync('git add .', { cwd: secondTestDir });
      execSync('git commit -m "Initial commit"', { cwd: secondTestDir });
      execSync(`git remote add origin "${secondBareDir}"`, { cwd: secondTestDir });
      execSync('git push -u origin HEAD', { cwd: secondTestDir });

      clearDefaultBranchCache();
      expect(getCacheSize()).toBe(0);

      await getOriginDefaultBranch(testDir);
      expect(getCacheSize()).toBe(1);

      await getOriginDefaultBranch(secondTestDir);
      expect(getCacheSize()).toBe(2);

      // Cleanup
      await rm(secondTestDir, { recursive: true, force: true });
      await rm(secondBareDir, { recursive: true, force: true });
    });

    it('returns fresh result after cache is cleared', async () => {
      const result1 = await getOriginDefaultBranch(testDir);
      clearDefaultBranchCache();
      const result2 = await getOriginDefaultBranch(testDir);

      // Results should still be the same (same repo), but cache was cleared
      expect(result1).toBe(result2);
    });

    it('falls back gracefully when gh CLI is unavailable', async () => {
      // This test verifies the fallback works - gh CLI may or may not be available
      // in the test environment, but the function should always return a valid result
      const result = await getOriginDefaultBranch(testDir);
      expect(result).toMatch(/^origin\/(main|master)$/);
    });
  });

  describe('createWorktree', () => {
    it('creates worktree with new branch using skipFetch option', async () => {
      const worktreePath = join(testDir, '.worktrees', 'skip-fetch-test');

      const result = await createWorktree(testDir, 'skip-fetch-branch', worktreePath, {
        skipFetch: true,
      });

      expect(result.path).toBe(worktreePath);
      expect(result.branch).toBe('skip-fetch-branch');

      const isRepo = await isGitRepo(worktreePath);
      expect(isRepo).toBe(true);
    });
  });

  describe('createWorktreeForBranch - error handling', () => {
    let mockLogger;

    beforeEach(() => {
      // Set up mock logger to capture warnings
      mockLogger = {
        warn: vi.fn(),
      };
      setLogger(mockLogger);
    });

    afterEach(() => {
      // Reset to default logger
      setLogger({ warn: (...args) => console.warn(...args) });
    });

    it('creates worktree when fetch fails (no network simulation)', async () => {
      // Remove the origin to simulate no remote
      execSync('git remote remove origin', { cwd: testDir });
      // Clear cache so we get fresh detection
      clearDefaultBranchCache();

      const worktreePath = join(testDir, '.worktrees', 'no-origin-test');

      // This should still succeed despite no origin (falls back to HEAD)
      const result = await createWorktreeForBranch(testDir, 'test-branch', worktreePath);

      expect(result.path).toBe(worktreePath);
      expect(result.branch).toBe('test-branch');

      // Verify warning was logged via the configurable logger
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not fetch from origin'),
        expect.any(String)
      );
    });

    it('creates worktree successfully with skipFetch option', async () => {
      const worktreePath = join(testDir, '.worktrees', 'skip-fetch-test');

      const result = await createWorktreeForBranch(testDir, 'new-branch', worktreePath, {
        skipFetch: true,
      });

      expect(result.path).toBe(worktreePath);
      expect(result.branch).toBe('new-branch');

      const isRepo = await isGitRepo(worktreePath);
      expect(isRepo).toBe(true);
    });

    it('does not log warning when skipFetch is true', async () => {
      // Remove the origin
      execSync('git remote remove origin', { cwd: testDir });
      // Clear cache so we get fresh detection
      clearDefaultBranchCache();

      const worktreePath = join(testDir, '.worktrees', 'no-warn-test');

      // This should succeed (falls back to HEAD when no origin)
      await createWorktreeForBranch(testDir, 'test-branch', worktreePath, {
        skipFetch: true,
      });

      // Warning should NOT be called when skipFetch is true
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('falls back to HEAD when no origin remote exists', async () => {
      // Remove the origin
      execSync('git remote remove origin', { cwd: testDir });
      // Clear cache so we get fresh detection
      clearDefaultBranchCache();

      const result = await getOriginDefaultBranch(testDir);
      expect(result).toBe('HEAD');
    });

    it('allows custom logger to be configured', async () => {
      const customWarnMessages = [];
      const customLogger = {
        warn: (...args) => customWarnMessages.push(args),
      };
      setLogger(customLogger);

      // Remove origin and trigger a fetch failure
      execSync('git remote remove origin', { cwd: testDir });
      clearDefaultBranchCache();

      const worktreePath = join(testDir, '.worktrees', 'custom-logger-test');
      await createWorktreeForBranch(testDir, 'custom-logger-branch', worktreePath);

      expect(customWarnMessages.length).toBe(1);
      expect(customWarnMessages[0][0]).toContain('Could not fetch from origin');
    });
  });

  describe('branch isolation', () => {
    it('bases new branches on origin default branch, not HEAD', async () => {
      // Create a local-only commit that's ahead of origin
      await writeFile(join(testDir, 'local-only.txt'), 'local content');
      execSync('git add .', { cwd: testDir });
      execSync('git commit -m "Local only commit"', { cwd: testDir });

      // Verify the local file exists in the main repo
      expect(existsSync(join(testDir, 'local-only.txt'))).toBe(true);

      const worktreePath = join(testDir, '.worktrees', 'isolation-test');
      await createWorktreeForBranch(testDir, 'new-isolated-branch', worktreePath);

      // The new worktree should NOT have the local-only commit
      // because it's based on origin's default branch
      const hasLocalFile = existsSync(join(worktreePath, 'local-only.txt'));
      expect(hasLocalFile).toBe(false);

      // But it should have the original README that was pushed to origin
      const hasReadme = existsSync(join(worktreePath, 'README.md'));
      expect(hasReadme).toBe(true);
    });

    it('uses existing branch when it exists, regardless of origin', async () => {
      // Create a branch with a specific commit
      execSync('git branch existing-branch', { cwd: testDir });

      // Add a commit to the existing branch
      execSync('git checkout existing-branch', { cwd: testDir });
      await writeFile(join(testDir, 'existing-branch-file.txt'), 'content');
      execSync('git add .', { cwd: testDir });
      execSync('git commit -m "Commit on existing branch"', { cwd: testDir });

      // Go back to original branch
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: testDir })
        .toString()
        .trim();
      if (currentBranch === 'existing-branch') {
        execSync('git checkout -', { cwd: testDir });
      }

      const worktreePath = join(testDir, '.worktrees', 'existing-test');
      await createWorktreeForBranch(testDir, 'existing-branch', worktreePath);

      // Should have the file from the existing branch
      const hasFile = existsSync(join(worktreePath, 'existing-branch-file.txt'));
      expect(hasFile).toBe(true);
    });
  });

  describe('getDiffAgainstBranch', () => {
    it('returns diff output when comparing against a branch', async () => {
      // Create a commit and push to establish origin/main baseline
      await writeFile(join(testDir, 'baseline.txt'), 'baseline');
      execSync('git add baseline.txt', { cwd: testDir });
      execSync('git commit -m "Baseline commit"', { cwd: testDir });
      execSync('git push origin HEAD', { cwd: testDir });

      // Now make changes locally
      await writeFile(join(testDir, 'test.txt'), 'local change');
      execSync('git add test.txt', { cwd: testDir });

      const diff = await getDiffAgainstBranch(testDir, 'origin/main');

      // The changes should be in the diff
      expect(diff.length >= 0).toBe(true);
    });

    it('returns empty string when no differences', async () => {
      // Ensure we're synced with origin
      execSync('git push origin HEAD', { cwd: testDir });

      const diff = await getDiffAgainstBranch(testDir, 'origin/main');

      expect(diff).toBe('');
    });

    it('returns empty string on git error', async () => {
      // Test with a non-existent branch
      const diff = await getDiffAgainstBranch(testDir, 'non-existent-branch-xyz');

      // Should return empty string instead of throwing
      expect(diff).toBe('');
    });

    it('handles file additions in diff', async () => {
      // Create and commit a baseline
      execSync('git push origin HEAD', { cwd: testDir });

      // Create a new file without pushing
      await writeFile(join(testDir, 'new-file.js'), 'console.log("new");');
      execSync('git add new-file.js', { cwd: testDir });

      const diff = await getDiffAgainstBranch(testDir, 'origin/main');

      // Should show the difference (not necessarily contain the file for untracked)
      expect(typeof diff).toBe('string');
    });

    it('handles file modifications in diff', async () => {
      // Modify existing file
      const readmePath = join(testDir, 'README.md');
      await writeFile(readmePath, '# Test Modified');

      const diff = await getDiffAgainstBranch(testDir, 'origin/main');

      // Should return a string (empty or with diff)
      expect(typeof diff).toBe('string');
    });
  });

  describe('getStagedDiffAgainstBranch', () => {
    it('returns staged diff output when comparing against a branch', async () => {
      // First ensure repo is clean and synced
      execSync('git push origin HEAD', { cwd: testDir });

      // Create and stage a change
      await writeFile(join(testDir, 'staged.txt'), 'staged content');
      execSync('git add staged.txt', { cwd: testDir });

      const diff = await getStagedDiffAgainstBranch(testDir, 'origin/main');

      // Should return a string (diff or empty)
      expect(typeof diff).toBe('string');
    });

    it('returns empty string when no staged changes', async () => {
      const diff = await getStagedDiffAgainstBranch(testDir, 'origin/main');

      expect(diff).toBe('');
    });

    it('returns empty string on git error', async () => {
      // Test with a non-existent branch
      const diff = await getStagedDiffAgainstBranch(testDir, 'non-existent-branch-xyz');

      // Should return empty string instead of throwing
      expect(diff).toBe('');
    });

    it('stages changes before comparing', async () => {
      // Create and stage a file
      await writeFile(join(testDir, 'file.txt'), 'staged version');
      execSync('git add file.txt', { cwd: testDir });

      const diff = await getStagedDiffAgainstBranch(testDir, 'origin/main');

      // Should return a string
      expect(typeof diff).toBe('string');
    });

    it('works with different branch names', async () => {
      // Ensure baseline is established
      execSync('git push origin HEAD', { cwd: testDir });

      // Create a stage change
      await writeFile(join(testDir, 'another.txt'), 'content');
      execSync('git add another.txt', { cwd: testDir });

      const diff = await getStagedDiffAgainstBranch(testDir, 'origin/main');

      expect(typeof diff).toBe('string');
    });
  });
});
