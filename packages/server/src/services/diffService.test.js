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
    it('returns staged and unstaged diffs', async () => {
      gitService.getStagedDiff.mockResolvedValue('staged diff content');
      gitService.getDiff.mockResolvedValue('unstaged diff content');

      const result = await getChanges('/test/dir');

      expect(result).toEqual({
        staged: 'staged diff content',
        unstaged: 'unstaged diff content',
      });
    });

    it('calls git service with correct directory', async () => {
      gitService.getStagedDiff.mockResolvedValue('');
      gitService.getDiff.mockResolvedValue('');

      await getChanges('/my/project/path');

      expect(gitService.getStagedDiff).toHaveBeenCalledWith('/my/project/path');
      expect(gitService.getDiff).toHaveBeenCalledWith('/my/project/path');
    });

    it('returns empty strings when no changes', async () => {
      gitService.getStagedDiff.mockResolvedValue('');
      gitService.getDiff.mockResolvedValue('');

      const result = await getChanges('/test/dir');

      expect(result).toEqual({ staged: '', unstaged: '' });
    });

    it('fetches staged and unstaged diffs in parallel', async () => {
      let stagedResolve;
      let unstagedResolve;

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

      const promise = getChanges('/test/dir');

      // Both should be called immediately (in parallel)
      expect(gitService.getStagedDiff).toHaveBeenCalled();
      expect(gitService.getDiff).toHaveBeenCalled();

      // Resolve them
      stagedResolve('staged');
      unstagedResolve('unstaged');

      const result = await promise;
      expect(result).toEqual({ staged: 'staged', unstaged: 'unstaged' });
    });

    it('propagates errors from getStagedDiff', async () => {
      gitService.getStagedDiff.mockRejectedValue(new Error('Git error'));
      gitService.getDiff.mockResolvedValue('');

      await expect(getChanges('/test/dir')).rejects.toThrow('Git error');
    });

    it('propagates errors from getDiff', async () => {
      gitService.getStagedDiff.mockResolvedValue('');
      gitService.getDiff.mockRejectedValue(new Error('Diff error'));

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

      const result = await getChanges('/test/dir');

      expect(result.staged).toBe(stagedDiff);
      expect(result.unstaged).toBe(unstagedDiff);
    });
  });
});
