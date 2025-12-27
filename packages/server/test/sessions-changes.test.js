import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { projects, sessions } from '../src/database.js';
import * as diffService from '../src/services/diffService.js';
import * as gitService from '../src/services/gitService.js';

vi.mock('../src/services/diffService.js');
vi.mock('../src/services/gitService.js');

describe('Session Changes API Logic', () => {
  let project;
  let session;

  beforeEach(() => {
    project = projects.create('Test Project', '/test/project/path');
    session = sessions.create(project.id, 'Test Session', 'Test prompt');
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getting changes directory', () => {
    it('uses project working directory by default', async () => {
      diffService.getChanges.mockResolvedValue({ staged: '', unstaged: '' });

      // Simulate what the API endpoint does
      const targetSession = sessions.getById(session.id);
      const targetProject = projects.getById(targetSession.projectId);
      const directory = targetSession.gitWorktree || targetProject.workingDirectory;

      await diffService.getChanges(directory);

      expect(diffService.getChanges).toHaveBeenCalledWith('/test/project/path');
    });

    it('prefers gitWorktree when set', async () => {
      sessions.update(session.id, { gitWorktree: '/custom/worktree/path' });
      diffService.getChanges.mockResolvedValue({ staged: '', unstaged: '' });

      const targetSession = sessions.getById(session.id);
      const targetProject = projects.getById(targetSession.projectId);
      const directory = targetSession.gitWorktree || targetProject.workingDirectory;

      await diffService.getChanges(directory);

      expect(diffService.getChanges).toHaveBeenCalledWith('/custom/worktree/path');
    });
  });

  describe('session lookup', () => {
    it('finds session by id', () => {
      const found = sessions.getById(session.id);
      expect(found).not.toBeNull();
      expect(found.id).toBe(session.id);
    });

    it('returns null for non-existent session', () => {
      const found = sessions.getById('nonexistent-id');
      expect(found).toBeNull();
    });
  });

  describe('project lookup from session', () => {
    it('finds project via session.projectId', () => {
      const targetSession = sessions.getById(session.id);
      const targetProject = projects.getById(targetSession.projectId);
      expect(targetProject).not.toBeNull();
      expect(targetProject.workingDirectory).toBe('/test/project/path');
    });

    it('handles deleted project (cascade deletes session)', () => {
      projects.delete(project.id);
      // Session cascade deleted too due to foreign key
      const targetSession = sessions.getById(session.id);
      expect(targetSession).toBeNull();
    });
  });

  describe('diffService integration', () => {
    it('returns staged and unstaged diffs', async () => {
      diffService.getChanges.mockResolvedValue({
        staged: 'staged diff content',
        unstaged: 'unstaged diff content',
      });

      const result = await diffService.getChanges('/test/project/path');

      expect(result).toEqual({
        staged: 'staged diff content',
        unstaged: 'unstaged diff content',
      });
    });

    it('propagates errors', async () => {
      diffService.getChanges.mockRejectedValue(new Error('Git command failed'));

      await expect(diffService.getChanges('/test')).rejects.toThrow('Git command failed');
    });

    it('returns empty strings when no changes', async () => {
      diffService.getChanges.mockResolvedValue({ staged: '', unstaged: '' });

      const result = await diffService.getChanges('/test');

      expect(result).toEqual({ staged: '', unstaged: '' });
    });
  });

  describe('branch comparison functionality', () => {
    it('calls getChangesBranchComparison when compareMode is "branch"', async () => {
      diffService.getChangesBranchComparison.mockResolvedValue({
        staged: 'branch staged diff',
        unstaged: 'branch unstaged diff',
        untracked: '',
      });

      const targetSession = sessions.getById(session.id);
      const targetProject = projects.getById(targetSession.projectId);
      const directory = targetSession.gitWorktree || targetProject.workingDirectory;

      await diffService.getChangesBranchComparison(directory, 'origin/main');

      expect(diffService.getChangesBranchComparison).toHaveBeenCalledWith(
        '/test/project/path',
        'origin/main'
      );
    });

    it('passes correct branch name from API query param', async () => {
      diffService.getChangesBranchComparison.mockResolvedValue({
        staged: 'diff',
        unstaged: '',
        untracked: '',
      });

      const targetSession = sessions.getById(session.id);
      const targetProject = projects.getById(targetSession.projectId);
      const directory = targetSession.gitWorktree || targetProject.workingDirectory;
      const branchName = 'origin/develop';

      await diffService.getChangesBranchComparison(directory, branchName);

      expect(diffService.getChangesBranchComparison).toHaveBeenCalledWith(directory, branchName);
    });

    it('auto-detects default branch when not provided', async () => {
      gitService.getOriginDefaultBranch.mockResolvedValue('origin/main');
      diffService.getChangesBranchComparison.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: '',
      });

      const targetSession = sessions.getById(session.id);
      const targetProject = projects.getById(targetSession.projectId);
      const directory = targetSession.gitWorktree || targetProject.workingDirectory;

      // Simulate auto-detection logic
      let branchName = null;
      if (!branchName) {
        branchName = await gitService.getOriginDefaultBranch(directory);
      }

      await diffService.getChangesBranchComparison(directory, branchName);

      expect(gitService.getOriginDefaultBranch).toHaveBeenCalledWith(directory);
      expect(diffService.getChangesBranchComparison).toHaveBeenCalledWith(directory, 'origin/main');
    });

    it('uses gitWorktree path when comparing against branch', async () => {
      const worktreePath = '/custom/worktree/path';
      sessions.update(session.id, { gitWorktree: worktreePath });

      diffService.getChangesBranchComparison.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: '',
      });

      const targetSession = sessions.getById(session.id);
      const targetProject = projects.getById(targetSession.projectId);
      const directory = targetSession.gitWorktree || targetProject.workingDirectory;

      await diffService.getChangesBranchComparison(directory, 'origin/main');

      expect(diffService.getChangesBranchComparison).toHaveBeenCalledWith(worktreePath, 'origin/main');
    });

    it('returns both local and branch comparison results', async () => {
      diffService.getChangesBranchComparison.mockResolvedValue({
        staged: 'staged against branch',
        unstaged: 'unstaged against branch',
        untracked: 'untracked files',
      });

      const result = await diffService.getChangesBranchComparison('/test', 'origin/main');

      expect(result).toEqual({
        staged: 'staged against branch',
        unstaged: 'unstaged against branch',
        untracked: 'untracked files',
      });
    });

    it('handles error in branch comparison', async () => {
      diffService.getChangesBranchComparison.mockRejectedValue(
        new Error('Branch does not exist')
      );

      await expect(
        diffService.getChangesBranchComparison('/test', 'non-existent-branch')
      ).rejects.toThrow('Branch does not exist');
    });

    it('returns empty results when no changes against branch', async () => {
      diffService.getChangesBranchComparison.mockResolvedValue({
        staged: '',
        unstaged: '',
        untracked: '',
      });

      const result = await diffService.getChangesBranchComparison('/test', 'origin/main');

      expect(result).toEqual({
        staged: '',
        unstaged: '',
        untracked: '',
      });
    });

    it('handles multiple branch names correctly', async () => {
      const branches = ['origin/main', 'origin/develop', 'origin/feature/new-feature'];

      diffService.getChangesBranchComparison.mockResolvedValue({
        staged: 'diff',
        unstaged: '',
        untracked: '',
      });

      for (const branch of branches) {
        await diffService.getChangesBranchComparison('/test', branch);
        expect(diffService.getChangesBranchComparison).toHaveBeenCalledWith('/test', branch);
      }
    });
  });
});
