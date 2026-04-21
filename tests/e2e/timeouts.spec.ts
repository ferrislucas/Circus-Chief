import { test, expect } from '@playwright/test';
import { detectWorkersFrom } from './timeouts';

/**
 * Unit-style coverage for the pure worker-count detection used by the
 * scaled-timeout constants. Exercises every branch of precedence without
 * touching the running server so these tests add no parallel load.
 */
test.describe('timeouts.detectWorkersFrom', () => {
  test('honors PW_WORKERS env override over argv and config', () => {
    const n = detectWorkersFrom(
      { PW_WORKERS: '7' } as NodeJS.ProcessEnv,
      ['node', 'pw', '--workers=2'],
      4,
    );
    expect(n).toBe(7);
  });

  test('ignores PW_WORKERS when it is non-numeric or non-positive', () => {
    const nBadString = detectWorkersFrom(
      { PW_WORKERS: 'abc' } as NodeJS.ProcessEnv,
      [],
      4,
    );
    expect(nBadString).toBe(4);

    const nZero = detectWorkersFrom(
      { PW_WORKERS: '0' } as NodeJS.ProcessEnv,
      [],
      4,
    );
    expect(nZero).toBe(4);
  });

  test('reads `--workers 3` (space-separated) from argv', () => {
    const n = detectWorkersFrom(
      {} as NodeJS.ProcessEnv,
      ['node', 'pw', '--workers', '3'],
      4,
    );
    expect(n).toBe(3);
  });

  test('reads `--workers=5` (equals-separated) from argv', () => {
    const n = detectWorkersFrom(
      {} as NodeJS.ProcessEnv,
      ['node', 'pw', '--workers=5'],
      4,
    );
    expect(n).toBe(5);
  });

  test('falls back to config workers when env and argv are absent', () => {
    const n = detectWorkersFrom(
      {} as NodeJS.ProcessEnv,
      ['node', 'pw'],
      6,
    );
    expect(n).toBe(6);
  });

  test('falls back to the hard-coded default of 4 when nothing is available', () => {
    const nUndefined = detectWorkersFrom(
      {} as NodeJS.ProcessEnv,
      ['node', 'pw'],
      undefined,
    );
    expect(nUndefined).toBe(4);

    const nNaN = detectWorkersFrom(
      {} as NodeJS.ProcessEnv,
      ['node', 'pw'],
      'not-a-number',
    );
    expect(nNaN).toBe(4);

    const nZero = detectWorkersFrom(
      {} as NodeJS.ProcessEnv,
      ['node', 'pw'],
      0,
    );
    expect(nZero).toBe(4);
  });

  test('PW_WORKERS takes precedence over --workers argv flag', () => {
    const n = detectWorkersFrom(
      { PW_WORKERS: '8' } as NodeJS.ProcessEnv,
      ['node', 'pw', '--workers=2'],
      4,
    );
    expect(n).toBe(8);
  });

  test('argv --workers takes precedence over config', () => {
    const n = detectWorkersFrom(
      {} as NodeJS.ProcessEnv,
      ['node', 'pw', '--workers', '9'],
      4,
    );
    expect(n).toBe(9);
  });
});
