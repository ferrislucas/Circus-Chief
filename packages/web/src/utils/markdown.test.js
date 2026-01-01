import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  isMarkdownFile,
  isImageFile,
  isBinaryFile,
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

  describe('isImageFile', () => {
    it('returns true for .png files', () => {
      expect(isImageFile('screenshot.png')).toBe(true);
      expect(isImageFile('images/photo.png')).toBe(true);
    });

    it('returns true for .jpg files', () => {
      expect(isImageFile('photo.jpg')).toBe(true);
      expect(isImageFile('vacation.jpg')).toBe(true);
    });

    it('returns true for .jpeg files', () => {
      expect(isImageFile('image.jpeg')).toBe(true);
    });

    it('returns true for .gif files', () => {
      expect(isImageFile('animation.gif')).toBe(true);
    });

    it('returns true for .webp files', () => {
      expect(isImageFile('modern.webp')).toBe(true);
    });

    it('returns true for .svg files', () => {
      expect(isImageFile('icon.svg')).toBe(true);
    });

    it('returns true for .bmp files', () => {
      expect(isImageFile('bitmap.bmp')).toBe(true);
    });

    it('returns true for .ico files', () => {
      expect(isImageFile('favicon.ico')).toBe(true);
    });

    it('returns false for non-image files', () => {
      expect(isImageFile('script.js')).toBe(false);
      expect(isImageFile('styles.css')).toBe(false);
      expect(isImageFile('document.pdf')).toBe(false);
      expect(isImageFile('README.md')).toBe(false);
    });

    it('is case insensitive', () => {
      expect(isImageFile('PHOTO.PNG')).toBe(true);
      expect(isImageFile('Image.JPG')).toBe(true);
    });

    it('handles edge cases', () => {
      expect(isImageFile('')).toBe(false);
      expect(isImageFile(null)).toBe(false);
      expect(isImageFile(undefined)).toBe(false);
    });

    it('handles paths with directories', () => {
      expect(isImageFile('assets/images/banner.png')).toBe(true);
      expect(isImageFile('/absolute/path/photo.jpg')).toBe(true);
    });
  });

  describe('isBinaryFile', () => {
    it('returns true for image file extensions', () => {
      expect(isBinaryFile('screenshot.png')).toBe(true);
      expect(isBinaryFile('photo.jpg')).toBe(true);
      expect(isBinaryFile('image.jpeg')).toBe(true);
      expect(isBinaryFile('animation.gif')).toBe(true);
      expect(isBinaryFile('modern.webp')).toBe(true);
      expect(isBinaryFile('icon.svg')).toBe(true);
      expect(isBinaryFile('bitmap.bmp')).toBe(true);
      expect(isBinaryFile('favicon.ico')).toBe(true);
    });

    it('returns true for PDF files', () => {
      expect(isBinaryFile('document.pdf')).toBe(true);
    });

    it('returns true for archive files', () => {
      expect(isBinaryFile('archive.zip')).toBe(true);
      expect(isBinaryFile('data.tar')).toBe(true);
      expect(isBinaryFile('compressed.gz')).toBe(true);
    });

    it('returns true for binary executables', () => {
      expect(isBinaryFile('program.exe')).toBe(true);
      expect(isBinaryFile('library.dll')).toBe(true);
      expect(isBinaryFile('shared.so')).toBe(true);
      expect(isBinaryFile('native.dylib')).toBe(true);
    });

    it('returns true for Java class files', () => {
      expect(isBinaryFile('HelloWorld.class')).toBe(true);
      expect(isBinaryFile('app.jar')).toBe(true);
    });

    it('returns true for compiled object files', () => {
      expect(isBinaryFile('main.o')).toBe(true);
      expect(isBinaryFile('script.pyc')).toBe(true);
    });

    it('returns false for text files', () => {
      expect(isBinaryFile('script.js')).toBe(false);
      expect(isBinaryFile('styles.css')).toBe(false);
      expect(isBinaryFile('README.md')).toBe(false);
      expect(isBinaryFile('config.json')).toBe(false);
    });

    it('returns false for code files', () => {
      expect(isBinaryFile('main.py')).toBe(false);
      expect(isBinaryFile('app.ts')).toBe(false);
      expect(isBinaryFile('component.vue')).toBe(false);
    });

    it('is case insensitive', () => {
      expect(isBinaryFile('IMAGE.PNG')).toBe(true);
      expect(isBinaryFile('Document.PDF')).toBe(true);
    });

    it('handles edge cases', () => {
      expect(isBinaryFile('')).toBe(false);
      expect(isBinaryFile(null)).toBe(false);
      expect(isBinaryFile(undefined)).toBe(false);
    });

    it('handles paths with directories', () => {
      expect(isBinaryFile('assets/images/banner.png')).toBe(true);
      expect(isBinaryFile('/absolute/path/document.pdf')).toBe(true);
      expect(isBinaryFile('src/main.js')).toBe(false);
    });

    it('returns true for TIFF image files', () => {
      expect(isBinaryFile('scan.tiff')).toBe(true);
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
