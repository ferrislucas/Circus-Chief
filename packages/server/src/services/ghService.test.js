import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exec } from 'child_process';

// Mock child_process exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Import after mocking
import { isGhAvailable, getPrInfo, resetGhAvailableCache, extractPrInfo, validatePrRepository } from './ghService.js';

describe('ghService', () => {
  beforeEach(() => {
    resetGhAvailableCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isGhAvailable', () => {
    it('returns true when gh is installed and authenticated', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: 'gh version 2.0.0', stderr: '' });
      });

      const result = await isGhAvailable();
      expect(result).toBe(true);
    });

    it('returns false when gh is not installed', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(new Error('command not found: gh'), null);
      });

      const result = await isGhAvailable();
      expect(result).toBe(false);
    });

    it('caches the result', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(null, { stdout: 'ok', stderr: '' });
      });

      await isGhAvailable();
      await isGhAvailable();
      await isGhAvailable();

      // Should only call exec twice (version + auth), not 6 times
      expect(exec).toHaveBeenCalledTimes(2);
    });
  });

  describe('getPrInfo', () => {
    beforeEach(() => {
      // Setup gh as available by default
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        // First two calls are for isGhAvailable check
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        // Handle PR view commands
        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
              title: 'Test PR Title',
            }),
            stderr: '',
          });
        } else if (cmd.includes('--json statusCheckRollup')) {
          callback(null, {
            stdout: JSON.stringify({
              statusCheckRollup: [
                { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
                { name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' },
              ],
            }),
            stderr: '',
          });
        }
      });
    });

    it('returns null when gh is not available', async () => {
      exec.mockImplementation((cmd, callback) => {
        callback(new Error('command not found'), null);
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/123');
      expect(result).toBe(null);
    });

    it('returns PR info with open state', async () => {
      const result = await getPrInfo('https://github.com/org/repo/pull/123');

      expect(result).toEqual({
        state: 'open',
        merged: false,
        hasMergeConflicts: false,
        ciStatus: 'success',
        ciFailures: [],
        title: 'Test PR Title',
      });
    });

    it('returns PR title in the result', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
              title: 'Fix critical bug in authentication',
            }),
            stderr: '',
          });
        } else if (cmd.includes('--json statusCheckRollup')) {
          callback(null, { stdout: JSON.stringify({ statusCheckRollup: [] }), stderr: '' });
        }
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/123');
      expect(result.title).toBe('Fix critical bug in authentication');
    });

    it('returns null title when gh CLI returns no title', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
              // No title field
            }),
            stderr: '',
          });
        } else if (cmd.includes('--json statusCheckRollup')) {
          callback(null, { stdout: JSON.stringify({ statusCheckRollup: [] }), stderr: '' });
        }
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/123');
      expect(result.title).toBeNull();
    });

    it('returns merged state when mergedAt is set', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'MERGED',
              mergedAt: '2024-01-15T10:00:00Z',
              mergeable: 'UNKNOWN',
              isDraft: false,
              title: 'Merged PR',
            }),
            stderr: '',
          });
        } else if (cmd.includes('--json statusCheckRollup')) {
          callback(null, { stdout: JSON.stringify({ statusCheckRollup: [] }), stderr: '' });
        }
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/123');
      expect(result.state).toBe('merged');
      expect(result.merged).toBe(true);
    });

    it('returns draft state when isDraft is true', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: true,
              title: 'Draft PR',
            }),
            stderr: '',
          });
        } else if (cmd.includes('--json statusCheckRollup')) {
          callback(null, { stdout: JSON.stringify({ statusCheckRollup: [] }), stderr: '' });
        }
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/123');
      expect(result.state).toBe('draft');
    });

    it('detects merge conflicts', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'CONFLICTING',
              isDraft: false,
              title: 'Conflicting PR',
            }),
            stderr: '',
          });
        } else if (cmd.includes('--json statusCheckRollup')) {
          callback(null, { stdout: JSON.stringify({ statusCheckRollup: [] }), stderr: '' });
        }
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/123');
      expect(result.hasMergeConflicts).toBe(true);
    });

    it('detects CI failures', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
              title: 'CI Failure PR',
            }),
            stderr: '',
          });
        } else if (cmd.includes('--json statusCheckRollup')) {
          callback(null, {
            stdout: JSON.stringify({
              statusCheckRollup: [
                { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
                { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
                { name: 'test', status: 'COMPLETED', conclusion: 'TIMED_OUT' },
              ],
            }),
            stderr: '',
          });
        }
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/123');
      expect(result.ciStatus).toBe('failure');
      expect(result.ciFailures).toEqual(['lint', 'test']);
    });

    it('detects pending CI checks', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
              title: 'Pending CI PR',
            }),
            stderr: '',
          });
        } else if (cmd.includes('--json statusCheckRollup')) {
          callback(null, {
            stdout: JSON.stringify({
              statusCheckRollup: [
                { name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS' },
                { name: 'test', status: 'IN_PROGRESS', conclusion: null },
              ],
            }),
            stderr: '',
          });
        }
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/123');
      expect(result.ciStatus).toBe('pending');
    });

    it('continues without CI data when statusCheckRollup fails (permissions error)', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
              title: 'Permission Error PR',
            }),
            stderr: '',
          });
        } else if (cmd.includes('--json statusCheckRollup')) {
          callback(
            new Error('Resource not accessible by personal access token'),
            null
          );
        }
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/123');

      // Should still return basic PR info
      expect(result).not.toBe(null);
      expect(result.state).toBe('open');
      expect(result.merged).toBe(false);
      expect(result.hasMergeConflicts).toBe(false);

      // CI status should be null (unavailable)
      expect(result.ciStatus).toBe(null);
      expect(result.ciFailures).toEqual([]);
    });

    it('returns null when basic PR info fetch fails', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(new Error('Could not resolve to a PullRequest'), null);
        }
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/999999');
      expect(result).toBe(null);
    });

    it('handles empty statusCheckRollup array', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft,title')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
              title: 'Empty CI PR',
            }),
            stderr: '',
          });
        } else if (cmd.includes('--json statusCheckRollup')) {
          callback(null, { stdout: JSON.stringify({ statusCheckRollup: [] }), stderr: '' });
        }
      });

      const result = await getPrInfo('https://github.com/org/repo/pull/123');
      expect(result.ciStatus).toBe(null);
      expect(result.ciFailures).toEqual([]);
    });
  });

  describe('extractPrInfo', () => {
    it('extracts PR info from valid GitHub URL', () => {
      const result = extractPrInfo('https://github.com/anthropics/circus-chief/pull/123');
      expect(result).toEqual({
        owner: 'anthropics',
        repo: 'circus-chief',
        number: 123,
      });
    });

    it('extracts PR info with different owner and repo names', () => {
      const result = extractPrInfo('https://github.com/user-name/repo-name/pull/456');
      expect(result).toEqual({
        owner: 'user-name',
        repo: 'repo-name',
        number: 456,
      });
    });

    it('returns null for invalid URL format', () => {
      expect(extractPrInfo('https://github.com/user/repo')).toBe(null);
      expect(extractPrInfo('https://github.com/user/repo/issues/123')).toBe(null);
      expect(extractPrInfo('https://gitlab.com/user/repo/merge_requests/123')).toBe(null);
    });

    it('returns null for null or empty URL', () => {
      expect(extractPrInfo(null)).toBe(null);
      expect(extractPrInfo('')).toBe(null);
      expect(extractPrInfo(undefined)).toBe(null);
    });

    it('parses PR number as integer', () => {
      const result = extractPrInfo('https://github.com/org/repo/pull/999');
      expect(result?.number).toBe(999);
      expect(typeof result?.number).toBe('number');
    });
  });

  describe('validatePrRepository', () => {
    it('validates PR from expected repository', () => {
      const result = validatePrRepository(
        'https://github.com/anthropics/circus-chief/pull/123',
        'https://github.com/anthropics/circus-chief'
      );
      expect(result).toEqual({ valid: true, mismatch: false, error: null });
    });

    it('detects PR from different owner', () => {
      const result = validatePrRepository(
        'https://github.com/user/circus-chief/pull/123',
        'https://github.com/anthropics/circus-chief'
      );
      expect(result.valid).toBe(false);
      expect(result.mismatch).toBe(true);
      expect(result.error).toContain('user/circus-chief');
      expect(result.error).toContain('anthropics/circus-chief');
    });

    it('detects PR from different repo', () => {
      const result = validatePrRepository(
        'https://github.com/anthropics/different-repo/pull/123',
        'https://github.com/anthropics/circus-chief'
      );
      expect(result.valid).toBe(false);
      expect(result.mismatch).toBe(true);
      expect(result.error).toContain('anthropics/different-repo');
      expect(result.error).toContain('anthropics/circus-chief');
    });

    it('handles trailing slash in expected repo URL', () => {
      const result = validatePrRepository(
        'https://github.com/org/repo/pull/123',
        'https://github.com/org/repo/'
      );
      expect(result.valid).toBe(true);
      expect(result.mismatch).toBe(false);
    });

    it('accepts PR when no expected repo URL provided', () => {
      const result = validatePrRepository(
        'https://github.com/user/repo/pull/123',
        null
      );
      expect(result.valid).toBe(true);
      expect(result.mismatch).toBe(false);
    });

    it('rejects invalid PR URL format', () => {
      const result = validatePrRepository(
        'https://github.com/org/repo',
        'https://github.com/org/repo'
      );
      expect(result.valid).toBe(false);
      expect(result.mismatch).toBe(false);
      expect(result.error).toContain('Invalid PR URL format');
    });

    it('rejects null or empty PR URL', () => {
      const result = validatePrRepository(
        null,
        'https://github.com/org/repo'
      );
      expect(result.valid).toBe(false);
      expect(result.mismatch).toBe(false);
      expect(result.error).toContain('No PR URL provided');
    });

    it('accepts invalid expected repo URL format', () => {
      const result = validatePrRepository(
        'https://github.com/org/repo/pull/123',
        'invalid-url'
      );
      expect(result.valid).toBe(true);
      expect(result.mismatch).toBe(false);
    });
  });
});
