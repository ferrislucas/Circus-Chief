import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { exec } from 'child_process';

// Mock child_process exec
vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

// Import after mocking
import { isGhAvailable, getPrInfo, resetGhAvailableCache } from './ghService.js';

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
        if (cmd.includes('--json state,mergedAt,mergeable,isDraft')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
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
      });
    });

    it('returns merged state when mergedAt is set', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, callback) => {
        callCount++;
        if (callCount <= 2) {
          callback(null, { stdout: 'ok', stderr: '' });
          return;
        }

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'MERGED',
              mergedAt: '2024-01-15T10:00:00Z',
              mergeable: 'UNKNOWN',
              isDraft: false,
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

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: true,
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

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'CONFLICTING',
              isDraft: false,
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

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
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

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
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

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
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

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft')) {
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

        if (cmd.includes('--json state,mergedAt,mergeable,isDraft')) {
          callback(null, {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergedAt: null,
              mergeable: 'MERGEABLE',
              isDraft: false,
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
});
