import { describe, expect, it } from 'vitest';
import { normalizeEpochMs, validEpochMs } from './allowanceTime.js';

describe('normalizeEpochMs', () => {
  it.each([
    ['unix seconds are converted', 1_789_900_000, 1_789_900_000_000],
    ['unix milliseconds pass through', 1_789_900_000_000, 1_789_900_000_000],
    ['zero is untrusted', 0, null],
    ['negative values are untrusted', -12, null],
    ['non-finite values are untrusted', Number.NaN, null],
    ['non-numeric values are untrusted', '1789900000', null],
    ['null is untrusted', null, null],
  ])('%s', (_name, value, expected) => {
    expect(normalizeEpochMs(value)).toBe(expected);
  });
});

describe('validEpochMs', () => {
  it('rejects invalid Date-range timestamps without altering valid milliseconds', () => {
    expect(validEpochMs(Number.NaN)).toBeNull();
    expect(validEpochMs(Infinity)).toBeNull();
    expect(validEpochMs(-1)).toBeNull();
    expect(validEpochMs(8.64e15 + 1)).toBeNull();
    expect(validEpochMs(1_789_900_000_000)).toBe(1_789_900_000_000);
  });
});
