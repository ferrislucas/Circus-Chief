import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js';

/**
 * Configured markdown-it instance with syntax highlighting
 */
const md = new MarkdownIt({
  html: false, // Disable raw HTML in markdown for security
  breaks: true, // Convert \n to <br>
  linkify: true, // Auto-convert URLs to links
  typographer: true, // Enable smart quotes and other typographic replacements
  highlight (str, lang) {
    // Only highlight when language is explicitly specified
    // IMPORTANT: Do NOT use highlightAuto() - it's extremely expensive and
    // causes severe performance issues on iPad during streaming updates
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code class="language-${lang}">${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        // Fall through to default
      }
    }
    // No language specified - just escape and display without highlighting
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

/**
 * Selector for task-list checkboxes rendered in markdown preview.
 * Used for click/keyboard delegation in MarkdownViewer.
 */
export const TASK_CHECKBOX_SELECTOR = 'input[type="checkbox"][data-task-line]';

// Matches a GFM task prefix at the start of a list item's text: `[ ]`, `[x]` or `[X]`
// followed by whitespace or end of line. Malformed markers (`[]`, `[  ]`, `[y]`) don't match.
const TASK_PREFIX_RE = /^\[([ xX])\](\s+|$)/;

/**
 * Render a task-list checkbox input tag.
 * @param {number} line - 0-based source line of the task item (stable click id)
 * @param {boolean} checked - Whether the box is checked
 * @param {boolean} [disabled=true] - Whether the box is disabled (read-only views)
 * @returns {string} HTML for the checkbox input
 */
export function renderTaskCheckbox(line, checked, disabled = true) {
  // Invalid line ids must never address line 0 (a misclick would flip the
  // wrong task). Emit a disabled box with no data-task-line so the
  // MarkdownViewer delegation selector ignores it. Internal callers always
  // pass valid lines and are unaffected.
  if (!Number.isInteger(line) || line < 0) {
    return '<input type="checkbox" class="task-list-item-checkbox" disabled>';
  }
  let html = `<input type="checkbox" class="task-list-item-checkbox" data-task-line="${line}"`;
  if (checked) html += ' checked';
  if (disabled) html += ' disabled';
  return `${html}>`;
}

function isCheckboxDisabled(line, interactive, disabledLines) {
  return !interactive || disabledLines.includes(line);
}

function addTaskItemClass(listItemToken) {
  if (listItemToken && typeof listItemToken.attrPush === 'function') {
    listItemToken.attrPush(['class', 'task-list-item']);
  }
}

// Find the inline token holding a list item's own text: the first inline token
// after list_item_open, allowing only an intervening paragraph_open (loose
// lists). Any other token (nested list, blockquote, fence, close) means the
// item has no direct text — never steal a nested item's inline token.
function findDirectInlineToken(tokens, itemIndex) {
  for (let j = itemIndex + 1; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.type === 'inline') return token;
    if (token.type !== 'paragraph_open') return null;
  }
  return null;
}

function stripTaskPrefix(inlineToken, line, interactive, disabledLines) {
  const children = inlineToken.children;
  if (!children || children.length === 0) return;
  const first = children[0];
  if (!first || first.type !== 'text') return;
  const match = TASK_PREFIX_RE.exec(first.content);
  if (!match) return;
  const checked = match[1] === 'x' || match[1] === 'X';
  first.content = first.content.slice(match[0].length);
  children.unshift({
    type: 'html_inline',
    content: renderTaskCheckbox(line, checked, isCheckboxDisabled(line, interactive, disabledLines)),
  });
}

/**
 * Transform GFM task-list items into checkbox inputs. Runs as a markdown-it
 * core rule after inline parsing. Fenced/indented code blocks produce `fence`
 * or `code` tokens (never `list_item`), so code content is excluded by
 * construction. Items without source-line info (`token.map` null) render as
 * plain text.
 * @param {Array} tokens - Block token stream
 * @param {boolean} interactive - Omit `disabled` so boxes are clickable
 * @param {Array<number>} disabledLines - Source lines kept disabled (in-flight saves)
 */
function maybeTransformListItem(tokens, index, { interactive, pending, inBlockquote }) {
  if (tokens[index].type !== 'list_item_open') return;
  const line = tokens[index].map ? tokens[index].map[0] : null;
  if (line === null || line === undefined) return;
  const inlineToken = findDirectInlineToken(tokens, index);
  if (!inlineToken) return;
  const before = inlineToken.children ? inlineToken.children.length : 0;
  // Option (a): blockquoted task lines are not toggleable (toggleTaskLine
  // cannot match the `>` prefix), so their boxes always render disabled —
  // never clickable and dead.
  stripTaskPrefix(inlineToken, line, inBlockquote ? false : interactive, pending);
  if (inlineToken.children && inlineToken.children.length !== before) {
    addTaskItemClass(tokens[index]);
  }
}

export function transformTaskListTokens(tokens, interactive, disabledLines) {
  const pending = Array.isArray(disabledLines) ? disabledLines : [];
  let blockquoteDepth = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type === 'blockquote_open') blockquoteDepth += 1;
    else if (tokens[i].type === 'blockquote_close') blockquoteDepth = Math.max(0, blockquoteDepth - 1);
    else maybeTransformListItem(tokens, i, { interactive, pending, inBlockquote: blockquoteDepth > 0 });
  }
}

