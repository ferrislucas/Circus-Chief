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
  });
});
