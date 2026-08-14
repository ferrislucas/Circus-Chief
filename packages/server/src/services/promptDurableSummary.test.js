import { describe, expect, it } from 'vitest';
import { buildSafeBlockedPath, buildSafeToolInputSummary } from './promptDurableSummary.js';

describe('buildSafeBlockedPath', () => {
  it('retains only a redacted path marker for every path form', () => {
    expect(buildSafeBlockedPath('/protected/user:s3cr3t@host/a/user2:tok2@host/b')).toBe('[path omitted]');
    expect(buildSafeBlockedPath('packages/shared/node_modules/@circuschief/shared/src/index.js')).toBe('[path omitted]');
    expect(buildSafeBlockedPath('C:\\Users\\alice\\private\\config.js')).toBe('[path omitted]');
  });

  it('does not retain URL credentials, queries, or fragments', () => {
    expect(buildSafeBlockedPath('/protected/user:secret@host/path?key=value#part')).toBe('[path omitted]');
    expect(buildSafeBlockedPath('')).toBeNull();
    expect(buildSafeBlockedPath(null)).toBeNull();
  });
});

describe('buildSafeToolInputSummary path privacy boundary', () => {
  it.each([
    ['POSIX absolute path', 'Write', { file_path: '/Users/alice/acme-private/.env' }, ['alice', 'acme-private']],
    ['Windows absolute path', 'Edit', { file_path: 'C:\\Users\\alice\\customer-42\\config.js' }, ['alice', 'customer-42']],
    ['traversal path', 'Read', { file_path: '../../private-tenant/secrets.txt' }, ['private-tenant']],
    ['glob and search text', 'Grep', { path: '/srv/customer-42', glob: '**/private-*', pattern: 'token=super-secret' }, ['customer-42', 'private-', 'super-secret']],
    ['web search text', 'WebSearch', { query: 'alice customer-42 api key' }, ['alice', 'customer-42']],
  ])('does not persist raw %s values', (_case, toolName, input, markers) => {
    const serialized = JSON.stringify(buildSafeToolInputSummary(toolName, input));

    for (const marker of markers) expect(serialized).not.toContain(marker);
  });

  it('excludes unknown path-like fields by default', () => {
    const summary = buildSafeToolInputSummary('Write', {
      file_path: '/Users/alice/private/config.js',
      backup_path: '/Users/alice/private/backup.js',
    });

    expect(summary).not.toHaveProperty('backup_path');
    expect(JSON.stringify(summary)).not.toContain('alice');
  });
});