function taskListRule(state) {
  const env = state.env || {};
  transformTaskListTokens(state.tokens, env.interactive === true, env.disabledLines);
}

md.core.ruler.after('inline', 'task_list', taskListRule);

// Configure link rendering to open external links in new tab
const defaultRender =
  md.renderer.rules.link_open ||
  // eslint-disable-next-line max-params -- markdown-it library API callback signature
  function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

// eslint-disable-next-line max-params -- markdown-it library API callback signature
md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const hrefIndex = token.attrIndex('href');

  if (hrefIndex >= 0) {
    const href = token.attrs[hrefIndex][1];
    // Add target="_blank" and rel="noopener" for external links
    if (href.startsWith('http://') || href.startsWith('https://')) {
      token.attrPush(['target', '_blank']);
      token.attrPush(['rel', 'noopener noreferrer']);
    }
  }

  return defaultRender(tokens, idx, options, env, self);
};

/**
 * Tags allowed through the markdown sanitizer. `input` is restricted to the
 * task-list checkboxes generated by {@link renderTaskCheckbox} (see attrs).
 */
export const MARKDOWN_ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'del',
  's',
  'a',
  'img',
  'input',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'span',
  'div',
  'sup',
  'sub',
];

/**
 * Attributes allowed through the markdown sanitizer. `type`, `checked`,
 * `disabled` and `data-task-line` exist only for task-list checkboxes; no
 * event-handler or `value` attributes are allowed.
 */
export const MARKDOWN_ALLOWED_ATTRS = [
  'href',
  'src',
  'alt',
  'title',
  'target',
  'rel',
  'class',
  'id',
  'width',
  'height',
  'type',
  'checked',
  'disabled',
  'data-task-line',
];

/**
 * Render markdown content to sanitized HTML
 * @param {string} content - Markdown content to render
 * @param {object} [options] - Render options
 * @param {boolean} [options.interactive=false] - Omit `disabled` on task checkboxes
 * @param {Array<number>} [options.disabledLines=[]] - Task source lines kept disabled
 * @returns {string} Sanitized HTML string
 */
export function renderMarkdown(content, options = {}) {
  if (!content || typeof content !== 'string') {
    return '';
  }
  const { interactive = false, disabledLines = [] } = options || {};

  // Render markdown to HTML (env carries checkbox interactivity to the task-list rule)
  const html = md.render(content, { interactive, disabledLines });

  // Sanitize the HTML to prevent XSS
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
    ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTRS,
    ALLOW_DATA_ATTR: false,
  });

  return sanitized;
}

/**
 * Check if a filename has a markdown extension
 * @param {string} filename - The filename to check
 * @returns {boolean} True if the file is a markdown file
 */
export function isMarkdownFile(filename) {
  if (!filename || typeof filename !== 'string') {
    return false;
  }
  const ext = filename.toLowerCase().split('.').pop();
  return ['md', 'mdx', 'markdown', 'mdown', 'mkd', 'mkdn'].includes(ext);
}

/**
 * Check if a filename is an image file
 * @param {string} filename - The filename to check
 * @returns {boolean} True if the file is an image file
 */
export function isImageFile(filename) {
  if (!filename || typeof filename !== 'string') {
    return false;
  }
  const ext = filename.toLowerCase().split('.').pop();
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext);
}

/**
 * Check if a filename is a binary file (non-text)
 * @param {string} filename - The filename to check
 * @returns {boolean} True if the file is likely binary
 */
export function isBinaryFile(filename) {
  if (!filename || typeof filename !== 'string') {
    return false;
  }
  const ext = filename.toLowerCase().split('.').pop();
  // Image files
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'ico'];
  // PDF and other binary formats
  const binaryExts = ['pdf', 'zip', 'tar', 'gz', 'exe', 'dll', 'so', 'dylib', 'jar', 'class', 'o', 'pyc'];
  return imageExts.includes(ext) || binaryExts.includes(ext);
}

/**
 * Extract the final content from a diff file (for preview purposes)
 * This assembles the "new" version of the file from diff hunks
 * @param {object} file - A parsed diff file object
 * @returns {string} The reconstructed file content
 */
export function extractNewContentFromDiff(file) {
  if (!file || !file.hunks) {
    return '';
  }

  const lines = [];

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      // Include context lines and additions (skip deletions)
      if (line.type === 'context' || line.type === 'addition') {
        lines.push(line.content);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Extract the original content from a diff file (for comparison purposes)
 * This assembles the "old" version of the file from diff hunks
 * @param {object} file - A parsed diff file object
 * @returns {string} The reconstructed original file content
 */
export function extractOldContentFromDiff(file) {
  if (!file || !file.hunks) {
    return '';
  }

  const lines = [];

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      // Include context lines and deletions (skip additions)
      if (line.type === 'context' || line.type === 'deletion') {
        lines.push(line.content);
      }
    }
  }

  return lines.join('\n');
}

export default {
  renderMarkdown,
  renderTaskCheckbox,
  transformTaskListTokens,
  isMarkdownFile,
  extractNewContentFromDiff,
  extractOldContentFromDiff,
};
