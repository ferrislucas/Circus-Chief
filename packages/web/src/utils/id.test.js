import { afterEach, describe, expect, it, vi } from 'vitest';
import { localId } from './id.js';

describe('localId', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('returns distinct non-empty identifiers', () => {
    const first = localId();
    const second = localId();

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it('falls back to a prefixed identifier when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', { randomUUID: undefined });

    const first = localId('model');
    const second = localId('model');

    expect(first).toMatch(/^model-/);
    expect(second).toMatch(/^model-/);
    expect(first).not.toBe(second);
  });

  it('works when the crypto global is unavailable', () => {
    vi.stubGlobal('crypto', undefined);

    expect(localId('model')).toMatch(/^model-/);
  });
});
