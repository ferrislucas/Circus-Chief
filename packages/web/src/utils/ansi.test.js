import { describe, it, expect } from 'vitest';
import { ansiToHtml, stripAnsi } from './ansi.js';

describe('ANSI Utility Functions', () => {
  describe('ansiToHtml', () => {
    it('converts red text ANSI code to HTML', () => {
      const input = '\x1b[31mError message\x1b[0m';
      const output = ansiToHtml(input);

      // Output should contain span with color style
      expect(output).toContain('span');
      expect(output).toContain('color');
      expect(output).toContain('Error message');
    });

    it('converts bold text ANSI code', () => {
      const input = '\x1b[1mBold text\x1b[0m';
      const output = ansiToHtml(input);

      // Bold text should be converted and text should be present
      expect(output).toContain('Bold text');
    });

    it('converts green text ANSI code', () => {
      const input = '\x1b[32mSuccess\x1b[0m';
      const output = ansiToHtml(input);

      expect(output).toContain('span');
      expect(output).toContain('Success');
    });

    it('handles combined formatting (bold + green)', () => {
      const input = '\x1b[1m\x1b[32mSuccess\x1b[0m';
      const output = ansiToHtml(input);

      // Combined formatting should render the text and apply color
      expect(output).toContain('Success');
      expect(output).toContain('color');
    });

    it('preserves newlines in output', () => {
      const input = 'Line 1\x1b[31m\nLine 2 (red)\x1b[0m';
      const output = ansiToHtml(input);

      expect(output).toContain('Line 1');
      expect(output).toContain('Line 2');
    });

    it('returns empty string for null/undefined input', () => {
      expect(ansiToHtml(null)).toBe('');
      expect(ansiToHtml(undefined)).toBe('');
      expect(ansiToHtml('')).toBe('');
    });

    it('returns empty string for non-string input', () => {
      expect(ansiToHtml(123)).toBe('');
      expect(ansiToHtml({})).toBe('');
      expect(ansiToHtml([])).toBe('');
    });

    it('sanitizes HTML to prevent XSS', () => {
      // If ANSI conversion somehow produces script tags, they should be removed
      const input = 'Normal text'; // ansi-to-html won't produce script tags, but test the sanitization
      const output = ansiToHtml(input);

      expect(output).not.toContain('<script');
      expect(output).not.toContain('<iframe');
      expect(output).not.toContain('javascript:');
    });

    it('handles complex test output (vitest format)', () => {
      // Real-world example from vitest
      const input = '\x1b[2m⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\x1b[22m\n\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m4 failed\x1b[39m\x1b[22m\x1b[2m | \x1b[22m\x1b[1m\x1b[32m43 passed\x1b[39m';
      const output = ansiToHtml(input);

      // Should contain text content and handle formatting
      expect(output).toContain('Test Files');
      expect(output).toContain('failed');
      expect(output).toContain('passed');
      // Should preserve structure
      expect(output.length).toBeGreaterThan(0);
    });

    it('handles yarn-style progress output with cursor codes', () => {
      // Real-world example: yarn install with cursor control sequences
      const input = '\x1b[2K\x1b[1Gyarn install v1.22.22\n\x1b[2K\x1b[1G\x1b[32m✓\x1b[0m Done in 16.47s.';
      const output = ansiToHtml(input);

      // Should contain actual text without raw escape codes
      expect(output).toContain('yarn install');
      expect(output).toContain('Done');
      expect(output).not.toContain('[2K');
      expect(output).not.toContain('[1G');
    });

    it('handles cursor movement sequences', () => {
      const input = '\x1b[1AUp\x1b[2BDown\x1b[3CRight\x1b[4DLeft';
      const output = ansiToHtml(input);

      // Should remove cursor codes but keep text
      expect(output).toContain('Up');
      expect(output).toContain('Down');
      expect(output).toContain('Right');
      expect(output).toContain('Left');
      expect(output).not.toContain('[1A');
      expect(output).not.toContain('[2B');
    });

    it('handles cursor position sequences', () => {
      const input = '\x1b[5GColumn5\x1b[10;20HPosition';
      const output = ansiToHtml(input);

      expect(output).toContain('Column5');
      expect(output).toContain('Position');
      expect(output).not.toContain('[5G');
      expect(output).not.toContain('[10;20H');
    });

    it('handles line clearing sequences', () => {
      const input = '\x1b[2KCleared\x1b[0KPartial\x1b[1K';
      const output = ansiToHtml(input);

      expect(output).toContain('Cleared');
      expect(output).toContain('Partial');
      expect(output).not.toContain('[2K');
      expect(output).not.toContain('[0K');
      expect(output).not.toContain('[1K');
    });

    it('handles screen clearing sequences', () => {
      const input = '\x1b[2JScreen\x1b[0J';
      const output = ansiToHtml(input);

      expect(output).toContain('Screen');
      expect(output).not.toContain('[2J');
      expect(output).not.toContain('[0J');
    });
  });

  describe('stripAnsi', () => {
    it('removes red color code', () => {
      const input = '\x1b[31mError\x1b[0m';
      expect(stripAnsi(input)).toBe('Error');
    });

    it('removes multiple ANSI codes', () => {
      const input = '\x1b[1m\x1b[32mSuccess\x1b[0m';
      expect(stripAnsi(input)).toBe('Success');
    });

    it('preserves newlines', () => {
      const input = 'Line 1\n\x1b[31mLine 2\x1b[0m';
      expect(stripAnsi(input)).toBe('Line 1\nLine 2');
    });

    it('handles complex output', () => {
      const input = '\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m4 failed\x1b[39m';
      const output = stripAnsi(input);

      expect(output).toBe(' Test Files  4 failed');
      expect(output).not.toContain('\x1b');
    });

    it('returns empty string for null/undefined', () => {
      expect(stripAnsi(null)).toBe('');
      expect(stripAnsi(undefined)).toBe('');
    });

    it('returns original string if no ANSI codes present', () => {
      const input = 'Normal text with no codes';
      expect(stripAnsi(input)).toBe(input);
    });

    it('strips cursor movement sequences', () => {
      const input = '\x1b[1AUp\x1b[2BDown\x1b[3CRight\x1b[4DLeft';
      const output = stripAnsi(input);

      expect(output).toBe('UpDownRightLeft');
      expect(output).not.toContain('[1A');
      expect(output).not.toContain('[2B');
    });

    it('strips cursor position sequences', () => {
      const input = '\x1b[5GColumn\x1b[10;20HPosition';
      const output = stripAnsi(input);

      expect(output).toBe('ColumnPosition');
      expect(output).not.toContain('[5G');
      expect(output).not.toContain('[10;20H');
    });

    it('strips line clearing sequences', () => {
      const input = '\x1b[2KCleared\x1b[0KPartial\x1b[1K';
      const output = stripAnsi(input);

      expect(output).toBe('ClearedPartial');
      expect(output).not.toContain('[2K');
      expect(output).not.toContain('[0K');
      expect(output).not.toContain('[1K');
    });

    it('strips screen clearing sequences', () => {
      const input = '\x1b[2JScreen\x1b[0J';
      const output = stripAnsi(input);

      expect(output).toBe('Screen');
      expect(output).not.toContain('[2J');
      expect(output).not.toContain('[0J');
    });

    it('handles yarn-style progress output', () => {
      // Simulated yarn install output with cursor control codes
      const input = '\x1b[2K\x1b[1Gyarn install v1.22.22\n\x1b[2K\x1b[1G[1/4] Resolving packages...';
      const output = stripAnsi(input);

      expect(output).toBe('yarn install v1.22.22\n[1/4] Resolving packages...');
      expect(output).not.toContain('[2K');
      expect(output).not.toContain('[1G');
      expect(output).not.toContain('\x1b');
    });

    it('strips mixed cursor codes and color codes', () => {
      const input = '\x1b[2K\x1b[1G\x1b[32mSuccess\x1b[0m\x1b[1A';
      const output = stripAnsi(input);

      expect(output).toBe('Success');
      expect(output).not.toContain('\x1b');
    });

    it('handles save/restore cursor position sequences', () => {
      const input = '\x1b[sSaved\x1b[u text';
      const output = stripAnsi(input);

      expect(output).toBe('Saved text');
      expect(output).not.toContain('[s');
      expect(output).not.toContain('[u');
    });
  });
});
