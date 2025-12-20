import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { projects } from '../src/database.js';
import * as gitService from '../src/services/gitService.js';

vi.mock('../src/services/gitService.js');

describe('Session Creation with Git Modes', () => {
  beforeEach(() => {
    projects.create('Test Project', '/test/project/path');
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('default git mode behavior', () => {
    it('defaults to worktree mode when gitBranch is specified but gitMode is not', async () => {
      gitService.createWorktreeForBranch.mockResolvedValue({
        path: '/test/project/path/.worktrees/session-123',
        branch: 'feature-x',
      });

      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      const result = await setupGitForSession({
        projectDir: '/test/project/path',
        gitMode: null,
        gitBranch: 'feature-x',
        sessionId: 'session-123',
      });

      expect(gitService.createWorktreeForBranch).toHaveBeenCalledWith(
        '/test/project/path',
        'feature-x',
        '/test/project/path/.worktrees/session-123'
      );
      expect(result.workingDirectory).toBe('/test/project/path/.worktrees/session-123');
      expect(result.gitWorktree).toBe('/test/project/path/.worktrees/session-123');
      expect(result.effectiveGitMode).toBe('worktree');
    });

    it('defaults to worktree mode when gitBranch is specified and gitMode is undefined', async () => {
      gitService.createWorktreeForBranch.mockResolvedValue({
        path: '/project/.worktrees/session-456',
        branch: 'develop',
      });

      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      const result = await setupGitForSession({
        projectDir: '/project',
        gitMode: undefined,
        gitBranch: 'develop',
        sessionId: 'session-456',
      });

      expect(gitService.createWorktreeForBranch).toHaveBeenCalled();
      expect(result.effectiveGitMode).toBe('worktree');
    });

    it('returns effectiveGitMode in the result', async () => {
      gitService.checkoutBranch.mockResolvedValue(undefined);

      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      const result = await setupGitForSession({
        projectDir: '/test/project/path',
        gitMode: 'branch',
        gitBranch: 'feature-x',
        sessionId: 'session-123',
      });

      expect(result.effectiveGitMode).toBe('branch');
    });
  });

  describe('gitMode: branch', () => {
    it('checks out existing branch when gitMode is branch', async () => {
      gitService.branchExists.mockResolvedValue(true);
      gitService.checkoutBranch.mockResolvedValue(undefined);

      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      const result = await setupGitForSession({
        projectDir: '/test/project/path',
        gitMode: 'branch',
        gitBranch: 'feature-x',
        sessionId: 'session-123',
      });

      expect(gitService.checkoutBranch).toHaveBeenCalledWith('/test/project/path', 'feature-x');
      expect(result.workingDirectory).toBe('/test/project/path');
      expect(result.gitWorktree).toBeNull();
      expect(result.effectiveGitMode).toBe('branch');
    });

    it('creates new branch when it does not exist', async () => {
      gitService.branchExists.mockResolvedValue(false);
      gitService.checkoutBranch.mockResolvedValue(undefined);

      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      const result = await setupGitForSession({
        projectDir: '/test/project/path',
        gitMode: 'branch',
        gitBranch: 'new-feature',
        sessionId: 'session-123',
      });

      expect(gitService.checkoutBranch).toHaveBeenCalledWith('/test/project/path', 'new-feature');
      expect(result.workingDirectory).toBe('/test/project/path');
    });

    it('returns project directory as working directory for branch mode', async () => {
      gitService.checkoutBranch.mockResolvedValue(undefined);

      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      const result = await setupGitForSession({
        projectDir: '/my/project',
        gitMode: 'branch',
        gitBranch: 'develop',
        sessionId: 'session-456',
      });

      expect(result.workingDirectory).toBe('/my/project');
      expect(result.gitWorktree).toBeNull();
    });
  });

  describe('gitMode: worktree', () => {
    it('creates worktree when gitMode is worktree', async () => {
      gitService.createWorktreeForBranch.mockResolvedValue({
        path: '/test/project/path/.worktrees/session-123',
        branch: 'feature-y',
      });

      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      const result = await setupGitForSession({
        projectDir: '/test/project/path',
        gitMode: 'worktree',
        gitBranch: 'feature-y',
        sessionId: 'session-123',
      });

      expect(gitService.createWorktreeForBranch).toHaveBeenCalledWith(
        '/test/project/path',
        'feature-y',
        '/test/project/path/.worktrees/session-123'
      );
      expect(result.workingDirectory).toBe('/test/project/path/.worktrees/session-123');
      expect(result.gitWorktree).toBe('/test/project/path/.worktrees/session-123');
      expect(result.effectiveGitMode).toBe('worktree');
    });

    it('generates worktree path based on session ID', async () => {
      gitService.createWorktreeForBranch.mockResolvedValue({
        path: '/project/.worktrees/my-session-id',
        branch: 'test-branch',
      });

      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      await setupGitForSession({
        projectDir: '/project',
        gitMode: 'worktree',
        gitBranch: 'test-branch',
        sessionId: 'my-session-id',
      });

      expect(gitService.createWorktreeForBranch).toHaveBeenCalledWith(
        '/project',
        'test-branch',
        '/project/.worktrees/my-session-id'
      );
    });
  });

  describe('no branch specified (no git operations)', () => {
    it('does not perform git operations when gitBranch is null', async () => {
      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      const result = await setupGitForSession({
        projectDir: '/test/project/path',
        gitMode: null,
        gitBranch: null,
        sessionId: 'session-123',
      });

      expect(gitService.checkoutBranch).not.toHaveBeenCalled();
      expect(gitService.createWorktreeForBranch).not.toHaveBeenCalled();
      expect(result.workingDirectory).toBe('/test/project/path');
      expect(result.gitWorktree).toBeNull();
      expect(result.effectiveGitMode).toBeNull();
    });

    it('uses project directory when no git branch specified', async () => {
      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      const result = await setupGitForSession({
        projectDir: '/my/project',
        gitMode: undefined,
        gitBranch: undefined,
        sessionId: 'session-789',
      });

      expect(result.workingDirectory).toBe('/my/project');
      expect(result.effectiveGitMode).toBeNull();
    });

    it('ignores gitMode if no gitBranch is specified', async () => {
      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      const result = await setupGitForSession({
        projectDir: '/my/project',
        gitMode: 'worktree', // gitMode specified but no branch
        gitBranch: null,
        sessionId: 'session-789',
      });

      expect(gitService.createWorktreeForBranch).not.toHaveBeenCalled();
      expect(result.workingDirectory).toBe('/my/project');
      expect(result.effectiveGitMode).toBeNull();
    });
  });

  describe('error handling', () => {
    it('throws error when branch checkout fails', async () => {
      gitService.checkoutBranch.mockRejectedValue(new Error('Checkout failed'));

      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      await expect(
        setupGitForSession({
          projectDir: '/test/project',
          gitMode: 'branch',
          gitBranch: 'bad-branch',
          sessionId: 'session-123',
        })
      ).rejects.toThrow('Checkout failed');
    });

    it('throws error when worktree creation fails', async () => {
      gitService.createWorktreeForBranch.mockRejectedValue(new Error('Worktree creation failed'));

      const { setupGitForSession } = await import('../src/services/gitSessionSetup.js');

      await expect(
        setupGitForSession({
          projectDir: '/test/project',
          gitMode: 'worktree',
          gitBranch: 'feature-z',
          sessionId: 'session-123',
        })
      ).rejects.toThrow('Worktree creation failed');
    });
  });
});
