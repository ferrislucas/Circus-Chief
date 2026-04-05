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
 * @property {boolean} isBinary - True if git reported this as a binary file
 * @property {DiffHunk[]} hunks
 * @property {number} additions
 * @property {number} deletions
 */

/**
 * Create a new DiffFile object from a "diff --git" line
 * @param {string} line - The diff --git line
 * @returns {DiffFile}
 */
function createFileEntry(line) {
  const match = line.match(/diff --git a\/(.+) b\/(.+)/);
  return {
    oldPath: match ? match[1] : '',
    newPath: match ? match[2] : '',
    displayPath: match ? match[2] : '',
    isNew: false,
    isDeleted: false,
    isRenamed: false,
    isBinary: false,
    hunks: [],
    additions: 0,
    deletions: 0,
  };
}

/**
 * Apply file-level metadata from a header line to the current file.
 * Returns true if the line was consumed as a file header, false otherwise.
 * @param {string} line
 * @param {DiffFile} file
 * @returns {boolean}
 */
function parseFileHeader(line, file) {
  if (line.startsWith('new file mode')) {
    file.isNew = true;
    return true;
  }
  if (line.startsWith('deleted file mode')) {
    file.isDeleted = true;
    file.displayPath = file.oldPath;
    return true;
  }
  if (line.startsWith('rename from') || line.startsWith('rename to')) {
    file.isRenamed = true;
    return true;
  }
  if (line.startsWith('Binary files')) {
    file.isBinary = true;
    return true;
  }
  if (
    line.startsWith('index ') ||
    line.startsWith('--- ') ||
    line.startsWith('+++ ')
  ) {
    return true;
  }
  return false;
}

/**
 * Parse a hunk header line (@@ ... @@) into a DiffHunk object.
 * Returns the parsed hunk and initial line numbers, or null if the line doesn't match.
 * @param {string} line
 * @returns {{ hunk: DiffHunk, oldLineNum: number, newLineNum: number } | null}
 */
function parseHunkHeader(line) {
  const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)?/);
  if (!match) return null;

  const oldLineNum = parseInt(match[1], 10);
  const newLineNum = parseInt(match[3], 10);
  return {
    hunk: {
      header: line,
      oldStart: oldLineNum,
      oldCount: match[2] ? parseInt(match[2], 10) : 1,
      newStart: newLineNum,
      newCount: match[4] ? parseInt(match[4], 10) : 1,
      lines: [],
    },
    oldLineNum,
    newLineNum,
  };
}

/**
 * Classify a single diff content line as addition, deletion, or context.
 * Returns a partial line object with type and content, or null for lines to skip
 * (e.g. "\ No newline at end of file").
 * @param {string} line
 * @returns {{ type: 'addition'|'deletion'|'context', content: string } | null}
 */
function parseLineChange(line) {
  if (line.startsWith('+')) {
    return { type: 'addition', content: line.slice(1) };
  }
  if (line.startsWith('-')) {
    return { type: 'deletion', content: line.slice(1) };
  }
  if (line.startsWith(' ') || line === '') {
    return { type: 'context', content: line.startsWith(' ') ? line.slice(1) : line };
  }
  return null;
}

/**
 * Finalize a file entry by pushing the last hunk (if any) and adding it to the files array.
 * @param {DiffFile} file
 * @param {DiffHunk|null} hunk
 * @param {DiffFile[]} files
 */
function finalizeFile(file, hunk, files) {
  if (hunk) {
    file.hunks.push(hunk);
  }
  files.push(file);
}

/**
 * Add a parsed content line to the current hunk and update line numbers/counts.
 * @param {{ type: 'addition'|'deletion'|'context', content: string }} change
 * @param {DiffHunk} hunk
 * @param {DiffFile} file
 * @param {{ oldLineNum: number, newLineNum: number }} lineNums - Mutated in place
 */
function addLineToHunk(change, hunk, file, lineNums) {
  if (change.type === 'addition') {
    hunk.lines.push({ ...change, oldLineNumber: null, newLineNumber: lineNums.newLineNum++ });
    file.additions++;
  } else if (change.type === 'deletion') {
    hunk.lines.push({ ...change, oldLineNumber: lineNums.oldLineNum++, newLineNumber: null });
    file.deletions++;
  } else {
    hunk.lines.push({ ...change, oldLineNumber: lineNums.oldLineNum++, newLineNumber: lineNums.newLineNum++ });
  }
}

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
  const lineNums = { oldLineNum: 0, newLineNum: 0 };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // File header: diff --git a/path b/path
    if (line.startsWith('diff --git')) {
      if (currentFile) finalizeFile(currentFile, currentHunk, files);
      currentFile = createFileEntry(line);
      currentHunk = null;
      continue;
    }

    if (!currentFile) continue;
    if (parseFileHeader(line, currentFile)) continue;

    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@ optional context
    if (line.startsWith('@@')) {
      if (currentHunk) currentFile.hunks.push(currentHunk);
      const parsed = parseHunkHeader(line);
      if (parsed) {
        currentHunk = parsed.hunk;
        lineNums.oldLineNum = parsed.oldLineNum;
        lineNums.newLineNum = parsed.newLineNum;
      }
      continue;
    }

    if (!currentHunk) continue;
    const change = parseLineChange(line);
    if (change) addLineToHunk(change, currentHunk, currentFile, lineNums);
  }

  if (currentFile) finalizeFile(currentFile, currentHunk, files);
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
