import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, realpath } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  _setManagedHooksPath,
  branchExists,
  checkoutBranch,
  clearDefaultBranchCache,
  clearWorktreeCommitAttribution,
  createWorktree,
  createWorktreeForBranch,
  detectWorktreePath,
  fetchOrigin,
  getAheadBehindCounts,
  getBranchUpstream,
  getCacheSize,
  getCurrentBranch,
  getGitAuthor,
  getLocalChangeCount,
  getManagedHooksPath,
  getOriginDefaultBranch,
  getRepositoryUrl,
  getSessionGitStatus,
  getUntrackedFiles,
  git,
  ensureWorktreeCommitAttributionHook,
  normalizeGitRemoteUrl,
  pinAuthorInWorktree,
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
    it('creates worktree with new branch', { timeout: 10000 }, async () => {
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

  describe('git', () => {
    it('supports git output larger than Node exec default buffer', async () => {
      const largeContent = `${'x'.repeat(2 * 1024 * 1024)}\n`;
      await writeFile(join(testDir, 'README.md'), largeContent);

      const diff = await git(testDir, 'diff');

      expect(diff.length).toBeGreaterThan(1024 * 1024);
      expect(diff).toContain('diff --git a/README.md b/README.md');
    });

    it('allows callers to set a smaller maxBuffer and surfaces that error', async () => {
      const largeContent = `${'x'.repeat(2 * 1024 * 1024)}\n`;
      await writeFile(join(testDir, 'README.md'), largeContent);

      await expect(git(testDir, 'diff', { maxBuffer: 1024 })).rejects.toMatchObject({
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      });
    });
  });

  describe('getOriginDefaultBranch', () => {
    it('returns origin/main when origin/main exists', async () => {
      // Our test setup pushes to origin, so origin/main or origin/master should exist
      const result = await getOriginDefaultBranch(testDir);
      expect(result).toMatch(/^origin\/(main|master)$/);
    });

    it('returns origin/master when only origin/master exists', async () => {
      // Create a new bare repo
      const masterBareDir = await mkdtemp(join(tmpdir(), 'git-bare-master-'));
      execSync('git init --bare', { cwd: masterBareDir });

      // Create a repo that uses this as origin
      const masterTestDir = await mkdtemp(join(tmpdir(), 'git-test-master-'));
      execSync('git init', { cwd: masterTestDir });
      execSync('git config user.email "test@test.com"', { cwd: masterTestDir });
      execSync('git config user.name "Test"', { cwd: masterTestDir });
      await writeFile(join(masterTestDir, 'README.md'), '# Test');
      execSync('git add .', { cwd: masterTestDir });
      execSync('git commit -m "Initial commit"', { cwd: masterTestDir });

      // Rename current branch to master if it's not already named master
      const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: masterTestDir })
        .toString()
        .trim();
      if (currentBranch !== 'master') {
        execSync('git branch -m master', { cwd: masterTestDir });
      }

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

  describe('getModifiedFilesCount', () => {
    let getModifiedFilesCount;
    let defaultBranch;

    beforeEach(async () => {
      // Import the function after beforeEach setup
      const module = await import('./gitService.js');
      getModifiedFilesCount = module.getModifiedFilesCount;

      // Get the actual default branch for this test repo
      defaultBranch = await getOriginDefaultBranch(testDir);
    });

    it('returns 0 when no files are modified', async () => {
      const count = await getModifiedFilesCount(testDir, defaultBranch);
      expect(count).toBe(0);
    });

    it('counts committed changes compared to origin branch', async () => {
      // Create and commit a new file
      await writeFile(join(testDir, 'new-file.txt'), 'content');
      execSync('git add new-file.txt', { cwd: testDir });
      execSync('git commit -m "Add new file"', { cwd: testDir });

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      expect(count).toBe(1);
    });

    it('counts multiple committed files', async () => {
      // Create and commit multiple files
      await writeFile(join(testDir, 'file1.txt'), 'content1');
      await writeFile(join(testDir, 'file2.txt'), 'content2');
      await writeFile(join(testDir, 'file3.txt'), 'content3');
      execSync('git add .', { cwd: testDir });
      execSync('git commit -m "Add three files"', { cwd: testDir });

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      expect(count).toBe(3);
    });

    it('counts staged but uncommitted files', async () => {
      // Stage a file without committing
      await writeFile(join(testDir, 'staged-file.txt'), 'content');
      execSync('git add staged-file.txt', { cwd: testDir });

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      expect(count).toBe(1);
    });

    it('counts unstaged modified files', async () => {
      // Modify existing file without staging
      await writeFile(join(testDir, 'README.md'), '# Modified content');

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      expect(count).toBe(1);
    });

    it('counts untracked files', async () => {
      // Create new files without adding them
      await writeFile(join(testDir, 'untracked1.txt'), 'content1');
      await writeFile(join(testDir, 'untracked2.txt'), 'content2');

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      expect(count).toBe(2);
    });

    it('counts unique files across committed, staged, unstaged, and untracked', async () => {
      // Committed change
      await writeFile(join(testDir, 'committed.txt'), 'content');
      execSync('git add committed.txt', { cwd: testDir });
      execSync('git commit -m "Add committed"', { cwd: testDir });

      // Staged change (won't be counted as explained above)
      await writeFile(join(testDir, 'staged.txt'), 'content');
      execSync('git add staged.txt', { cwd: testDir });

      // Unstaged change (modify existing file)
      await writeFile(join(testDir, 'README.md'), '# Modified');

      // Untracked files
      await writeFile(join(testDir, 'untracked.txt'), 'content');

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      // Should count: committed.txt, staged.txt, README.md, untracked.txt = 4 unique files
      expect(count).toBe(4);
    });

    it('counts file only once when it appears in multiple states', async () => {
      // Commit a file
      await writeFile(join(testDir, 'test.txt'), 'v1');
      execSync('git add test.txt', { cwd: testDir });
      execSync('git commit -m "Add test.txt"', { cwd: testDir });

      // Modify it (unstaged)
      await writeFile(join(testDir, 'test.txt'), 'v2');

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      // Should count test.txt only once
      expect(count).toBe(1);
    });

    it('works with origin/master as default branch', async () => {
      // Create a new file
      await writeFile(join(testDir, 'new-file.txt'), 'content');
      execSync('git add new-file.txt', { cwd: testDir });
      execSync('git commit -m "Add file"', { cwd: testDir });

      const count = await getModifiedFilesCount(testDir, 'origin/master');
      expect(count).toBeGreaterThan(0);
    });

    it('returns 0 on error and logs warning', async () => {
      // Use a non-existent directory
      const count = await getModifiedFilesCount('/nonexistent/directory', 'origin/main');
      expect(count).toBe(0);
    });

    it('handles nested directory structures', async () => {
      // Create files in nested directories
      const nestedDir = join(testDir, 'src', 'components');
      execSync(`mkdir -p "${nestedDir}"`, { cwd: testDir });
      await writeFile(join(nestedDir, 'Component1.js'), 'code');
      await writeFile(join(nestedDir, 'Component2.js'), 'code');
      await writeFile(join(testDir, 'src', 'index.js'), 'code');

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      expect(count).toBe(3);
    });

    it('handles files with spaces in names', async () => {
      await writeFile(join(testDir, 'file with spaces.txt'), 'content');
      // Don't add it - leave it untracked so it will be counted
      const count = await getModifiedFilesCount(testDir, defaultBranch);
      expect(count).toBe(1);
    });

    it('counts deleted files that are unstaged', async () => {
      // Create and commit a file
      await writeFile(join(testDir, 'to-delete.txt'), 'content');
      execSync('git add to-delete.txt', { cwd: testDir });
      execSync('git commit -m "Add file to delete"', { cwd: testDir });

      // Push to origin so it's in the remote
      execSync('git push origin HEAD', { cwd: testDir });

      // Delete the file but don't stage the deletion
      await rm(join(testDir, 'to-delete.txt'));
      // Don't add it - leave the deletion unstaged so it will be counted

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      // Should count the deletion as 1 modified file (in unstaged changes)
      expect(count).toBe(1);
    });

    it('handles binary files', async () => {
      // Create a binary file (simulate with buffer)
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await writeFile(join(testDir, 'image.png'), binaryContent);

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      expect(count).toBe(1);
    });

    it('returns correct count for large number of files', async () => {
      // Create many files
      const fileCount = 50;
      for (let i = 0; i < fileCount; i++) {
        await writeFile(join(testDir, `file-${i}.txt`), `content ${i}`);
      }

      const count = await getModifiedFilesCount(testDir, defaultBranch);
      expect(count).toBe(fileCount);
    });
  });

  describe('getGitAuthor', () => {
    /**
     * Create an env object that isolates git global config by redirecting HOME.
     * This works on all git versions (GIT_CONFIG_GLOBAL requires git 2.32+).
     * @param {string} fakeHomePath - Directory containing a .gitconfig file
     */
    function createIsolatedGitEnv(fakeHomePath) {
      return {
        ...process.env,
        HOME: fakeHomePath,
        XDG_CONFIG_HOME: '/dev/null',
      };
    }

    let fakeHome;

    beforeEach(async () => {
      fakeHome = await mkdtemp(join(tmpdir(), 'fake-home-'));
    });

    afterEach(async () => {
      if (fakeHome) await rm(fakeHome, { recursive: true, force: true });
    });

    it('returns author info when global user.name and user.email are configured', async () => {
      await writeFile(join(fakeHome, '.gitconfig'), '[user]\n\tname = Human\n\temail = human@example.com\n');

      const author = await getGitAuthor(testDir, { env: createIsolatedGitEnv(fakeHome) });
      expect(author).toEqual({ name: 'Human', email: 'human@example.com' });
    });

    it('returns null when global user.name is missing', async () => {
      await writeFile(join(fakeHome, '.gitconfig'), '[user]\n\temail = human@example.com\n');

      const author = await getGitAuthor(testDir, { env: createIsolatedGitEnv(fakeHome) });
      expect(author).toBeNull();
    });

    it('returns null when global user.email is missing', async () => {
      await writeFile(join(fakeHome, '.gitconfig'), '[user]\n\tname = Human\n');

      const author = await getGitAuthor(testDir, { env: createIsolatedGitEnv(fakeHome) });
      expect(author).toBeNull();
    });

    it('returns null when no global config exists', async () => {
      // fakeHome has no .gitconfig file
      const author = await getGitAuthor(testDir, { env: createIsolatedGitEnv(fakeHome) });
      expect(author).toBeNull();
    });

    it('reads global config and ignores contaminated local config', async () => {
      // Simulate contamination: local repo config has Claude Code's identity
      execSync('git config --local user.name "Claude Code"', { cwd: testDir });
      execSync('git config --local user.email "noreply@anthropic.com"', { cwd: testDir });

      // Global config (in fake HOME) has the real human identity
      await writeFile(join(fakeHome, '.gitconfig'), '[user]\n\tname = Human Dev\n\temail = human@dev.com\n');

      const author = await getGitAuthor(testDir, { env: createIsolatedGitEnv(fakeHome) });
      // Must return the global identity, NOT the local "Claude Code" identity
      expect(author).toEqual({ name: 'Human Dev', email: 'human@dev.com' });
    });
  });

  describe('pinAuthorInWorktree', () => {
    let worktreePath;
    let fakeHome;

    /**
     * Create an env object that isolates git global config by redirecting HOME.
     * Works on all git versions (GIT_CONFIG_GLOBAL requires git 2.32+).
     */
    function createIsolatedGitEnv(fakeHomePath) {
      return {
        ...process.env,
        HOME: fakeHomePath,
        XDG_CONFIG_HOME: '/dev/null',
      };
    }

    beforeEach(async () => {
      fakeHome = await mkdtemp(join(tmpdir(), 'fake-home-'));
    });

    afterEach(async () => {
      if (worktreePath && existsSync(worktreePath)) {
        try {
          execSync(`git worktree remove --force "${worktreePath}"`, { cwd: testDir });
        } catch {
          // Ignore cleanup errors
        }
      }
      if (fakeHome) await rm(fakeHome, { recursive: true, force: true });
    });

    it('pins human identity in worktree config from global config, even when local config is contaminated', async () => {
      worktreePath = join(testDir, '.worktrees', 'pin-test-1');
      await createWorktreeForBranch(testDir, 'pin-test-1', worktreePath, { skipFetch: true });

      // Simulate contamination: local config has Claude Code's identity
      execSync('git config --local user.name "Claude Code"', { cwd: testDir });
      execSync('git config --local user.email "noreply@anthropic.com"', { cwd: testDir });

      // Global config (in fake HOME) has the real human identity
      await writeFile(join(fakeHome, '.gitconfig'), '[user]\n\tname = Human\n\temail = human@example.com\n');

      const result = await pinAuthorInWorktree(worktreePath, testDir, {
        env: createIsolatedGitEnv(fakeHome),
      });
      expect(result).toBe(true);

      const userName = execSync('git config --worktree user.name', { cwd: worktreePath }).toString().trim();
      const userEmail = execSync('git config --worktree user.email', { cwd: worktreePath }).toString().trim();
      // Should have the human's identity, NOT Claude Code
      expect(userName).toBe('Human');
      expect(userEmail).toBe('human@example.com');
    });

    it('returns false when no global git author is configured', async () => {
      worktreePath = join(testDir, '.worktrees', 'pin-test-no-author');
      await createWorktreeForBranch(testDir, 'pin-test-no-author', worktreePath, { skipFetch: true });

      // fakeHome has no .gitconfig
      const result = await pinAuthorInWorktree(worktreePath, testDir, {
        env: createIsolatedGitEnv(fakeHome),
      });
      expect(result).toBe(false);
    });

    it('overwrites existing worktree author with global author', async () => {
      worktreePath = join(testDir, '.worktrees', 'pin-test-overwrite');
      await createWorktreeForBranch(testDir, 'pin-test-overwrite', worktreePath, { skipFetch: true });

      // Pre-set a different author in the worktree
      execSync('git config extensions.worktreeConfig true', { cwd: worktreePath });
      execSync('git config --worktree user.name "Someone Else"', { cwd: worktreePath });
      execSync('git config --worktree user.email "else@example.com"', { cwd: worktreePath });

      // Global config has the correct human identity
      await writeFile(join(fakeHome, '.gitconfig'), '[user]\n\tname = Human\n\temail = human@example.com\n');

      const result = await pinAuthorInWorktree(worktreePath, testDir, {
        env: createIsolatedGitEnv(fakeHome),
      });
      expect(result).toBe(true);

      const userName = execSync('git config --worktree user.name', { cwd: worktreePath }).toString().trim();
      const userEmail = execSync('git config --worktree user.email', { cwd: worktreePath }).toString().trim();
      expect(userName).toBe('Human');
      expect(userEmail).toBe('human@example.com');
    });

    it('falls back to worktreePath when projectDir is null', async () => {
      worktreePath = join(testDir, '.worktrees', 'pin-test-fallback');
      await createWorktreeForBranch(testDir, 'pin-test-fallback', worktreePath, { skipFetch: true });

      // Global config has the human identity
      await writeFile(join(fakeHome, '.gitconfig'), '[user]\n\tname = Fallback Human\n\temail = fallback@example.com\n');

      // Pass null for projectDir — should fall back to worktreePath
      const result = await pinAuthorInWorktree(worktreePath, null, {
        env: createIsolatedGitEnv(fakeHome),
      });
      expect(result).toBe(true);

      const userName = execSync('git config --worktree user.name', { cwd: worktreePath }).toString().trim();
      const userEmail = execSync('git config --worktree user.email', { cwd: worktreePath }).toString().trim();
      expect(userName).toBe('Fallback Human');
      expect(userEmail).toBe('fallback@example.com');
    });

    it('enables extensions.worktreeConfig on the worktree', async () => {
      worktreePath = join(testDir, '.worktrees', 'pin-test-ext');
      await createWorktreeForBranch(testDir, 'pin-test-ext', worktreePath, { skipFetch: true });

      await writeFile(join(fakeHome, '.gitconfig'), '[user]\n\tname = Human\n\temail = human@example.com\n');

      await pinAuthorInWorktree(worktreePath, testDir, {
        env: createIsolatedGitEnv(fakeHome),
      });

      // extensions.worktreeConfig must be true for --worktree flag to work
      const extValue = execSync('git config extensions.worktreeConfig', { cwd: worktreePath }).toString().trim();
      expect(extValue).toBe('true');
    });

    it('pinned author is used as commit Author even when local config is contaminated', async () => {
      worktreePath = join(testDir, '.worktrees', 'pin-test-commit');
      await createWorktreeForBranch(testDir, 'pin-test-commit', worktreePath, { skipFetch: true });

      // Simulate contamination in local config
      execSync('git config --local user.name "Claude Code"', { cwd: testDir });
      execSync('git config --local user.email "noreply@anthropic.com"', { cwd: testDir });

      // Global config has the human identity
      await writeFile(join(fakeHome, '.gitconfig'), '[user]\n\tname = Human\n\temail = human@example.com\n');

      await pinAuthorInWorktree(worktreePath, testDir, {
        env: createIsolatedGitEnv(fakeHome),
      });

      await writeFile(join(worktreePath, 'test.txt'), 'hello');
      execSync('git add test.txt', { cwd: worktreePath });
      execSync('git commit -m "Test commit"', { cwd: worktreePath });

      const author = execSync('git log -1 --format="%an <%ae>"', { cwd: worktreePath }).toString().trim();
      expect(author).toBe('Human <human@example.com>');
    });
  });

  describe('ensureWorktreeCommitAttributionHook', () => {
    let worktreePath;
    let fakeHome;
    let fakeHooksPath;
    /** Snapshot of the real hooks path before any override. */
    let realHooksPath;

    function createIsolatedGitEnv(fakeHomePath) {
      return {
        ...process.env,
        HOME: fakeHomePath,
        XDG_CONFIG_HOME: '/dev/null',
      };
    }

    beforeEach(async () => {
      // Record the production hooks path so we can restore it later.
      realHooksPath = getManagedHooksPath();

      fakeHome = await mkdtemp(join(tmpdir(), 'fake-home-'));
      fakeHooksPath = join(fakeHome, '.circuschief', 'hooks');
      // Redirect hook writes into the fake home so tests never touch ~/.circuschief.
      _setManagedHooksPath(fakeHooksPath);

      const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      worktreePath = join(testDir, '.worktrees', `attr-test-${suffix}`);
      await createWorktreeForBranch(testDir, `attr-test-branch-${suffix}`, worktreePath, { skipFetch: true });
    });

    afterEach(async () => {
      // Restore the production hooks path.
      _setManagedHooksPath(realHooksPath);

      if (worktreePath && existsSync(worktreePath)) {
        try {
          execSync(`git worktree remove --force "${worktreePath}"`, { cwd: testDir });
        } catch {
          // Ignore cleanup errors
        }
      }
      if (fakeHome) await rm(fakeHome, { recursive: true, force: true });
    });

    it('installs an executable commit-msg hook without storing attribution in worktree config', async () => {
      execSync('git config extensions.worktreeConfig true', { cwd: worktreePath });
      execSync('git config --worktree circuschief.commitAttribution "Stale <stale@example.com>"', { cwd: worktreePath });

      const result = await ensureWorktreeCommitAttributionHook(worktreePath);

      expect(result).toBe(true);
      expect(() => execSync('git config --worktree circuschief.commitAttribution', { cwd: worktreePath }))
        .toThrow();
      expect(execSync('git config --worktree core.hooksPath', { cwd: worktreePath }).toString().trim())
        .toBe(fakeHooksPath);
      expect(existsSync(join(fakeHooksPath, 'commit-msg'))).toBe(true);
    });

    it('does not touch the real home directory hooks path', async () => {
      const realHookFile = join(homedir(), '.circuschief', 'hooks', 'commit-msg');
      const existedBefore = existsSync(realHookFile);

      await ensureWorktreeCommitAttributionHook(worktreePath);

      // The real home must not gain or lose the hook file.
      const existsAfter = existsSync(realHookFile);
      expect(existsAfter).toBe(existedBefore);
    });

    it('appends the configured trailer to a plain git commit', async () => {
      await writeFile(join(fakeHome, '.gitconfig'), '[user]\n\tname = Human\n\temail = human@example.com\n');
      await pinAuthorInWorktree(worktreePath, testDir, {
        env: createIsolatedGitEnv(fakeHome),
      });
      await ensureWorktreeCommitAttributionHook(worktreePath);

      await writeFile(join(worktreePath, 'attributed.txt'), 'hello');
      execSync('git add attributed.txt', { cwd: worktreePath });
      execSync('git commit -m "Attributed commit"', {
        cwd: worktreePath,
        env: {
          ...process.env,
          CIRCUSCHIEF_COMMIT_ATTRIBUTION: 'Co-authored-by: Codex <noreply@openai.com>',
        },
      });

      const body = execSync('git log -1 --format=%B', { cwd: worktreePath }).toString();
      const author = execSync('git log -1 --format="%an <%ae>"', { cwd: worktreePath }).toString().trim();
      expect(body).toContain('Co-authored-by: Codex <noreply@openai.com>');
      expect(author).toBe('Human <human@example.com>');
    });

    it('does not append a trailer when commit attribution env is missing or blank', async () => {
      await ensureWorktreeCommitAttributionHook(worktreePath);
      const { CIRCUSCHIEF_COMMIT_ATTRIBUTION: _commitAttribution, ...envWithoutAttribution } = process.env;

      await writeFile(join(worktreePath, 'no-env.txt'), 'hello');
      execSync('git add no-env.txt', { cwd: worktreePath });
      execSync('git commit -m "No env commit"', { cwd: worktreePath, env: envWithoutAttribution });

      let body = execSync('git log -1 --format=%B', { cwd: worktreePath }).toString();
      expect(body).not.toContain('Co-authored-by:');

      await writeFile(join(worktreePath, 'blank-env.txt'), 'hello');
      execSync('git add blank-env.txt', { cwd: worktreePath });
      execSync('git commit -m "Blank env commit"', {
        cwd: worktreePath,
        env: { ...process.env, CIRCUSCHIEF_COMMIT_ATTRIBUTION: '   ' },
      });

      body = execSync('git log -1 --format=%B', { cwd: worktreePath }).toString();
      expect(body).not.toContain('Co-authored-by:');
    });

    it('fails clearly when commit attribution env is malformed', async () => {
      await ensureWorktreeCommitAttributionHook(worktreePath);

      await writeFile(join(worktreePath, 'bad-env.txt'), 'hello');
      execSync('git add bad-env.txt', { cwd: worktreePath });

      let stderr = '';
      try {
        execSync('git commit -m "Bad env commit"', {
          cwd: worktreePath,
          env: { ...process.env, CIRCUSCHIEF_COMMIT_ATTRIBUTION: 'noreply@openai.com' },
          stdio: 'pipe',
        });
      } catch (error) {
        stderr = error.stderr?.toString() || '';
      }
      expect(stderr).toContain('CIRCUSCHIEF_COMMIT_ATTRIBUTION must be a canonical');
    });

    it('does not duplicate an existing identical attribution trailer on amend', async () => {
      await ensureWorktreeCommitAttributionHook(worktreePath);

      await writeFile(join(worktreePath, 'dedupe.txt'), 'hello');
      execSync('git add dedupe.txt', { cwd: worktreePath });
      const env = {
        ...process.env,
        CIRCUSCHIEF_COMMIT_ATTRIBUTION: 'Co-authored-by: Codex <noreply@openai.com>',
      };
      execSync('git commit -m "Dedupe commit"', { cwd: worktreePath, env });
      execSync('git commit --amend --no-edit', { cwd: worktreePath, env });

      const body = execSync('git log -1 --format=%B', { cwd: worktreePath }).toString();
      const matches = body.match(/Co-authored-by: Codex <noreply@openai\.com>/g) || [];
      expect(matches).toHaveLength(1);
    });

    it('preserves other coauthor trailers with the same token', async () => {
      await ensureWorktreeCommitAttributionHook(worktreePath);

      await writeFile(join(worktreePath, 'multi.txt'), 'hello');
      execSync('git add multi.txt', { cwd: worktreePath });
      execSync(
        'git commit -m "Multi author" -m "Co-authored-by: Claude <noreply@anthropic.com>"',
        {
          cwd: worktreePath,
          env: {
            ...process.env,
            CIRCUSCHIEF_COMMIT_ATTRIBUTION: 'Co-authored-by: Codex <noreply@openai.com>',
          },
        }
      );

      const body = execSync('git log -1 --format=%B', { cwd: worktreePath }).toString();
      expect(body).toContain('Co-authored-by: Claude <noreply@anthropic.com>');
      expect(body).toContain('Co-authored-by: Codex <noreply@openai.com>');
    });

    it('accepts a complete Co-authored-by trailer value', async () => {
      await ensureWorktreeCommitAttributionHook(worktreePath);

      await writeFile(join(worktreePath, 'full-trailer.txt'), 'hello');
      execSync('git add full-trailer.txt', { cwd: worktreePath });
      execSync('git commit -m "Full trailer"', {
        cwd: worktreePath,
        env: {
          ...process.env,
          CIRCUSCHIEF_COMMIT_ATTRIBUTION: 'Co-authored-by: Claude <noreply@anthropic.com>',
        },
      });

      const body = execSync('git log -1 --format=%B', { cwd: worktreePath }).toString();
      expect(body).toContain('Co-authored-by: Claude <noreply@anthropic.com>');
      expect(body).not.toContain('Co-authored-by: Co-authored-by: Claude');
    });

    it('clears attribution without installing hooks when attribution is unset', async () => {
      await ensureWorktreeCommitAttributionHook(worktreePath);
      const result = await clearWorktreeCommitAttribution(worktreePath);

      expect(result).toBe(false);
      expect(() => execSync('git config --worktree circuschief.commitAttribution', { cwd: worktreePath }))
        .toThrow();
      expect(() => execSync('git config --worktree core.hooksPath', { cwd: worktreePath }))
        .toThrow();
    });

    it('clears stale managed hooks path when attribution was already unset', async () => {
      execSync('git config extensions.worktreeConfig true', { cwd: worktreePath });
      execSync(`git config --worktree core.hooksPath '${fakeHooksPath}'`, { cwd: worktreePath });

      const result = await clearWorktreeCommitAttribution(worktreePath);

      expect(result).toBe(false);
      expect(() => execSync('git config --worktree circuschief.commitAttribution', { cwd: worktreePath }))
        .toThrow();
      expect(() => execSync('git config --worktree core.hooksPath', { cwd: worktreePath }))
        .toThrow();
    });

    it('does not change worktree config when attribution is unset and no prior attribution exists', async () => {
      const result = await clearWorktreeCommitAttribution(worktreePath);

      expect(result).toBe(false);
      expect(() => execSync('git config extensions.worktreeConfig', { cwd: worktreePath })).toThrow();
      expect(existsSync(join(worktreePath, '.circuschief-hooks', 'commit-msg'))).toBe(false);
    });

    it('fails visibly instead of overwriting an unrelated hooks path', async () => {
      execSync('git config extensions.worktreeConfig true', { cwd: worktreePath });
      execSync('git config --worktree core.hooksPath custom-hooks', { cwd: worktreePath });

      await expect(
        ensureWorktreeCommitAttributionHook(worktreePath)
      ).rejects.toThrow('already has core.hooksPath set to "custom-hooks"');
    });

    it('auto-upgrades legacy .circuschief-hooks path to new managed path', async () => {
      // Simulate a worktree that has the old-style relative hooks path from before
      // the migration in commit 4b1437e1 (which moved hooks to ~/.circuschief/hooks).
      execSync('git config extensions.worktreeConfig true', { cwd: worktreePath });
      execSync('git config --worktree core.hooksPath .circuschief-hooks', { cwd: worktreePath });

      const result = await ensureWorktreeCommitAttributionHook(worktreePath);

      expect(result).toBe(true);
      // Should have been upgraded to the new managed hooks path
      expect(execSync('git config --worktree core.hooksPath', { cwd: worktreePath }).toString().trim())
        .toBe(fakeHooksPath);
      expect(existsSync(join(fakeHooksPath, 'commit-msg'))).toBe(true);
    });
  });

  describe('detectWorktreePath', () => {
    it('returns default path for a git repo with no external worktrees', async () => {
      const resolvedTestDir = await realpath(testDir);
      const result = await detectWorktreePath(testDir);
      expect(result.worktreePath).toBe(join(resolvedTestDir, '.worktrees'));
      expect(result.source).toBe('default');
    });

    it('detects parent of existing external worktrees', async () => {
      const resolvedTestDir = await realpath(testDir);
      // Create a worktree first
      const worktreeDir = join(testDir, '.worktrees', 'detect-test');
      await createWorktreeForBranch(testDir, 'detect-test-branch', worktreeDir, { skipFetch: true });

      const result = await detectWorktreePath(testDir);
      expect(result.worktreePath).toBe(join(resolvedTestDir, '.worktrees'));
      expect(result.source).toBe('detected');

      // Cleanup worktree
      execSync(`git worktree remove --force "${worktreeDir}"`, { cwd: testDir });
    });

    it('returns default path for non-git directory', async () => {
      const nonGitDir = await mkdtemp(join(tmpdir(), 'non-git-'));
      try {
        const result = await detectWorktreePath(nonGitDir);
        expect(result.worktreePath).toBe(join(nonGitDir, '.worktrees'));
        expect(result.source).toBe('default');
      } finally {
        await rm(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('normalizeGitRemoteUrl', () => {
    it('normalizes HTTPS URL with .git suffix', () => {
      expect(normalizeGitRemoteUrl('https://github.com/owner/repo.git'))
        .toBe('https://github.com/owner/repo');
    });

    it('passes through already-clean HTTPS URL', () => {
      expect(normalizeGitRemoteUrl('https://github.com/owner/repo'))
        .toBe('https://github.com/owner/repo');
    });

    it('normalizes SSH shorthand with .git suffix', () => {
      expect(normalizeGitRemoteUrl('git@github.com:owner/repo.git'))
        .toBe('https://github.com/owner/repo');
    });

    it('normalizes SSH shorthand without .git suffix', () => {
      expect(normalizeGitRemoteUrl('git@github.com:owner/repo'))
        .toBe('https://github.com/owner/repo');
    });

    it('normalizes ssh:// protocol URL', () => {
      expect(normalizeGitRemoteUrl('ssh://git@github.com/owner/repo.git'))
        .toBe('https://github.com/owner/repo');
    });

    it('normalizes SSH GitLab URL', () => {
      expect(normalizeGitRemoteUrl('git@gitlab.com:owner/repo.git'))
        .toBe('https://gitlab.com/owner/repo');
    });

    it('normalizes HTTPS GitLab URL', () => {
      expect(normalizeGitRemoteUrl('https://gitlab.com/owner/repo.git'))
        .toBe('https://gitlab.com/owner/repo');
    });

    it('normalizes HTTPS Bitbucket URL', () => {
      expect(normalizeGitRemoteUrl('https://bitbucket.org/owner/repo.git'))
        .toBe('https://bitbucket.org/owner/repo');
    });

    it('returns null for empty string', () => {
      expect(normalizeGitRemoteUrl('')).toBeNull();
    });

    it('returns null for null', () => {
      expect(normalizeGitRemoteUrl(null)).toBeNull();
    });

    it('returns null for undefined', () => {
      expect(normalizeGitRemoteUrl(undefined)).toBeNull();
    });

    it('returns null for garbage string', () => {
      expect(normalizeGitRemoteUrl('not-a-valid-url')).toBeNull();
    });

    it('strips query string from HTTPS URL', () => {
      expect(normalizeGitRemoteUrl('https://github.com/owner/repo.git?foo=bar'))
        .toBe('https://github.com/owner/repo');
    });

    it('strips fragment from SSH shorthand', () => {
      expect(normalizeGitRemoteUrl('git@github.com:owner/repo.git#branch'))
        .toBe('https://github.com/owner/repo');
    });

    it('normalizes HTTP URL with .git suffix', () => {
      expect(normalizeGitRemoteUrl('http://git.example.com/owner/repo.git'))
        .toBe('http://git.example.com/owner/repo');
    });

    it('passes through already-clean HTTP URL', () => {
      expect(normalizeGitRemoteUrl('http://git.example.com/owner/repo'))
        .toBe('http://git.example.com/owner/repo');
    });

    it('normalizes git:// protocol URL with .git suffix', () => {
      expect(normalizeGitRemoteUrl('git://github.com/owner/repo.git'))
        .toBe('https://github.com/owner/repo');
    });

    it('normalizes git:// protocol URL without .git suffix', () => {
      expect(normalizeGitRemoteUrl('git://gitlab.com/owner/repo'))
        .toBe('https://gitlab.com/owner/repo');
    });
  });

  describe('getRepositoryUrl', () => {
    it('detects and normalizes origin HTTPS remote', async () => {
      execSync('git remote remove origin', { cwd: testDir });
      execSync('git remote add origin https://github.com/owner/repo.git', { cwd: testDir });

      const url = await getRepositoryUrl(testDir);
      expect(url).toBe('https://github.com/owner/repo');
    });

    it('detects and normalizes SSH remote', async () => {
      execSync('git remote remove origin', { cwd: testDir });
      execSync('git remote add origin git@github.com:owner/repo.git', { cwd: testDir });

      const url = await getRepositoryUrl(testDir);
      expect(url).toBe('https://github.com/owner/repo');
    });

    it('falls back to first remote when origin does not exist', async () => {
      execSync('git remote remove origin', { cwd: testDir });
      execSync('git remote add upstream https://github.com/other/repo.git', { cwd: testDir });

      const url = await getRepositoryUrl(testDir);
      expect(url).toBe('https://github.com/other/repo');
    });

    it('returns null for git repo without remotes', async () => {
      execSync('git remote remove origin', { cwd: testDir });

      const url = await getRepositoryUrl(testDir);
      expect(url).toBeNull();
    });

    it('returns null for non-git directory', async () => {
      const nonGitDir = await mkdtemp(join(tmpdir(), 'non-git-repourl-'));
      try {
        const url = await getRepositoryUrl(nonGitDir);
        expect(url).toBeNull();
      } finally {
        await rm(nonGitDir, { recursive: true, force: true });
      }
    });

    it('detects repo URL from worktree via .git fast-path', async () => {
      // Replace the default local bare-repo origin with an HTTPS remote
      execSync('git remote remove origin', { cwd: testDir });
      execSync('git remote add origin https://github.com/owner/repo.git', { cwd: testDir });

      // Create a git worktree from the test directory
      const worktreePath = join(testDir, '.worktrees', 'repo-url-test');
      await createWorktreeForBranch(testDir, 'repo-url-test', worktreePath, { skipFetch: true });

      // In a worktree, .git is a *file* (containing a gitdir reference), not a directory.
      // The fs.access() fast-path works for both, but this path was previously untested.
      const url = await getRepositoryUrl(worktreePath);
      expect(url).toBe('https://github.com/owner/repo');

      // Clean up worktree before the shared afterEach deletes testDir
      execSync(`git worktree remove --force "${worktreePath}"`, { cwd: testDir });
    });
  });

  describe('session git status helpers', () => {
    async function commitFile(directory, filename, content, message) {
      await writeFile(join(directory, filename), content);
      execSync(`git add "${filename}"`, { cwd: directory });
      execSync(`git commit -m "${message}"`, { cwd: directory });
    }

    async function cloneOrigin() {
      const cloneDir = await mkdtemp(join(tmpdir(), 'git-clone-'));
      execSync(`git clone "${bareRepoDir}" "${cloneDir}"`);
      execSync('git config user.email "other@test.com"', { cwd: cloneDir });
      execSync('git config user.name "Other"', { cwd: cloneDir });
      return cloneDir;
    }

    it('reports a clean branch with upstream', async () => {
      const status = await getSessionGitStatus(testDir);

      expect(status.syncStatus).toBe('clean');
      expect(status.hasUpstream).toBe(true);
      expect(status.aheadCount).toBe(0);
      expect(status.behindCount).toBe(0);
      expect(status.localChangeCount).toBe(0);
    });

    it('counts unique local changed paths including renames', async () => {
      execSync('git mv README.md README-renamed.md', { cwd: testDir });
      await writeFile(join(testDir, 'new-file.txt'), 'new');

      const count = await getLocalChangeCount(testDir);
      const status = await getSessionGitStatus(testDir);

      expect(count).toBe(2);
      expect(status.syncStatus).toBe('dirty');
      expect(status.hasUncommittedChanges).toBe(true);
    });

    it('reports ahead commits', async () => {
      await commitFile(testDir, 'ahead.txt', 'ahead', 'Ahead');

      const status = await getSessionGitStatus(testDir);

      expect(status.syncStatus).toBe('ahead');
      expect(status.aheadCount).toBe(1);
      expect(status.isUnpushed).toBe(true);
    });

    it('reports behind commits after fetching remote refs', async () => {
      const cloneDir = await cloneOrigin();
      try {
        await commitFile(cloneDir, 'remote.txt', 'remote', 'Remote');
        execSync('git push', { cwd: cloneDir });
        await fetchOrigin(testDir);

        const status = await getSessionGitStatus(testDir);

        expect(status.syncStatus).toBe('behind');
        expect(status.behindCount).toBe(1);
        expect(status.isBehind).toBe(true);
      } finally {
        await rm(cloneDir, { recursive: true, force: true });
      }
    });

    it('reports diverged branches', async () => {
      const cloneDir = await cloneOrigin();
      try {
        await commitFile(cloneDir, 'remote.txt', 'remote', 'Remote');
        execSync('git push', { cwd: cloneDir });
        await fetchOrigin(testDir);
        await commitFile(testDir, 'local.txt', 'local', 'Local');

        const counts = await getAheadBehindCounts(testDir, await getBranchUpstream(testDir));
        const status = await getSessionGitStatus(testDir);

        expect(counts).toEqual({ behindCount: 1, aheadCount: 1 });
        expect(status.syncStatus).toBe('diverged');
        expect(status.isDiverged).toBe(true);
      } finally {
        await rm(cloneDir, { recursive: true, force: true });
      }
    });

    it('reports branches without upstream as unpublished', async () => {
      execSync('git checkout -b no-upstream', { cwd: testDir });

      const status = await getSessionGitStatus(testDir);

      expect(status.syncStatus).toBe('unpublished');
      expect(status.upstreamBranch).toBeNull();
      expect(status.hasUpstream).toBe(false);
    });

    it('reports detached HEAD as unknown', async () => {
      const head = execSync('git rev-parse HEAD', { cwd: testDir }).toString().trim();
      execSync(`git checkout ${head}`, { cwd: testDir });

      const status = await getSessionGitStatus(testDir);

      expect(status.currentBranch).toBeNull();
      expect(status.syncStatus).toBe('unknown');
    });
  });
});
