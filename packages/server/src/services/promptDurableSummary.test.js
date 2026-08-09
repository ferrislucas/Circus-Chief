import { describe, expect, it } from 'vitest';
import { buildSafeBlockedPath } from './promptDurableSummary.js';

describe('buildSafeBlockedPath', () => {
  it('strips every credential-shaped path segment without corrupting scoped packages', () => {
    expect(buildSafeBlockedPath('/protected/user:s3cr3t@host/a/user2:tok2@host/b')).toBe('/protected/host/a/host/b');
    expect(buildSafeBlockedPath('packages/shared/node_modules/@circuschief/shared/src/index.js')).toBe('packages/shared/node_modules/@circuschief/shared/src/index.js');
    expect(buildSafeBlockedPath('src/emails/user@example.com.template')).toBe('src/emails/user@example.com.template');
  });

  it('removes query, fragment, and a single userinfo segment', () => {
    expect(buildSafeBlockedPath('/protected/user:secret@host/path?key=value#part')).toBe('/protected/host/path');
    expect(buildSafeBlockedPath('')).toBeNull();
    expect(buildSafeBlockedPath(null)).toBeNull();
  });
});
