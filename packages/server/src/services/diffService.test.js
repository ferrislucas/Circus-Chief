import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getChanges } from './diffService.js';
import * as gitService from './gitService.js';

vi.mock('./gitService.js');

describe('diffService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getChanges', () => {
    it('returns staged, unstaged diffs, and untracked files', async () => {
      gitService.getStagedDiff.mockResolvedValue('staged diff content');
      gitService.getDiff.mockResolvedValue('unstaged diff content');
      gitService.getUntrackedFiles.mockResolvedValue(['new-file.txt', 'another.js']);

      const result = await getChanges('/test/dir');

      expect(result).toEqual({
        staged: 'staged diff content',
        unstaged: 'unstaged diff content',
        untracked: ['new-file.txt', 'another.js'],
      });
    });

    it('calls git service with correct directory', async () => {
      gitService.getStagedDiff.mockResolvedValue('');
      gitService.getDiff.mockResolvedValue('');
      gitService.getUntrackedFiles.mockResolvedValue([]);

      await getChanges('/my/project/path');

      expect(gitService.getStagedDiff).toHaveBeenCalledWith('/my/project/path');
      expect(gitService.getDiff).toHaveBeenCalledWith('/my/project/path');
      expect(gitService.getUntrackedFiles).toHaveBeenCalledWith('/my/project/path');
    });

    it('returns empty values when no changes', async () => {
      gitService.getStagedDiff.mockResolvedValue('');
      gitService.getDiff.mockResolvedValue('');
      gitService.getUntrackedFiles.mockResolvedValue([]);

      const result = await getChanges('/test/dir');

      expect(result).toEqual({ staged: '', unstaged: '', untracked: [] });
    });

    it('fetches all git info in parallel', async () => {
      let stagedResolve;
      let unstagedResolve;
      let untrackedResolve;

      gitService.getStagedDiff.mockReturnValue(
        new Promise((resolve) => {
          stagedResolve = resolve;
        })
      );
      gitService.getDiff.mockReturnValue(
        new Promise((resolve) => {
          unstagedResolve = resolve;
        })
      );
      gitService.getUntrackedFiles.mockReturnValue(
        new Promise((resolve) => {
          untrackedResolve = resolve;
        })
      );

      const promise = getChanges('/test/dir');

      // All should be called immediately (in parallel)
      expect(gitService.getStagedDiff).toHaveBeenCalled();
      expect(gitService.getDiff).toHaveBeenCalled();
      expect(gitService.getUntrackedFiles).toHaveBeenCalled();

      // Resolve them
      stagedResolve('staged');
      unstagedResolve('unstaged');
      untrackedResolve(['file.txt']);

      const result = await promise;
      expect(result).toEqual({ staged: 'staged', unstaged: 'unstaged', untracked: ['file.txt'] });
    });

    it('propagates errors from getStagedDiff', async () => {
      gitService.getStagedDiff.mockRejectedValue(new Error('Git error'));
      gitService.getDiff.mockResolvedValue('');
      gitService.getUntrackedFiles.mockResolvedValue([]);

      await expect(getChanges('/test/dir')).rejects.toThrow('Git error');
    });

    it('propagates errors from getDiff', async () => {
      gitService.getStagedDiff.mockResolvedValue('');
      gitService.getDiff.mockRejectedValue(new Error('Diff error'));
      gitService.getUntrackedFiles.mockResolvedValue([]);

      await expect(getChanges('/test/dir')).rejects.toThrow('Diff error');
    });

    it('handles multi-line diff output', async () => {
      const stagedDiff = `diff --git a/file.js b/file.js
index 1234567..abcdefg 100644
--- a/file.js
+++ b/file.js
@@ -1,3 +1,4 @@
 line 1
+new line
 line 2
 line 3`;

      const unstagedDiff = `diff --git a/other.js b/other.js
index 9876543..fedcba9 100644
--- a/other.js
+++ b/other.js
@@ -10,5 +10,6 @@
 existing
-removed
+modified
 end`;

      gitService.getStagedDiff.mockResolvedValue(stagedDiff);
      gitService.getDiff.mockResolvedValue(unstagedDiff);
      gitService.getUntrackedFiles.mockResolvedValue([]);

      const result = await getChanges('/test/dir');

      expect(result.staged).toBe(stagedDiff);
      expect(result.unstaged).toBe(unstagedDiff);
    });
  });
});
