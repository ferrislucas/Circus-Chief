import { describe, it, expect } from 'vitest';
import { useMessageFormatting } from './useMessageFormatting.js';

describe('useMessageFormatting', () => {
  const {
    formatTime,
    formatMessageDate,
    isBeforeToday,
    formatModelName,
    formatFileSize,
    getAttachmentIcon,
  } = useMessageFormatting();

  describe('formatTime', () => {
    it('should format an ISO timestamp to locale time string', () => {
      const timestamp = '2024-01-15T14:30:00.000Z';
      const result = formatTime(timestamp);
      // The exact output depends on locale, but it should be a non-empty string
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should format a numeric timestamp', () => {
      const timestamp = Date.now();
      const result = formatTime(timestamp);
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('should format a Date object', () => {
      const timestamp = new Date('2024-06-15T10:00:00Z');
      const result = formatTime(timestamp);
      expect(result).toBeTruthy();
    });

    it('should return empty string for null input', () => {
      expect(formatTime(null)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(formatTime(undefined)).toBe('');
    });

    it('should return empty string for empty string input', () => {
      expect(formatTime('')).toBe('');
    });
  });

  describe('formatMessageDate', () => {
    it('should format a timestamp as a compact local date', () => {
      const result = formatMessageDate(new Date(2026, 3, 30, 14, 30));

      expect(result).toContain('2026');
      expect(result).toMatch(/Apr|4/);
      expect(result).toContain('30');
    });

    it('should return empty string for null input', () => {
      expect(formatMessageDate(null)).toBe('');
    });

    it('should return empty string for undefined input', () => {
      expect(formatMessageDate(undefined)).toBe('');
    });

    it('should return empty string for empty string input', () => {
      expect(formatMessageDate('')).toBe('');
    });

    it('should return empty string for invalid dates', () => {
      expect(formatMessageDate('not-a-date')).toBe('');
    });
  });

  describe('isBeforeToday', () => {
    it('should return false for a timestamp on the same local calendar day', () => {
      const now = new Date(2026, 4, 1, 22, 0);
      const timestamp = new Date(2026, 4, 1, 8, 0);

      expect(isBeforeToday(timestamp, now)).toBe(false);
    });

    it('should return true for a timestamp from the prior local calendar day', () => {
      const now = new Date(2026, 4, 1, 12, 0);
      const timestamp = new Date(2026, 3, 30, 12, 0);

      expect(isBeforeToday(timestamp, now)).toBe(true);
    });

    it('should compare local calendar days instead of elapsed hours', () => {
      const now = new Date(2026, 4, 1, 0, 1);
      const timestamp = new Date(2026, 3, 30, 23, 59);

      expect(isBeforeToday(timestamp, now)).toBe(true);
    });

    it('should return false for null input', () => {
      expect(isBeforeToday(null, new Date(2026, 4, 1))).toBe(false);
    });

    it('should return false for undefined input', () => {
      expect(isBeforeToday(undefined, new Date(2026, 4, 1))).toBe(false);
    });

    it('should return false for empty string input', () => {
      expect(isBeforeToday('', new Date(2026, 4, 1))).toBe(false);
    });

    it('should return false for invalid dates', () => {
      expect(isBeforeToday('not-a-date', new Date(2026, 4, 1))).toBe(false);
    });
  });

  describe('formatModelName', () => {
    it('should remove date suffix from model name', () => {
      expect(formatModelName('claude-3-5-sonnet-20241022')).toBe('claude-3.5-sonnet');
    });

    it('should convert version numbers (3-5 → 3.5)', () => {
      expect(formatModelName('claude-3-5-haiku-20241022')).toBe('claude-3.5-haiku');
    });

    it('should handle model names without date suffix', () => {
      expect(formatModelName('claude-3-5-sonnet')).toBe('claude-3.5-sonnet');
    });

    it('should handle simple model names', () => {
      expect(formatModelName('sonnet')).toBe('sonnet');
    });

    it('should handle model names without version numbers', () => {
      expect(formatModelName('claude-sonnet-20241022')).toBe('claude-sonnet');
    });

    it('should return empty string for null', () => {
      expect(formatModelName(null)).toBe('');
    });

    it('should return empty string for undefined', () => {
      expect(formatModelName(undefined)).toBe('');
    });

    it('should return empty string for empty string', () => {
      expect(formatModelName('')).toBe('');
    });

    it('should pass through unknown model names', () => {
      expect(formatModelName('gpt-4')).toBe('gpt-4');
    });
  });

  describe('formatFileSize', () => {
    it('should format bytes', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('should format zero bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('should format kilobytes', () => {
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('should format exact kilobyte boundary', () => {
      expect(formatFileSize(1024)).toBe('1.0 KB');
    });

    it('should format megabytes', () => {
      expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });

    it('should format exact megabyte boundary', () => {
      expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    });

    it('should handle null input', () => {
      expect(formatFileSize(null)).toBe('0 B');
    });

    it('should handle undefined input', () => {
      expect(formatFileSize(undefined)).toBe('0 B');
    });

    it('should handle negative input', () => {
      expect(formatFileSize(-100)).toBe('0 B');
    });

    it('should handle very small files', () => {
      expect(formatFileSize(1)).toBe('1 B');
    });

    it('should handle large files', () => {
      expect(formatFileSize(100 * 1024 * 1024)).toBe('100.0 MB');
    });
  });

  describe('getAttachmentIcon', () => {
    it('should return paperclip for null mimeType', () => {
      expect(getAttachmentIcon(null)).toBe('📎');
    });

    it('should return paperclip for undefined mimeType', () => {
      expect(getAttachmentIcon(undefined)).toBe('📎');
    });

    it('should return image icon for image types', () => {
      expect(getAttachmentIcon('image/png')).toBe('🖼️');
      expect(getAttachmentIcon('image/jpeg')).toBe('🖼️');
      expect(getAttachmentIcon('image/gif')).toBe('🖼️');
      expect(getAttachmentIcon('image/svg+xml')).toBe('🖼️');
    });

    it('should return document icon for text types', () => {
      expect(getAttachmentIcon('text/plain')).toBe('📄');
      expect(getAttachmentIcon('text/html')).toBe('📄');
      expect(getAttachmentIcon('text/csv')).toBe('📄');
    });

    it('should return document icon for application/json', () => {
      expect(getAttachmentIcon('application/json')).toBe('📄');
    });

    it('should return book icon for PDF', () => {
      expect(getAttachmentIcon('application/pdf')).toBe('📕');
    });

    it('should return scroll icon for JavaScript', () => {
      expect(getAttachmentIcon('application/javascript')).toBe('📜');
    });

    it('should return document icon for text/javascript (text/* matches first)', () => {
      // text/javascript matches the text/* check before the javascript check
      expect(getAttachmentIcon('text/javascript')).toBe('📄');
    });

    it('should return scroll icon for TypeScript', () => {
      expect(getAttachmentIcon('application/typescript')).toBe('📜');
    });

    it('should return paperclip for unknown types', () => {
      expect(getAttachmentIcon('application/octet-stream')).toBe('📎');
      expect(getAttachmentIcon('video/mp4')).toBe('📎');
    });
  });
});
