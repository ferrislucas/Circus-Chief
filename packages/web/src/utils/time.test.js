import { describe, it, expect } from 'vitest';
import {
  formatTime,
  formatDateTime,
  formatRelative,
  formatDuration,
  formatElapsedMMSS,
  toIso,
  absoluteTooltip,
  EM_DASH as EM_DASH_EXPORT,
} from './time.js';

const EM_DASH = '\u2014';

// A fixed reference: 2026-01-01T14:32:05 local time.
// We construct using component form so each CI machine's local TZ doesn't
// change the wall-clock digits that formatTime/formatDateTime produce.
const FIXED = new Date(2026, 0, 1, 14, 32, 5).getTime();

describe('time utilities', () => {
  describe('EM_DASH export', () => {
    it('is the U+2014 em-dash character', () => {
      expect(EM_DASH_EXPORT).toBe(EM_DASH);
    });
  });

  describe('formatTime', () => {
    it('formats an epoch as HH:MM:SS 24-hour time (en-GB locale)', () => {
      // Locale-pinned; CI locale does not affect output.
      expect(formatTime(FIXED)).toBe('14:32:05');
    });

    it('returns em-dash for null/undefined/NaN', () => {
      expect(formatTime(null)).toBe(EM_DASH);
      expect(formatTime(undefined)).toBe(EM_DASH);
      expect(formatTime(Number.NaN)).toBe(EM_DASH);
    });
  });

  describe('formatDateTime', () => {
    it('renders a full absolute date-time in en-GB style', () => {
      const result = formatDateTime(FIXED);
      // en-GB short-month emits `"1 Jan 2026, 14:32:05"`. Match on stable
      // substrings rather than an exact literal to tolerate minor ICU
      // punctuation differences across Node versions.
      expect(result).toMatch(/1\s+Jan\s+2026/);
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

    it('rounds symmetrically at the 90s minute boundary', () => {
      // 89s past → 1 min ago; 90s past → 2 min ago; 91s past → 2 min ago.
      // Symmetric rounding keeps past and future magnitudes aligned.
      expect(formatRelative(now - 89 * 1000, now)).toMatch(/1 minute ago/);
      expect(formatRelative(now - 90 * 1000, now)).toMatch(/2 minutes ago/);
      expect(formatRelative(now - 91 * 1000, now)).toMatch(/2 minutes ago/);
    });

    it('rounds 2-minute neighborhood correctly', () => {
      // 119s past → 2 min; 121s past → 2 min; 150s past → 3 min.
      expect(formatRelative(now - 119 * 1000, now)).toMatch(/2 minutes ago/);
      expect(formatRelative(now - 121 * 1000, now)).toMatch(/2 minutes ago/);
      expect(formatRelative(now - 150 * 1000, now)).toMatch(/3 minutes ago/);
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
    it('returns M:SS for sub-1h elapsed time', () => {
      expect(formatElapsedMMSS(0, 0)).toBe('0:00');
      expect(formatElapsedMMSS(0, 12_000)).toBe('0:12');
      expect(formatElapsedMMSS(0, 59_000)).toBe('0:59');
      expect(formatElapsedMMSS(0, 60_000)).toBe('1:00');
      expect(formatElapsedMMSS(0, 74_000)).toBe('1:14');
      expect(formatElapsedMMSS(0, 754_000)).toBe('12:34');
      expect(formatElapsedMMSS(0, 3_599_000)).toBe('59:59');
    });

    it('switches to H:MM:SS at the 1h boundary', () => {
      expect(formatElapsedMMSS(0, 3_600_000)).toBe('1:00:00');
      expect(formatElapsedMMSS(0, 5_025_000)).toBe('1:23:45');
      expect(formatElapsedMMSS(0, 36_000_000)).toBe('10:00:00');
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

  describe('toIso', () => {
    it('returns an ISO-8601 string for a valid epoch', () => {
      const iso = toIso(FIXED);
      expect(typeof iso).toBe('string');
      expect(iso).toMatch(/2026/);
      // ISO strings end with "Z" (UTC).
      expect(iso.endsWith('Z')).toBe(true);
    });

    it('returns undefined for null/undefined/NaN', () => {
      expect(toIso(null)).toBeUndefined();
      expect(toIso(undefined)).toBeUndefined();
      expect(toIso(Number.NaN)).toBeUndefined();
    });
  });

  describe('absoluteTooltip', () => {
    const now = new Date(2026, 0, 1, 14, 35, 0).getTime();

    it('combines formatDateTime and formatRelative', () => {
      const result = absoluteTooltip(FIXED, now);
      expect(result).toMatch(/2026/);
      // `FIXED` is ~175 s before `now` → "3 minutes ago" under symmetric rounding.
      expect(result).toMatch(/3 minutes ago/);
    });

    it('falls back to Date.now() when nowMs is omitted', () => {
      // No throw, non-empty string.
      const result = absoluteTooltip(FIXED);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns empty string for null/undefined/NaN', () => {
      expect(absoluteTooltip(null)).toBe('');
      expect(absoluteTooltip(undefined)).toBe('');
      expect(absoluteTooltip(Number.NaN)).toBe('');
    });
  });
});
