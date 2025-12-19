import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  isMarkdownFile,
  extractNewContentFromDiff,
  extractOldContentFromDiff,
} from './markdown.js';

describe('markdown utilities', () => {
  describe('renderMarkdown', () => {
    it('renders basic markdown', () => {
      const result = renderMarkdown('# Hello World');
      expect(result).toContain('<h1>');
      expect(result).toContain('Hello World');
    });

    it('renders bold text', () => {
      const result = renderMarkdown('**bold text**');
      expect(result).toContain('<strong>');
      expect(result).toContain('bold text');
    });

    it('renders italic text', () => {
      const result = renderMarkdown('*italic text*');
      expect(result).toContain('<em>');
      expect(result).toContain('italic text');
    });

    it('renders links', () => {
      const result = renderMarkdown('[link](https://example.com)');
      expect(result).toContain('<a');
      expect(result).toContain('href="https://example.com"');
      expect(result).toContain('target="_blank"');
      expect(result).toContain('rel="noopener noreferrer"');
    });

    it('renders code blocks', () => {
      const result = renderMarkdown('```js\nconst x = 1;\n```');
      expect(result).toContain('<pre');
      expect(result).toContain('<code');
      expect(result).toContain('const');
    });

    it('renders inline code', () => {
      const result = renderMarkdown('Use `code` here');
      expect(result).toContain('<code>');
      expect(result).toContain('code');
    });

    it('renders lists', () => {
      const result = renderMarkdown('- item 1\n- item 2');
      expect(result).toContain('<ul>');
      expect(result).toContain('<li>');
      expect(result).toContain('item 1');
    });

    it('handles empty input', () => {
      expect(renderMarkdown('')).toBe('');
      expect(renderMarkdown(null)).toBe('');
      expect(renderMarkdown(undefined)).toBe('');
    });

    it('sanitizes dangerous HTML', () => {
      const result = renderMarkdown('<script>alert("xss")</script>');
      expect(result).not.toContain('<script>');
    });

    it('renders tables', () => {
      const md = '| A | B |\n|---|---|\n| 1 | 2 |';
      const result = renderMarkdown(md);
      expect(result).toContain('<table>');
      expect(result).toContain('<th>');
      expect(result).toContain('<td>');
    });
  });

  describe('isMarkdownFile', () => {
    it('returns true for .md files', () => {
      expect(isMarkdownFile('README.md')).toBe(true);
      expect(isMarkdownFile('docs/guide.md')).toBe(true);
    });

    it('returns true for .mdx files', () => {
      expect(isMarkdownFile('Component.mdx')).toBe(true);
    });

    it('returns true for .markdown files', () => {
      expect(isMarkdownFile('notes.markdown')).toBe(true);
    });

    it('returns false for non-markdown files', () => {
      expect(isMarkdownFile('script.js')).toBe(false);
      expect(isMarkdownFile('styles.css')).toBe(false);
      expect(isMarkdownFile('index.html')).toBe(false);
    });

    it('handles edge cases', () => {
      expect(isMarkdownFile('')).toBe(false);
      expect(isMarkdownFile(null)).toBe(false);
      expect(isMarkdownFile(undefined)).toBe(false);
    });

    it('is case insensitive', () => {
      expect(isMarkdownFile('README.MD')).toBe(true);
      expect(isMarkdownFile('notes.Markdown')).toBe(true);
    });
  });

  describe('extractNewContentFromDiff', () => {
    it('extracts additions and context lines', () => {
      const file = {
        hunks: [
          {
            lines: [
              { type: 'context', content: 'line 1' },
              { type: 'deletion', content: 'old line' },
              { type: 'addition', content: 'new line' },
              { type: 'context', content: 'line 3' },
            ],
          },
        ],
      };
      const result = extractNewContentFromDiff(file);
      expect(result).toContain('line 1');
      expect(result).not.toContain('old line');
      expect(result).toContain('new line');
      expect(result).toContain('line 3');
    });

    it('handles empty file', () => {
      expect(extractNewContentFromDiff(null)).toBe('');
      expect(extractNewContentFromDiff({})).toBe('');
      expect(extractNewContentFromDiff({ hunks: [] })).toBe('');
    });
  });

  describe('extractOldContentFromDiff', () => {
    it('extracts deletions and context lines', () => {
      const file = {
        hunks: [
          {
            lines: [
              { type: 'context', content: 'line 1' },
              { type: 'deletion', content: 'old line' },
              { type: 'addition', content: 'new line' },
              { type: 'context', content: 'line 3' },
            ],
          },
        ],
      };
      const result = extractOldContentFromDiff(file);
      expect(result).toContain('line 1');
      expect(result).toContain('old line');
      expect(result).not.toContain('new line');
      expect(result).toContain('line 3');
    });

    it('handles empty file', () => {
      expect(extractOldContentFromDiff(null)).toBe('');
      expect(extractOldContentFromDiff({})).toBe('');
      expect(extractOldContentFromDiff({ hunks: [] })).toBe('');
    });
  });
});
