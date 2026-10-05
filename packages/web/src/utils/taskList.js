// Matches a GFM task line: marker (`-`, `*`, `+`, `1.`, `2)`), a bracket
// state (` `, `x`, `X`), and optional trailing text. Malformed markers
// (`[]`, `[  ]`, `[y]`) never match.
const TASK_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\](\s+.*)?$/;

const MAX_CONVENTION_SCAN_LINES = 20;

function isFenceLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

function isTargetFenced(lines, target) {
  let fenced = false;
  for (let i = 0; i < target; i++) {
    if (isFenceLine(lines[i])) fenced = !fenced;
  }
  return fenced;
}

// Files that predominantly check with `X` keep using `X` for new checks;
// everything else (including ties) uses `x`. Unchecking always writes ` `.
function checkedChar(lines) {
  let upper = 0;
  let lower = 0;
  let scanned = 0;
  for (const line of lines) {
    const match = TASK_LINE_RE.exec(line);
    if (!match) continue;
    if (match[2] === 'X') upper += 1;
    else if (match[2] === 'x') lower += 1;
    scanned += 1;
    if (scanned >= MAX_CONVENTION_SCAN_LINES) break;
  }
  return upper > lower ? 'X' : 'x';
}

/**
 * Flip one task-list line in markdown content (pure function).
 * Lines inside fenced code blocks, non-task lines, out-of-range lines and
 * empty input return the content unchanged.
 * @param {string} content - Full markdown document
 * @param {number} line0 - 0-based source line to toggle
 * @returns {string} Document with only that line flipped
 */
export function toggleTaskLine(content, line0) {
  if (typeof content !== 'string' || !Number.isInteger(line0)) return content;
  const lines = content.split('\n');
  if (line0 < 0 || line0 >= lines.length) return content;
  if (isTargetFenced(lines, line0)) return content;
  const match = TASK_LINE_RE.exec(lines[line0]);
  if (!match) return content;
  const next = match[2] === ' ' ? checkedChar(lines) : ' ';
  lines[line0] = `${match[1]}[${next}]${match[3] || ''}`;
  return lines.join('\n');
}

export default { toggleTaskLine };
