import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getDiff,
  getDiffAgainstBranch,
  getDiffBetweenRefs,
  getStagedDiff,
  getStagedDiffAgainstBranch,
  getUntrackedFiles,
} from './gitDiff.js';
import { git } from './gitService.js';

vi.mock('./gitService.js', () => ({
  git: vi.fn(),
}));

describe('gitDiff', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getDiff', () => {
    it('returns the unstaged diff from git', async () => {
      git.mockResolvedValue('unstaged diff');

      await expect(getDiff('/repo')).resolves.toBe('unstaged diff');
      expect(git).toHaveBeenCalledWith('/repo', 'diff');
    });

    it('propagates git failures', async () => {
      git.mockRejectedValue(new Error('diff failed'));

      await expect(getDiff('/repo')).rejects.toThrow('diff failed');
    });
  });

  describe('getStagedDiff', () => {
    it('returns the staged diff from git', async () => {
      git.mockResolvedValue('staged diff');

      await expect(getStagedDiff('/repo')).resolves.toBe('staged diff');
      expect(git).toHaveBeenCalledWith('/repo', 'diff --cached');
    });

    it('propagates git failures', async () => {
      git.mockRejectedValue(new Error('staged diff failed'));

      await expect(getStagedDiff('/repo')).rejects.toThrow('staged diff failed');
    });
  });

  describe('getUntrackedFiles', () => {
    it('returns an empty array when git has no untracked output', async () => {
      git.mockResolvedValue('');

      await expect(getUntrackedFiles('/repo')).resolves.toEqual([]);
      expect(git).toHaveBeenCalledWith('/repo', 'ls-files --others --exclude-standard');
    });

    it('parses non-empty untracked file output', async () => {
      git.mockResolvedValue('new-file.txt\nsrc/new-module.js\n\n');

      await expect(getUntrackedFiles('/repo')).resolves.toEqual([
        'new-file.txt',
        'src/new-module.js',
      ]);
    });

    it('returns an empty array when git fails', async () => {
      git.mockRejectedValue(new Error('untracked failed'));

      await expect(getUntrackedFiles('/repo')).resolves.toEqual([]);
    });
  });

  describe('getDiffAgainstBranch', () => {
    it('returns the branch diff from git', async () => {
      git.mockResolvedValue('branch diff');

      await expect(getDiffAgainstBranch('/repo', 'origin/main')).resolves.toBe('branch diff');
      expect(git).toHaveBeenCalledWith('/repo', 'diff origin/main');
    });

    it('propagates git failures', async () => {
      git.mockRejectedValue(new Error('branch diff failed'));

      await expect(getDiffAgainstBranch('/repo', 'origin/main')).rejects.toThrow(
        'branch diff failed'
      );
    });
  });

  describe('getStagedDiffAgainstBranch', () => {
    it('returns the staged branch diff from git', async () => {
      git.mockResolvedValue('staged branch diff');

      await expect(getStagedDiffAgainstBranch('/repo', 'origin/main')).resolves.toBe(
        'staged branch diff'
      );
      expect(git).toHaveBeenCalledWith('/repo', 'diff --cached origin/main');
    });

    it('propagates git failures', async () => {
      git.mockRejectedValue(new Error('staged branch diff failed'));

      await expect(getStagedDiffAgainstBranch('/repo', 'origin/main')).rejects.toThrow(
        'staged branch diff failed'
      );
    });
  });

  describe('getDiffBetweenRefs', () => {
    it('returns the diff between refs from git', async () => {
      git.mockResolvedValue('refs diff');

      await expect(getDiffBetweenRefs('/repo', 'origin/main', 'HEAD')).resolves.toBe('refs diff');
      expect(git).toHaveBeenCalledWith('/repo', 'diff origin/main HEAD');
    });

    it('propagates git failures', async () => {
      git.mockRejectedValue(new Error('refs diff failed'));

      await expect(getDiffBetweenRefs('/repo', 'origin/main', 'HEAD')).rejects.toThrow(
        'refs diff failed'
      );
    });
  });
});
