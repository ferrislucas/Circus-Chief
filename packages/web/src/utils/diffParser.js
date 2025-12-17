/**
 * Parse git unified diff format into structured data for rendering
 */

/**
 * @typedef {Object} DiffLine
 * @property {'addition'|'deletion'|'context'|'hunk-header'} type
 * @property {string} content - The line content (without +/- prefix)
 * @property {number|null} oldLineNumber
 * @property {number|null} newLineNumber
 */

/**
 * @typedef {Object} DiffHunk
 * @property {string} header - The @@ header line
 * @property {number} oldStart
 * @property {number} oldCount
 * @property {number} newStart
 * @property {number} newCount
 * @property {DiffLine[]} lines
 */

/**
 * @typedef {Object} DiffFile
 * @property {string} oldPath
 * @property {string} newPath
 * @property {string} displayPath - The path to display (usually newPath or oldPath if deleted)
 * @property {boolean} isNew
 * @property {boolean} isDeleted
 * @property {boolean} isRenamed
 * @property {DiffHunk[]} hunks
 * @property {number} additions
 * @property {number} deletions
 */

/**
 * Parse a unified diff string into structured file objects
 * @param {string} diffText - Raw git diff output
 * @returns {DiffFile[]}
 */
export function parseDiff(diffText) {
  if (!diffText || !diffText.trim()) {
    return [];
  }

  const files = [];
  const lines = diffText.split('\n');
  let currentFile = null;
  let currentHunk = null;
  let oldLineNum = 0;
  let newLineNum = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // File header: diff --git a/path b/path
    if (line.startsWith('diff --git')) {
      if (currentFile) {
        if (currentHunk) {
          currentFile.hunks.push(currentHunk);
        }
        files.push(currentFile);
      }

      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      currentFile = {
        oldPath: match ? match[1] : '',
        newPath: match ? match[2] : '',
        displayPath: match ? match[2] : '',
        isNew: false,
        isDeleted: false,
        isRenamed: false,
        hunks: [],
        additions: 0,
        deletions: 0,
      };
      currentHunk = null;
      continue;
    }

    if (!currentFile) continue;

    // New file mode
    if (line.startsWith('new file mode')) {
      currentFile.isNew = true;
      continue;
    }

    // Deleted file mode
    if (line.startsWith('deleted file mode')) {
      currentFile.isDeleted = true;
      currentFile.displayPath = currentFile.oldPath;
      continue;
    }

    // Rename detection
    if (line.startsWith('rename from') || line.startsWith('rename to')) {
      currentFile.isRenamed = true;
      continue;
    }

    // Skip index, ---, +++ lines (we already have paths from diff --git)
    if (
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('Binary files')
    ) {
      continue;
    }

    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@ optional context
    if (line.startsWith('@@')) {
      if (currentHunk) {
        currentFile.hunks.push(currentHunk);
      }

      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)?/);
      if (match) {
        oldLineNum = parseInt(match[1], 10);
        newLineNum = parseInt(match[3], 10);
        currentHunk = {
          header: line,
          oldStart: oldLineNum,
          oldCount: match[2] ? parseInt(match[2], 10) : 1,
          newStart: newLineNum,
          newCount: match[4] ? parseInt(match[4], 10) : 1,
          lines: [],
        };
      }
      continue;
    }

    // Diff content lines
    if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'addition',
          content: line.slice(1),
          oldLineNumber: null,
          newLineNumber: newLineNum++,
        });
        currentFile.additions++;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'deletion',
          content: line.slice(1),
          oldLineNumber: oldLineNum++,
          newLineNumber: null,
        });
        currentFile.deletions++;
      } else if (line.startsWith(' ') || line === '') {
        // Context line (starts with space) or empty line
        currentHunk.lines.push({
          type: 'context',
          content: line.startsWith(' ') ? line.slice(1) : line,
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++,
        });
      }
      // Skip \ No newline at end of file
    }
  }

  // Don't forget the last file/hunk
  if (currentFile) {
    if (currentHunk) {
      currentFile.hunks.push(currentHunk);
    }
    files.push(currentFile);
  }

  return files;
}

/**
 * Get a summary of changes for a diff
 * @param {DiffFile[]} files
 * @returns {{ filesChanged: number, additions: number, deletions: number }}
 */
export function getDiffSummary(files) {
  return files.reduce(
    (acc, file) => ({
      filesChanged: acc.filesChanged + 1,
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { filesChanged: 0, additions: 0, deletions: 0 }
  );
}
