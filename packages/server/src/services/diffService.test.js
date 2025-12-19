import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { getChanges, generateUntrackedDiffs } from './diffService.js';
import * as gitService from './gitService.js';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('./gitService.js');

describe('diffService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getChanges', () => {
    it('returns staged, unstaged diffs, and untracked as diff strings', async () => {
      gitService.getStagedDiff.mockResolvedValue('staged diff content');
      gitService.getDiff.mockResolvedValue('unstaged diff content');
      gitService.getUntrackedFiles.mockResolvedValue([]);

      const result = await getChanges('/test/dir');

      expect(result).toEqual({
        staged: 'staged diff content',
        unstaged: 'unstaged diff content',
        untracked: '',
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

      expect(result).toEqual({ staged: '', unstaged: '', untracked: '' });
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
      untrackedResolve([]);

      const result = await promise;
      expect(result).toEqual({ staged: 'staged', unstaged: 'unstaged', untracked: '' });
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

  describe('generateUntrackedDiffs', () => {
    let testDir;

    beforeAll(async () => {
      // Create a temporary directory for tests
      testDir = join(tmpdir(), `diffservice-test-${Date.now()}`);
      await mkdir(testDir, { recursive: true });
    });

    afterAll(async () => {
      // Clean up temporary directory
      await rm(testDir, { recursive: true, force: true });
    });

    it('returns empty string for empty file list', async () => {
      const result = await generateUntrackedDiffs(testDir, []);
      expect(result).toBe('');
    });

    it('returns empty string for null file list', async () => {
      const result = await generateUntrackedDiffs(testDir, null);
      expect(result).toBe('');
    });

    it('generates correct diff for a simple text file', async () => {
      const filePath = 'simple.txt';
      await writeFile(join(testDir, filePath), 'Hello World\nThis is line 2\n');

      const result = await generateUntrackedDiffs(testDir, [filePath]);

      expect(result).toContain('diff --git a/simple.txt b/simple.txt');
      expect(result).toContain('new file mode 100644');
      expect(result).toContain('--- /dev/null');
      expect(result).toContain('+++ b/simple.txt');
      expect(result).toContain('@@ -0,0 +1,2 @@');
      expect(result).toContain('+Hello World');
      expect(result).toContain('+This is line 2');
    });

    it('generates correct diff for multiple files', async () => {
      await writeFile(join(testDir, 'file1.js'), 'const x = 1;\n');
      await writeFile(join(testDir, 'file2.js'), 'const y = 2;\n');

      const result = await generateUntrackedDiffs(testDir, ['file1.js', 'file2.js']);

      expect(result).toContain('diff --git a/file1.js b/file1.js');
      expect(result).toContain('diff --git a/file2.js b/file2.js');
      expect(result).toContain('+const x = 1;');
      expect(result).toContain('+const y = 2;');
    });

    it('generates correct diff for empty file', async () => {
      await writeFile(join(testDir, 'empty.txt'), '');

      const result = await generateUntrackedDiffs(testDir, ['empty.txt']);

      expect(result).toContain('diff --git a/empty.txt b/empty.txt');
      expect(result).toContain('new file mode 100644');
      expect(result).toContain('@@ -0,0 +0,0 @@');
    });

    it('generates correct diff for file without trailing newline', async () => {
      await writeFile(join(testDir, 'no-newline.txt'), 'Line 1\nLine 2');

      const result = await generateUntrackedDiffs(testDir, ['no-newline.txt']);

      expect(result).toContain('@@ -0,0 +1,2 @@');
      expect(result).toContain('+Line 1');
      expect(result).toContain('+Line 2');
    });

    it('generates correct diff for file with only newline', async () => {
      await writeFile(join(testDir, 'just-newline.txt'), '\n');

      const result = await generateUntrackedDiffs(testDir, ['just-newline.txt']);

      expect(result).toContain('diff --git a/just-newline.txt b/just-newline.txt');
      expect(result).toContain('@@ -0,0 +1,1 @@');
      expect(result).toContain('+');
    });

    it('detects binary files and generates placeholder diff', async () => {
      // Create a binary file with null bytes
      const binaryContent = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00]);
      await writeFile(join(testDir, 'image.png'), binaryContent);

      const result = await generateUntrackedDiffs(testDir, ['image.png']);

      expect(result).toContain('diff --git a/image.png b/image.png');
      expect(result).toContain('new file mode 100644');
      expect(result).toContain('Binary files /dev/null and b/image.png differ');
    });

    it('handles files that exceed size limit', async () => {
      // Create a file larger than 100KB
      const largeContent = 'x'.repeat(101 * 1024);
      await writeFile(join(testDir, 'large-file.txt'), largeContent);

      const result = await generateUntrackedDiffs(testDir, ['large-file.txt']);

      expect(result).toContain('diff --git a/large-file.txt b/large-file.txt');
      expect(result).toContain('new file mode 100644');
      expect(result).toContain('[File too large to preview (101 KB)]');
    });

    it('handles file read errors gracefully', async () => {
      // Try to read a non-existent file
      const result = await generateUntrackedDiffs(testDir, ['non-existent-file.txt']);

      expect(result).toContain('diff --git a/non-existent-file.txt b/non-existent-file.txt');
      expect(result).toContain('[Error reading file:');
    });

    it('handles files in subdirectories', async () => {
      const subDir = join(testDir, 'subdir');
      await mkdir(subDir, { recursive: true });
      await writeFile(join(subDir, 'nested.txt'), 'Nested content\n');

      const result = await generateUntrackedDiffs(testDir, ['subdir/nested.txt']);

      expect(result).toContain('diff --git a/subdir/nested.txt b/subdir/nested.txt');
      expect(result).toContain('+Nested content');
    });

    it('handles markdown files correctly', async () => {
      const mdContent = '# Header\n\nSome **bold** text\n\n- List item 1\n- List item 2\n';
      await writeFile(join(testDir, 'readme.md'), mdContent);

      const result = await generateUntrackedDiffs(testDir, ['readme.md']);

      expect(result).toContain('diff --git a/readme.md b/readme.md');
      expect(result).toContain('+# Header');
      expect(result).toContain('+Some **bold** text');
      expect(result).toContain('+- List item 1');
    });

    it('processes multiple files in parallel', async () => {
      // Create several files
      for (let i = 0; i < 5; i++) {
        await writeFile(join(testDir, `parallel-${i}.txt`), `Content ${i}\n`);
      }

      const filePaths = Array.from({ length: 5 }, (_, i) => `parallel-${i}.txt`);
      const result = await generateUntrackedDiffs(testDir, filePaths);

      // All files should be in the result
      for (let i = 0; i < 5; i++) {
        expect(result).toContain(`diff --git a/parallel-${i}.txt b/parallel-${i}.txt`);
        expect(result).toContain(`+Content ${i}`);
      }
    });

    it('handles special characters in content', async () => {
      const content = 'Special chars: <>&"\'\n';
      await writeFile(join(testDir, 'special.txt'), content);

      const result = await generateUntrackedDiffs(testDir, ['special.txt']);

      expect(result).toContain('+Special chars: <>&"\'');
    });
  });
});
