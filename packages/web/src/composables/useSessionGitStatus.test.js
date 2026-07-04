import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useSessionGitStatus } from './useSessionGitStatus.js';

vi.mock('./useApi.js', () => ({
  api: {
    getSessionGitStatus: vi.fn(),
  },
}));

import { api } from './useApi.js';

describe('useSessionGitStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats actionable status summaries', async () => {
    api.getSessionGitStatus.mockResolvedValue({
      syncStatus: 'diverged',
      localChangeCount: 3,
      aheadCount: 2,
      behindCount: 1,
    });

    const status = useSessionGitStatus({ getSessionId: () => 'sess-1' });
    await status.refresh();

    expect(status.summaryText.value).toBe('3 local files · 2 unpushed commits · 1 commit to pull');
    expect(status.indicatorTitle.value).toBe('3 local files, 2 unpushed commits, 1 commit to pull');
    expect(status.hasActionableGitStatus.value).toBe(true);
  });

  it('keeps the last successful status after refresh failure', async () => {
    api.getSessionGitStatus
      .mockResolvedValueOnce({ syncStatus: 'clean', localChangeCount: 0, aheadCount: 0, behindCount: 0 })
      .mockRejectedValueOnce(new Error('Git failed'));

    const status = useSessionGitStatus({ getSessionId: () => 'sess-1' });
    await status.refresh();
    await status.refresh({ fetch: true });

    expect(status.summaryText.value).toBe('Git clean');
    expect(status.error.value.message).toBe('Git failed');
  });

  it('surfaces unknown status errors returned by the API', async () => {
    api.getSessionGitStatus.mockResolvedValue({
      syncStatus: 'unknown',
      localChangeCount: 0,
      aheadCount: 0,
      behindCount: 0,
      error: 'Not a git repository',
    });

    const status = useSessionGitStatus({ getSessionId: () => 'sess-1' });
    await status.refresh();

    expect(status.summaryText.value).toBe('Git status unknown');
    expect(status.error.value.message).toBe('Not a git repository');
    expect(status.hasActionableGitStatus.value).toBe(true);
  });

  it('ignores stale responses when the session changes', async () => {
    let resolveFirst;
    let currentSessionId = 'sess-1';
    api.getSessionGitStatus
      .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ syncStatus: 'ahead', localChangeCount: 0, aheadCount: 1, behindCount: 0 });

    const status = useSessionGitStatus({ getSessionId: () => currentSessionId });
    const first = status.refresh();
    currentSessionId = 'sess-2';
    await status.refresh();
    resolveFirst({ syncStatus: 'dirty', localChangeCount: 5, aheadCount: 0, behindCount: 0 });
    await first;

    expect(status.summaryText.value).toBe('1 unpushed commit');
  });
});
