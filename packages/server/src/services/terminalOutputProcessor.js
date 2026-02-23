/**
 * Strip ANSI escape codes from text
 * Removes all CSI (Control Sequence Introducer) sequences:
 * - SGR codes: \x1b[...m (colors, bold, italic, etc.)
 * - Cursor movement: \x1b[1A, \x1b[2B, etc.
 * - Line/screen clearing: \x1b[2K, \x1b[0J, etc.
 * - Other CSI sequences: \x1b[...H, \x1b[...J, etc.
 *
 * @param {string} text - Text potentially containing ANSI codes
 * @returns {string} Text with all ANSI codes removed
 */
export function stripAnsiCodes(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  // Match all CSI sequences: ESC [ <params> <final-char>
  // This covers colors, cursor movement, line clearing, and other terminal control sequences
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

/**
 * Terminal output processor that simulates cursor control behavior
 *
 * When tools like yarn run in TTY mode, they use cursor control sequences to create
 * animated progress displays. For example:
 *   \x1b[2K\x1b[1G[] 0/576    <- clear line, go to column 1, print progress
 *   \x1b[2K\x1b[1G[] 136/576  <- clear line, go to column 1, print NEW progress
 *
 * On a real terminal, the second line overwrites the first. But when we just strip
 * the codes, we get "[] 0/576[] 136/576" concatenated together.
 *
 * This processor simulates the terminal behavior by:
 * 1. Maintaining a "current line" buffer (content since last newline)
 * 2. When we see \x1b[2K (clear line), we clear the current line buffer
 * 3. When we see \x1b[1G (cursor to column 1), we clear the current line buffer
 * 4. When we see \r (carriage return), we clear the current line buffer
 * 5. When we see \n, we flush the current line and start fresh
 * 6. All ANSI escape codes are stripped from output
 */
export class TerminalOutputProcessor {
  constructor() {
    /** @type {string} Content on the current line (since last newline) */
    this.currentLine = '';
  }

  /**
   * Process a chunk of terminal output, simulating cursor control behavior
   *
   * @param {string} chunk - Raw terminal output chunk
   * @returns {string} Processed output with cursor behavior simulated and ANSI codes stripped
   */
  process(chunk) {
    if (!chunk || typeof chunk !== 'string') {
      return '';
    }

    let output = '';
    let i = 0;

    while (i < chunk.length) {
      // Check for ESC sequence
      if (chunk[i] === '\x1b' && chunk[i + 1] === '[') {
        // Parse the CSI sequence: ESC [ <params> <command>
        let j = i + 2;
        while (j < chunk.length && /[0-9;?]/.test(chunk[j])) {
          j++;
        }

        if (j < chunk.length) {
          const cmd = chunk[j];
          const params = chunk.slice(i + 2, j);

          // Handle cursor control sequences that affect line content
          if (cmd === 'K') {
            // Erase in Line: [0K = to end, [1K = to start, [2K = entire line
            // Any of these effectively means "this content will be replaced"
            this.currentLine = '';
          } else if (cmd === 'G') {
            // Cursor Character Absolute: [nG moves cursor to column n
            // [1G = go to column 1 (start of line) - used for overwriting
            if (params === '' || params === '1') {
              this.currentLine = '';
            }
          } else if (cmd === 'H' || cmd === 'f') {
            // Cursor Position: [n;mH or [n;mf moves cursor to row n, column m
            // Often used for repositioning - clear current line
            this.currentLine = '';
          } else if (cmd === 'A' || cmd === 'B' || cmd === 'C' || cmd === 'D') {
            // Cursor movement: A=up, B=down, C=right, D=left
            // These are used in progress animations - clear current line
            this.currentLine = '';
          } else if (cmd === 'J') {
            // Erase in Display: [0J = to end, [1J = to start, [2J = entire screen
            // Clear current line as screen is being redrawn
            this.currentLine = '';
          }
          // All other sequences (including color codes 'm') are just stripped

          i = j + 1;
          continue;
        }
      }

      // Handle carriage return - go to start of line (used for overwriting)
      if (chunk[i] === '\r') {
        // Don't clear if next char is \n (normal line ending)
        if (chunk[i + 1] !== '\n') {
          this.currentLine = '';
        }
        i++;
        continue;
      }

      // Handle newline - flush current line and start fresh
      if (chunk[i] === '\n') {
        output += this.currentLine + '\n';
        this.currentLine = '';
        i++;
        continue;
      }

      // Regular character - add to current line
      this.currentLine += chunk[i];
      i++;
    }

    return output;
  }

  /**
   * Flush any remaining content in the current line buffer
   * Call this when the stream ends to get the final incomplete line
   *
   * @returns {string} Any remaining content
   */
  flush() {
    const remaining = this.currentLine;
    this.currentLine = '';
    return remaining;
  }

  /**
   * Reset the processor state
   */
  reset() {
    this.currentLine = '';
  }
}
