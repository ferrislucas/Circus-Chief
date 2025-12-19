import * as gitService from './gitService.js';

/**
 * Format file size in human readable format
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Generate a unified diff string for a new file (all additions)
 * @param {string} filePath - File path
 * @param {string} content - File content
 * @returns {string}
 */
function generateNewFileDiff(filePath, content) {
  const lines = content.split('\n');
  // Handle trailing newline - if content ends with \n, last element will be empty
  const hasTrailingNewline = content.endsWith('\n');
  const contentLines = hasTrailingNewline ? lines.slice(0, -1) : lines;
  const lineCount = contentLines.length;

  if (lineCount === 0) {
    // Empty file
    return [
      `diff --git a/${filePath} b/${filePath}`,
      'new file mode 100644',
      `--- /dev/null`,
      `+++ b/${filePath}`,
    ].join('\n');
  }

  const header = [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    `--- /dev/null`,
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lineCount} @@`,
  ].join('\n');

  const additions = contentLines.map((line) => `+${line}`).join('\n');

  let result = header + '\n' + additions;
  if (!hasTrailingNewline && contentLines.length > 0) {
    result += '\n\\ No newline at end of file';
  }

  return result;
}

/**
 * Generate a placeholder diff for a binary file
 * @param {string} filePath
 * @returns {string}
 */
function generateBinaryFileDiff(filePath) {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    `Binary files /dev/null and b/${filePath} differ`,
  ].join('\n');
}

/**
 * Generate a placeholder diff for a file that's too large
 * @param {string} filePath
 * @param {number} size
 * @returns {string}
 */
function generateTooLargeFileDiff(filePath, size) {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    `--- /dev/null`,
    `+++ b/${filePath}`,
    `@@ -0,0 +1,1 @@`,
    `+[File too large to preview: ${formatBytes(size)}]`,
  ].join('\n');
}

/**
 * Generate synthetic diffs for untracked files
 * @param {string} directory
 * @param {string[]} filePaths
 * @param {Object} options
 * @returns {Promise<string>}
 */
async function generateUntrackedDiffs(directory, filePaths, options = {}) {
  const { maxFileSize = 100 * 1024 } = options;

  const diffs = await Promise.all(
    filePaths.map(async (filePath) => {
      const result = await gitService.getUntrackedFileContent(directory, filePath, {
        maxSize: maxFileSize,
      });

      if (result.error) {
        // Skip files that can't be read
        return null;
      }

      if (result.isBinary) {
        return generateBinaryFileDiff(filePath);
      }

      if (result.isTooLarge) {
        return generateTooLargeFileDiff(filePath, result.size);
      }

      return generateNewFileDiff(filePath, result.content);
    })
  );

  return diffs.filter(Boolean).join('\n');
}

/**
 * Get the combined diff (staged + unstaged + untracked) for a directory
 * @param {string} directory
 * @param {Object} options
 * @param {number} options.maxUntrackedFiles - Max number of untracked files to process (default: 50)
 * @param {number} options.maxFileSize - Max file size in bytes (default: 100KB)
 * @returns {Promise<{staged: string, unstaged: string, untracked: string}>}
 */
export async function getChanges(directory, options = {}) {
  const { maxUntrackedFiles = 50, maxFileSize = 100 * 1024 } = options;

  const [staged, unstaged, untrackedPaths] = await Promise.all([
    gitService.getStagedDiff(directory),
    gitService.getDiff(directory),
    gitService.getUntrackedFiles(directory),
  ]);

  // Generate synthetic diffs for untracked files (limited to maxUntrackedFiles)
  const untracked = await generateUntrackedDiffs(
    directory,
    untrackedPaths.slice(0, maxUntrackedFiles),
    { maxFileSize }
  );

  return { staged, unstaged, untracked };
}
