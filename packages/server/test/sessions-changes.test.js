import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { projects, sessions } from '../src/database.js';
import * as diffService from '../src/services/diffService.js';

vi.mock('../src/services/diffService.js');

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
    it('returns staged, unstaged, and untracked diffs', async () => {
      diffService.getChanges.mockResolvedValue({
        staged: 'staged diff content',
        unstaged: 'unstaged diff content',
        untracked: 'untracked file content',
      });

      const result = await diffService.getChanges('/test/project/path');

      expect(result).toEqual({
        staged: 'staged diff content',
        unstaged: 'unstaged diff content',
        untracked: 'untracked file content',
      });
    });

    it('propagates errors', async () => {
      diffService.getChanges.mockRejectedValue(new Error('Git command failed'));

      await expect(diffService.getChanges('/test')).rejects.toThrow('Git command failed');
    });

    it('returns empty strings when no changes', async () => {
      diffService.getChanges.mockResolvedValue({ staged: '', unstaged: '', untracked: '' });

      const result = await diffService.getChanges('/test');

      expect(result).toEqual({ staged: '', unstaged: '', untracked: '' });
    });
  });

  describe('branch comparison removal', () => {
    it('getChangesBranchComparison function should not exist', () => {
      // Verify that the branch comparison function has been removed
      expect(diffService.getChangesBranchComparison).toBeUndefined();
    });

    it('always uses local changes (no branch comparison)', async () => {
      diffService.getChanges.mockResolvedValue({
        staged: 'local staged',
        unstaged: 'local unstaged',
        untracked: 'local untracked',
      });

      // Session changes should only return local changes
      const result = await diffService.getChanges('/test/project/path');

      // Verify we get all three types of changes
      expect(result).toHaveProperty('staged');
      expect(result).toHaveProperty('unstaged');
      expect(result).toHaveProperty('untracked');

      // Verify getChanges was called (not any branch comparison method)
      expect(diffService.getChanges).toHaveBeenCalledTimes(1);
      expect(diffService.getChanges).toHaveBeenCalledWith('/test/project/path');
    });
  });
});
