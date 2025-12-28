import * as gitService from './gitService.js';
import { readFile } from 'fs/promises';
import { join } from 'path';

const MAX_FILE_SIZE = 100 * 1024; // 100KB

/**
 * Check if content is binary (contains null bytes)
 * @param {Buffer} buffer
 * @returns {boolean}
 */
function isBinary(buffer) {
  // Check first 8KB for null bytes (common binary indicator)
  const checkLength = Math.min(buffer.length, 8192);
  for (let i = 0; i < checkLength; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Generate a synthetic unified diff for a new file
 * @param {string} filePath - The file path (relative)
 * @param {string} content - The file content
 * @returns {string}
 */
function generateNewFileDiff(filePath, content) {
  const diffLines = [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${filePath}`,
  ];

  // Handle empty file
  if (content === '') {
    diffLines.push('@@ -0,0 +0,0 @@');
    return diffLines.join('\n');
  }

  const lines = content.split('\n');
  // Handle trailing newline - if content ends with \n, the split creates an empty string at the end
  // which we should not count as a line
  const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length;

  diffLines.push(`@@ -0,0 +1,${lineCount} @@`);
  for (let i = 0; i < lineCount; i++) {
    diffLines.push(`+${lines[i]}`);
  }

  return diffLines.join('\n');
}

/**
 * Generate a placeholder diff for binary files
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
 * Generate a placeholder diff for files that are too large
 * @param {string} filePath
 * @param {number} size - File size in bytes
 * @returns {string}
 */
function generateTooLargeFileDiff(filePath, size) {
  const sizeKB = Math.round(size / 1024);
  return [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${filePath}`,
    '@@ -0,0 +1 @@',
    `+[File too large to preview (${sizeKB} KB)]`,
  ].join('\n');
}

/**
 * Generate synthetic diffs for untracked files
 * @param {string} directory - The git repository directory
 * @param {string[]} filePaths - Array of relative file paths
 * @returns {Promise<string>} - Combined diff string for all files
 */
export async function generateUntrackedDiffs(directory, filePaths) {
  if (!filePaths || filePaths.length === 0) {
    return '';
  }

  const diffs = await Promise.all(
    filePaths.map(async (filePath) => {
      try {
        const fullPath = join(directory, filePath);
        const buffer = await readFile(fullPath);

        // Check file size
        if (buffer.length > MAX_FILE_SIZE) {
          return generateTooLargeFileDiff(filePath, buffer.length);
        }

        // Check if binary
        if (isBinary(buffer)) {
          return generateBinaryFileDiff(filePath);
        }

        // Generate text diff
        const content = buffer.toString('utf8');
        return generateNewFileDiff(filePath, content);
      } catch (err) {
        // File couldn't be read - generate a placeholder
        return [
          `diff --git a/${filePath} b/${filePath}`,
          'new file mode 100644',
          '--- /dev/null',
          `+++ b/${filePath}`,
          '@@ -0,0 +1 @@',
          `+[Error reading file: ${err.message}]`,
        ].join('\n');
      }
    })
  );

  return diffs.join('\n');
}

/**
 * Get the combined diff (staged + unstaged + untracked) for a directory
 * @param {string} directory
 * @returns {Promise<{staged: string, unstaged: string, untracked: string}>}
 */
export async function getChanges(directory) {
  const [staged, unstaged, untrackedPaths] = await Promise.all([
    gitService.getStagedDiff(directory),
    gitService.getDiff(directory),
    gitService.getUntrackedFiles(directory),
  ]);

  // Generate synthetic diffs for untracked files
  const untracked = await generateUntrackedDiffs(directory, untrackedPaths);

  return { staged, unstaged, untracked };
}

/**
 * Get changes compared to a specific branch
 * Shows commits that are on current branch but not on the target branch
 * @param {string} directory - The git repository directory
 * @param {string} branch - Branch to compare against (e.g., 'origin/main')
 * @returns {Promise<{staged: string, unstaged: string, untracked: string}>}
 */
export async function getChangesBranch(directory, branch) {
  const [staged, unstaged, untrackedPaths] = await Promise.all([
    gitService.getStagedDiffAgainstBranch(directory, branch),
    gitService.getDiffAgainstBranch(directory, branch),
    gitService.getUntrackedFiles(directory),
  ]);

  // Generate synthetic diffs for untracked files
  const untracked = await generateUntrackedDiffs(directory, untrackedPaths);

  return { staged, unstaged, untracked };
}

