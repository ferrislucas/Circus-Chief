import { describe, expect, it } from 'vitest';
import {
  compareSessionChainEntries,
  getSessionPickerRecency,
  sortSessionChain,
  toTimestamp,
  withPickerTimestamp,
} from './sessionPickerRecency.js';

describe('sessionPickerRecency', () => {
  describe('toTimestamp', () => {
    it('normalizes numeric, numeric string, and ISO timestamp values', () => {
      expect(toTimestamp(1234)).toBe(1234);
      expect(toTimestamp('5678')).toBe(5678);
      expect(toTimestamp('2026-05-12T12:00:00.000Z')).toBe(
        Date.parse('2026-05-12T12:00:00.000Z')
      );
    });

    it('returns 0 for missing, empty, and invalid timestamp values', () => {
      expect(toTimestamp(null)).toBe(0);
      expect(toTimestamp(undefined)).toBe(0);
      expect(toTimestamp('')).toBe(0);
      expect(toTimestamp('   ')).toBe(0);
      expect(toTimestamp(Number.NaN)).toBe(0);
      expect(toTimestamp('not-a-date')).toBe(0);
    });
  });

  describe('getSessionPickerRecency', () => {
    it('prefers lastMessageAt over newer updatedAt and createdAt values', () => {
      expect(getSessionPickerRecency({
        lastMessageAt: 1000,
        updatedAt: 9000,
        createdAt: 8000,
      })).toEqual({ source: 'lastMessageAt', time: 1000 });
    });

    it('falls back from missing or invalid lastMessageAt to updatedAt, then createdAt', () => {
      expect(getSessionPickerRecency({
        lastMessageAt: null,
        updatedAt: 2000,
        createdAt: 1000,
      })).toEqual({ source: 'updatedAt', time: 2000 });

      expect(getSessionPickerRecency({
        lastMessageAt: 'invalid',
        updatedAt: '',
        createdAt: 1000,
      })).toEqual({ source: 'createdAt', time: 1000 });
    });

    it('returns none when no usable timestamp is available', () => {
      expect(getSessionPickerRecency({
        lastMessageAt: null,
        updatedAt: 'invalid',
        createdAt: undefined,
      })).toEqual({ source: 'none', time: 0 });
    });
  });

  describe('sortSessionChain', () => {
    it('sorts by picker recency and annotates entries with timestamp metadata', () => {
      const entries = [
        { session: { id: 'root', lastMessageAt: 1000, updatedAt: 9000, createdAt: 500 }, depth: 0 },
        { session: { id: 'child-a', lastMessageAt: null, updatedAt: 3000, createdAt: 500 }, depth: 1 },
        { session: { id: 'child-b', lastMessageAt: 4000, updatedAt: 2000, createdAt: 500 }, depth: 1 },
      ];

      const sorted = sortSessionChain(entries);

      expect(sorted.map(entry => entry.session.id)).toEqual(['child-b', 'child-a', 'root']);
      expect(sorted.map(entry => entry.pickerTimestamp)).toEqual([4000, 3000, 1000]);
      expect(sorted.map(entry => entry.pickerTimestampSource)).toEqual([
        'lastMessageAt',
        'updatedAt',
        'lastMessageAt',
      ]);
    });

    it('uses createdAt and then id as stable tie breakers', () => {
      const entries = [
        { session: { id: 'b', lastMessageAt: 1000, createdAt: 100 }, depth: 0 },
        { session: { id: 'a', lastMessageAt: 1000, createdAt: 100 }, depth: 0 },
        { session: { id: 'newer-created', lastMessageAt: 1000, createdAt: 200 }, depth: 0 },
      ];

      expect(sortSessionChain(entries).map(entry => entry.session.id)).toEqual([
        'newer-created',
        'a',
        'b',
      ]);
    });

    it('does not mutate the original entries', () => {
      const entries = [
        { session: { id: 'older', lastMessageAt: 1000 }, depth: 0 },
        { session: { id: 'newer', lastMessageAt: 2000 }, depth: 1 },
      ];

      const sorted = sortSessionChain(entries);

      expect(entries.map(entry => entry.session.id)).toEqual(['older', 'newer']);
      expect(entries[0]).not.toHaveProperty('pickerTimestamp');
      expect(sorted).not.toBe(entries);
    });
  });

  it('withPickerTimestamp preserves the entry while adding picker metadata', () => {
    const entry = { session: { id: 'session-1', updatedAt: 1000 }, depth: 2 };

    expect(withPickerTimestamp(entry)).toEqual({
      ...entry,
      pickerTimestamp: 1000,
      pickerTimestampSource: 'updatedAt',
    });
  });

  it('compareSessionChainEntries orders newer picker recency first', () => {
    expect(compareSessionChainEntries(
      { session: { id: 'older', lastMessageAt: 1000 } },
      { session: { id: 'newer', lastMessageAt: 2000 } }
    )).toBeGreaterThan(0);
  });
});
