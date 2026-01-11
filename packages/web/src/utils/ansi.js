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
 * Strip cursor control sequences while preserving color/style codes
 *
 * Cursor control sequences include:
 * - Cursor movement: \x1b[nA (up), \x1b[nB (down), \x1b[nC (right), \x1b[nD (left)
 * - Cursor position: \x1b[n;nH, \x1b[nG (column)
 * - Line clearing: \x1b[2K, \x1b[0K, \x1b[1K
 * - Screen clearing: \x1b[2J, \x1b[0J
 * - Other CSI sequences
 *
 * These are preserved: Color/style codes ending in 'm' (SGR sequences)
 *
 * @param {string} text - Text potentially containing ANSI cursor control codes
 * @returns {string} Text with cursor control sequences removed
 * @private
 */
function stripCursorControlSequences(text) {
  // Match all CSI sequences EXCEPT SGR (color/style) codes ending in 'm'
  // This regex matches: \x1b [ <params> <final-byte>
  // where final-byte is NOT 'm' (which is used for colors/styles)
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, (match) => {
    // Keep SGR sequences (ending in 'm'), remove all others
    return match.endsWith('m') ? match : '';
  });
}

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
 *
 * - Input: "\x1b[2K\x1b[1G\x1b[32mDone\x1b[0m" (yarn-style with cursor codes)
 * - Output: '<span style="color:#55ff55">Done</span>'
 */
export function ansiToHtml(text) {
  // Handle null, undefined, or non-string input
  if (!text || typeof text !== 'string') {
    return '';
  }

  try {
    // Pre-process: strip cursor control sequences that ansi-to-html doesn't handle
    // Keep color/style codes for conversion
    const cleanedText = stripCursorControlSequences(text);

    // Convert ANSI codes to HTML spans with inline styles
    const html = convert.toHtml(cleanedText);

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
 * Strip all ANSI codes from text (useful for copy operations)
 *
 * @param {string} text - Text potentially containing ANSI codes
 * @returns {string} Text with all ANSI escape sequences removed
 *
 * Removes:
 * - Color/style codes: \x1b[31m, \x1b[1;32m, \x1b[0m
 * - Cursor movement: \x1b[1A, \x1b[2B, \x1b[3C, \x1b[4D
 * - Cursor position: \x1b[1G, \x1b[5;10H
 * - Line clearing: \x1b[2K, \x1b[0K, \x1b[1K
 * - Screen clearing: \x1b[2J, \x1b[0J
 * - And other CSI sequences
 *
 * Example:
 * - Input: "\x1b[31mError\x1b[0m"
 * - Output: "Error"
 *
 * - Input: "\x1b[2K\x1b[1GYarn\x1b[32mSuccess\x1b[0m"
 * - Output: "YarnSuccess"
 */
export function stripAnsi(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  // Pattern matches ALL ANSI CSI (Control Sequence Introducer) escape sequences
  // Format: \x1b [ <params> <final-byte>
  // - params: digits 0-9, semicolons, question marks
  // - final-byte: A-Z or a-z (various CSI command letters)
  // This matches color codes, cursor movement, line clearing, etc.
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

export default {
  ansiToHtml,
  stripAnsi,
};
