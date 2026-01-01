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
  highlight: function (str, lang) {
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

// Configure link rendering to open external links in new tab
const defaultRender =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options);
  };

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
 * Render markdown content to sanitized HTML
 * @param {string} content - Markdown content to render
 * @returns {string} Sanitized HTML string
 */
export function renderMarkdown(content) {
  if (!content || typeof content !== 'string') {
    return '';
  }

  // Render markdown to HTML
  const html = md.render(content);

  // Sanitize the HTML to prevent XSS
  const sanitized = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
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
    ],
    ALLOWED_ATTR: [
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
    ],
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
  isMarkdownFile,
  extractNewContentFromDiff,
  extractOldContentFromDiff,
};
