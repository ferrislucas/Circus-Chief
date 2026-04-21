import { describe, it, expect } from 'vitest';
import {
  formatTime,
  formatDateTime,
  formatRelative,
  formatDuration,
  formatElapsedMMSS,
} from './time.js';

const EM_DASH = '\u2014';

// A fixed reference: 2026-01-01T14:32:05 local time.
// We construct using component form so each CI machine's local TZ doesn't
// change the wall-clock digits that formatTime/formatDateTime produce.
const FIXED = new Date(2026, 0, 1, 14, 32, 5).getTime();

describe('time utilities', () => {
  describe('formatTime', () => {
    it('formats an epoch as HH:MM:SS 24-hour local time', () => {
      expect(formatTime(FIXED)).toBe('14:32:05');
    });

    it('returns em-dash for null/undefined/NaN', () => {
      expect(formatTime(null)).toBe(EM_DASH);
      expect(formatTime(undefined)).toBe(EM_DASH);
      expect(formatTime(Number.NaN)).toBe(EM_DASH);
    });
  });

  describe('formatDateTime', () => {
    it('renders a full localized absolute date-time', () => {
      const result = formatDateTime(FIXED);
      // Different runtimes produce slightly different formats for `short`
      // month; assert on stable substrings instead of an exact literal.
      expect(result).toMatch(/2026/);
      expect(result).toMatch(/14:32:05/);
    });

    it('returns em-dash for missing input', () => {
      expect(formatDateTime(null)).toBe(EM_DASH);
      expect(formatDateTime(undefined)).toBe(EM_DASH);
      expect(formatDateTime(Number.NaN)).toBe(EM_DASH);
    });
  });

  describe('formatRelative', () => {
    const now = 1_000_000_000_000;

    it('returns "just now" for deltas under 5 seconds', () => {
      expect(formatRelative(now - 0, now)).toBe('just now');
      expect(formatRelative(now - 2000, now)).toBe('just now');
      expect(formatRelative(now + 4000, now)).toBe('just now');
    });

    it('formats seconds in the past', () => {
      expect(formatRelative(now - 45 * 1000, now)).toMatch(/45 seconds ago/);
    });

    it('rounds 90+ seconds to minutes', () => {
      // 91s past the boundary should round to "2 minutes ago".
      // (At exactly 90s, Math.round(-1.5) === -1 in JS so the phrase is
      // "1 minute ago" — not a bug, just JS rounding.)
      expect(formatRelative(now - 91 * 1000, now)).toMatch(/2 minutes ago/);
    });

    it('formats future times', () => {
      expect(formatRelative(now + 30 * 1000, now)).toMatch(/in 30 seconds/);
    });

    it('returns em-dash for missing input', () => {
      expect(formatRelative(null)).toBe(EM_DASH);
      expect(formatRelative(undefined)).toBe(EM_DASH);
      expect(formatRelative(Number.NaN)).toBe(EM_DASH);
    });
  });

  describe('formatDuration', () => {
    it('formats sub-second as tenths', () => {
      expect(formatDuration(0, 400)).toBe('0.4s');
    });

    it('formats seconds', () => {
      expect(formatDuration(0, 42_000)).toBe('42s');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(0, 134_000)).toBe('2m 14s');
    });

    it('formats hours and minutes', () => {
      expect(formatDuration(0, 3_900_000)).toBe('1h 5m');
    });

    it('formats days and hours', () => {
      expect(formatDuration(0, 90_000_000)).toBe('1d 1h');
    });

    it('uses Date.now() for endMs when omitted', () => {
      // Should not throw; shape check only (integration is timer-sensitive).
      const result = formatDuration(Date.now() - 2000);
      expect(typeof result).toBe('string');
      expect(result).not.toBe(EM_DASH);
    });

    it('returns em-dash when startMs is missing', () => {
      expect(formatDuration(null, 1000)).toBe(EM_DASH);
      expect(formatDuration(undefined, 1000)).toBe(EM_DASH);
      expect(formatDuration(Number.NaN, 1000)).toBe(EM_DASH);
    });

    it('treats negative delta as zero', () => {
      expect(formatDuration(1000, 500)).toBe('0s');
    });
  });

  describe('formatElapsedMMSS', () => {
    it('returns M:SS for live elapsed time', () => {
      expect(formatElapsedMMSS(0, 12_000)).toBe('0:12');
      expect(formatElapsedMMSS(0, 74_000)).toBe('1:14');
      expect(formatElapsedMMSS(0, 754_000)).toBe('12:34');
    });

    it('returns "0:00" when startMs is missing', () => {
      expect(formatElapsedMMSS(null)).toBe('0:00');
      expect(formatElapsedMMSS(undefined)).toBe('0:00');
      expect(formatElapsedMMSS(Number.NaN)).toBe('0:00');
    });

    it('clamps negative deltas to zero', () => {
      expect(formatElapsedMMSS(1000, 500)).toBe('0:00');
    });
  });
});
