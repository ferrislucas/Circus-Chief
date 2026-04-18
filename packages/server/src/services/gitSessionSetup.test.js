import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./gitService.js', () => ({
  checkoutBranch: vi.fn(),
  createWorktreeForBranch: vi.fn(),
  pinAuthorInWorktree: vi.fn(),
}));

import * as gitService from './gitService.js';
import { setupGitForSession } from './gitSessionSetup.js';

describe('setupGitForSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gitService.createWorktreeForBranch.mockResolvedValue({
      path: '/project/.worktrees/session-1',
      branch: 'test-branch',
    });
    gitService.pinAuthorInWorktree.mockResolvedValue(true);
  });

  it('returns projectDir when gitMode is null', async () => {
    const result = await setupGitForSession({
      projectDir: '/project',
      gitMode: null,
      gitBranch: null,
      sessionId: 'session-1',
    });

    expect(result).toEqual({
      workingDirectory: '/project',
      gitWorktree: null,
    });
    expect(gitService.createWorktreeForBranch).not.toHaveBeenCalled();
    expect(gitService.pinAuthorInWorktree).not.toHaveBeenCalled();
  });

  it('returns projectDir when gitBranch is null', async () => {
    const result = await setupGitForSession({
      projectDir: '/project',
      gitMode: 'worktree',
      gitBranch: null,
      sessionId: 'session-1',
    });

    expect(result).toEqual({
      workingDirectory: '/project',
      gitWorktree: null,
    });
    expect(gitService.createWorktreeForBranch).not.toHaveBeenCalled();
    expect(gitService.pinAuthorInWorktree).not.toHaveBeenCalled();
  });

  describe('branch mode', () => {
    it('checks out branch in project directory', async () => {
      const result = await setupGitForSession({
        projectDir: '/project',
        gitMode: 'branch',
        gitBranch: 'feature-x',
        sessionId: 'session-1',
      });

      expect(gitService.checkoutBranch).toHaveBeenCalledWith('/project', 'feature-x');
      expect(result).toEqual({
        workingDirectory: '/project',
        gitWorktree: null,
      });
      // branch mode should NOT call pinAuthorInWorktree
      expect(gitService.pinAuthorInWorktree).not.toHaveBeenCalled();
    });
  });

  describe('worktree mode', () => {
    it('creates worktree and returns worktree path', async () => {
      const result = await setupGitForSession({
        projectDir: '/project',
        gitMode: 'worktree',
        gitBranch: 'feature-x',
        sessionId: 'session-1',
      });

      expect(gitService.createWorktreeForBranch).toHaveBeenCalledWith(
        '/project',
        'feature-x',
        '/project/.worktrees/session-1'
      );
      expect(result).toEqual({
        workingDirectory: '/project/.worktrees/session-1',
        gitWorktree: '/project/.worktrees/session-1',
      });
    });

    it('calls pinAuthorInWorktree after creating the worktree', async () => {
      await setupGitForSession({
        projectDir: '/project',
        gitMode: 'worktree',
        gitBranch: 'feature-x',
        sessionId: 'session-1',
      });

      expect(gitService.pinAuthorInWorktree).toHaveBeenCalledWith(
        '/project/.worktrees/session-1',
        '/project'
      );
    });

    it('calls pinAuthorInWorktree with worktreePath and projectDir', async () => {
      await setupGitForSession({
        projectDir: '/my/project',
        gitMode: 'worktree',
        gitBranch: 'my-branch',
        sessionId: 'abc-123',
      });

      expect(gitService.pinAuthorInWorktree).toHaveBeenCalledWith(
        '/my/project/.worktrees/abc-123',
        '/my/project'
      );
    });

    it('calls createWorktreeForBranch before pinAuthorInWorktree', async () => {
      const callOrder = [];
      gitService.createWorktreeForBranch.mockImplementation(async () => {
        callOrder.push('createWorktreeForBranch');
        return { path: '/project/.worktrees/session-1', branch: 'feature-x' };
      });
      gitService.pinAuthorInWorktree.mockImplementation(async () => {
        callOrder.push('pinAuthorInWorktree');
        return true;
      });

      await setupGitForSession({
        projectDir: '/project',
        gitMode: 'worktree',
        gitBranch: 'feature-x',
        sessionId: 'session-1',
      });

      expect(callOrder).toEqual(['createWorktreeForBranch', 'pinAuthorInWorktree']);
    });

    it('still returns worktree path even if pinAuthorInWorktree returns false', async () => {
      gitService.pinAuthorInWorktree.mockResolvedValue(false);

      const result = await setupGitForSession({
        projectDir: '/project',
        gitMode: 'worktree',
        gitBranch: 'feature-x',
        sessionId: 'session-1',
      });

      expect(result).toEqual({
        workingDirectory: '/project/.worktrees/session-1',
        gitWorktree: '/project/.worktrees/session-1',
      });
    });

    it('uses custom worktreeBasePath when provided', async () => {
      gitService.createWorktreeForBranch.mockResolvedValue({
        path: '/custom/worktrees/session-1',
        branch: 'feature-x',
      });

      const result = await setupGitForSession({
        projectDir: '/project',
        gitMode: 'worktree',
        gitBranch: 'feature-x',
        sessionId: 'session-1',
        worktreeBasePath: '/custom/worktrees',
      });

      expect(gitService.createWorktreeForBranch).toHaveBeenCalledWith(
        '/project',
        'feature-x',
        '/custom/worktrees/session-1'
      );
      expect(result).toEqual({
        workingDirectory: '/custom/worktrees/session-1',
        gitWorktree: '/custom/worktrees/session-1',
      });
    });

    it('uses default .worktrees when worktreeBasePath is null', async () => {
      const result = await setupGitForSession({
        projectDir: '/project',
        gitMode: 'worktree',
        gitBranch: 'feature-x',
        sessionId: 'session-1',
        worktreeBasePath: null,
      });

      expect(gitService.createWorktreeForBranch).toHaveBeenCalledWith(
        '/project',
        'feature-x',
        '/project/.worktrees/session-1'
      );
      expect(result).toEqual({
        workingDirectory: '/project/.worktrees/session-1',
        gitWorktree: '/project/.worktrees/session-1',
      });
    });
  });

  describe('unknown git mode', () => {
    it('returns projectDir for unrecognized gitMode', async () => {
      const result = await setupGitForSession({
        projectDir: '/project',
        gitMode: 'unknown',
        gitBranch: 'feature-x',
        sessionId: 'session-1',
      });

      expect(result).toEqual({
        workingDirectory: '/project',
        gitWorktree: null,
      });
      expect(gitService.pinAuthorInWorktree).not.toHaveBeenCalled();
    });
  });
});
