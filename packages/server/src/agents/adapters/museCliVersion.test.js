import { describe, it, expect } from 'vitest';
import { isMuseCliCompatible, parseMuseSemver } from './museCliVersion.js';

describe('parseMuseSemver', () => {
  it('parses plain and suffixed versions', () => {
    expect(parseMuseSemver('1.3.0')).toEqual({ major: 1, minor: 3, patch: 0 });
    expect(parseMuseSemver('1.4.0-R3401.1')).toEqual({ major: 1, minor: 4, patch: 0 });
    expect(parseMuseSemver('2.0.0-beta.1')).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it('returns null for missing or unparseable versions', () => {
    expect(parseMuseSemver(null)).toBeNull();
    expect(parseMuseSemver('')).toBeNull();
    expect(parseMuseSemver('latest')).toBeNull();
  });
});

describe('isMuseCliCompatible (finding #3)', () => {
  it('accepts an exact match', () => {
    expect(isMuseCliCompatible('1.3.0', '1.3.0')).toEqual({ compatible: true, drift: 'match' });
  });

  it('accepts minor and patch drift under the same major', () => {
    expect(isMuseCliCompatible('1.4.0', '1.3.0')).toEqual({ compatible: true, drift: 'minor-drift' });
    expect(isMuseCliCompatible('1.3.1', '1.3.0')).toEqual({ compatible: true, drift: 'minor-drift' });
    expect(isMuseCliCompatible('1.2.9', '1.3.0')).toEqual({ compatible: true, drift: 'minor-drift' });
  });

  it('rejects major jumps', () => {
    expect(isMuseCliCompatible('2.0.0', '1.3.0')).toEqual({ compatible: false, drift: 'major-mismatch' });
    expect(isMuseCliCompatible('0.9.9', '1.3.0')).toEqual({ compatible: false, drift: 'major-mismatch' });
  });

  it('rejects unknown versions', () => {
    expect(isMuseCliCompatible(null, '1.3.0')).toEqual({ compatible: false, drift: 'unknown' });
    expect(isMuseCliCompatible('bogus', '1.3.0')).toEqual({ compatible: false, drift: 'unknown' });
  });
});
