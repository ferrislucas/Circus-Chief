/**
 * ANSI Terminal Code to HTML Converter
 * Handles color codes, text formatting (bold, dim, etc.)
 */

import Convert from 'ansi-to-html';
import DOMPurify from 'dompurify';

// Configure converter instance once
const convert = new Convert({
  fg: '#d4d4d4',           // Default foreground color (light gray, matches theme)
  bg: '#1e1e1e',           // Default background color (matches dark theme)
  newline: false,          // Keep newlines as-is (CSS white-space: pre-wrap handles display)
  escapeXML: true,         // Escape XML entities for safety
  stream: false,           // Don't treat as streaming input
  colors: {
    0: '#000000',          // Black
    1: '#ff5555',          // Red
    2: '#55ff55',          // Green
    3: '#ffff55',          // Yellow
    4: '#5555ff',          // Blue
    5: '#ff55ff',          // Magenta
    6: '#55ffff',          // Cyan
    7: '#ffffff',          // White
  },
});

/**
 * Convert ANSI-escaped text to sanitized HTML
 *
 * @param {string} text - Raw terminal output containing ANSI escape codes
 * @returns {string} Safe HTML string with color/formatting applied
 *
 * Examples:
 * - Input: "\x1b[31mError\x1b[0m" (red error)
 * - Output: '<span style="color:#ff5555">Error</span>'
 *
 * - Input: "\x1b[1m\x1b[32mSuccess\x1b[0m" (bold green)
 * - Output: '<span style="color:#55ff55;font-weight:bold">Success</span>'
 */
export function ansiToHtml(text) {
  // Handle null, undefined, or non-string input
  if (!text || typeof text !== 'string') {
    return '';
  }

  try {
    // Convert ANSI codes to HTML spans with inline styles
    const html = convert.toHtml(text);

    // Sanitize with DOMPurify to prevent XSS while preserving styling
    // Only allow <span> (for colors) and <br> (for newlines)
    const sanitized = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['span', 'br'],
      ALLOWED_ATTR: ['style'],
      KEEP_CONTENT: true,
    });

    return sanitized;
  } catch (error) {
    // Fallback: return escaped text if conversion fails
    console.warn('ANSI conversion failed:', error);
    return DOMPurify.sanitize(text, {
      ALLOWED_TAGS: [],
      ALLOWED_ATTR: [],
    });
  }
}

/**
 * Strip ANSI codes from text (useful for copy operations)
 *
 * @param {string} text - Text potentially containing ANSI codes
 * @returns {string} Text with all ANSI escape sequences removed
 *
 * Example:
 * - Input: "\x1b[31mError\x1b[0m"
 * - Output: "Error"
 */
export function stripAnsi(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  // Pattern matches all ANSI escape sequences
  // Format: \x1b[...m where ... is any sequence of numbers/semicolons
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

export default {
  ansiToHtml,
  stripAnsi,
};
