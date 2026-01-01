import { describe, it, expect } from 'vitest';
import { formatDate } from './formatters.js';

describe('formatters', () => {
  describe('formatDate', () => {
    it('formats a timestamp string', () => {
      const result = formatDate('2024-01-15T10:30:00Z');
      expect(result).toMatch(/Jan/);
      expect(result).toMatch(/15/);
      expect(result).toMatch(/2024/);
    });

    it('formats a numeric timestamp', () => {
      const timestamp = new Date('2024-06-20T14:45:00Z').getTime();
      const result = formatDate(timestamp);
      expect(result).toMatch(/Jun/);
      expect(result).toMatch(/20/);
      expect(result).toMatch(/2024/);
    });

    it('formats a Date object', () => {
      const date = new Date('2024-12-25T08:00:00Z');
      const result = formatDate(date);
      expect(result).toMatch(/Dec/);
      expect(result).toMatch(/25/);
      expect(result).toMatch(/2024/);
    });

    it('includes time in the output', () => {
      const result = formatDate('2024-01-15T10:30:00Z');
      // The exact time format depends on locale, but should include hours and minutes
      expect(result).toMatch(/\d{1,2}:\d{2}/);
    });
  });
});
