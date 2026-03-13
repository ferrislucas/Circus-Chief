import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSummaries } from './useSummaries.js';

// Mock the api
vi.mock('./useApi.js', () => ({
  api: {
    getSessionSummariesBatch: vi.fn(),
    getSessionSummary: vi.fn(),
  },
}));

import { api } from './useApi.js';

describe('useSummaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('returns empty reactive objects', () => {
      const { summaries, loadingSummaries, summaryErrors } = useSummaries();

      expect(Object.keys(summaries)).toHaveLength(0);
      expect(Object.keys(loadingSummaries)).toHaveLength(0);
      expect(Object.keys(summaryErrors)).toHaveLength(0);
    });
  });

  describe('fetchSummariesBatch', () => {
    it('fetches summaries for sessions without existing summaries', async () => {
      const { summaries, fetchSummariesBatch } = useSummaries();
      const sessions = [{ id: 'sess-1' }, { id: 'sess-2' }];

      api.getSessionSummariesBatch.mockResolvedValue({
        'sess-1': { title: 'Summary 1' },
        'sess-2': { title: 'Summary 2' },
      });

      await fetchSummariesBatch(sessions);

      expect(api.getSessionSummariesBatch).toHaveBeenCalledWith(['sess-1', 'sess-2']);
      expect(summaries['sess-1']).toEqual({ title: 'Summary 1' });
      expect(summaries['sess-2']).toEqual({ title: 'Summary 2' });
    });

    it('skips sessions that already have summaries', async () => {
      const { summaries, fetchSummariesBatch } = useSummaries();
      summaries['sess-1'] = { title: 'Existing Summary' };

      const sessions = [{ id: 'sess-1' }, { id: 'sess-2' }];

      api.getSessionSummariesBatch.mockResolvedValue({
        'sess-2': { title: 'Summary 2' },
      });

      await fetchSummariesBatch(sessions);

      expect(api.getSessionSummariesBatch).toHaveBeenCalledWith(['sess-2']);
      expect(summaries['sess-1']).toEqual({ title: 'Existing Summary' });
      expect(summaries['sess-2']).toEqual({ title: 'Summary 2' });
    });

    it('skips sessions that are currently loading', async () => {
      const { loadingSummaries, fetchSummariesBatch } = useSummaries();
      loadingSummaries['sess-1'] = true;

      const sessions = [{ id: 'sess-1' }, { id: 'sess-2' }];

      api.getSessionSummariesBatch.mockResolvedValue({
        'sess-2': { title: 'Summary 2' },
      });

      await fetchSummariesBatch(sessions);

      expect(api.getSessionSummariesBatch).toHaveBeenCalledWith(['sess-2']);
    });

    it('does nothing when all sessions already have summaries', async () => {
      const { summaries, fetchSummariesBatch } = useSummaries();
      summaries['sess-1'] = { title: 'Summary 1' };
      summaries['sess-2'] = { title: 'Summary 2' };

      const sessions = [{ id: 'sess-1' }, { id: 'sess-2' }];

      await fetchSummariesBatch(sessions);

      expect(api.getSessionSummariesBatch).not.toHaveBeenCalled();
    });

    it('sets loading state during fetch', async () => {
      const { loadingSummaries, fetchSummariesBatch } = useSummaries();
      const sessions = [{ id: 'sess-1' }];

      let loadingDuringFetch = null;
      api.getSessionSummariesBatch.mockImplementation(async () => {
        loadingDuringFetch = loadingSummaries['sess-1'];
        return { 'sess-1': { title: 'Summary' } };
      });

      await fetchSummariesBatch(sessions);

      expect(loadingDuringFetch).toBe(true);
      expect(loadingSummaries['sess-1']).toBe(false);
    });

    it('sets error state on failure', async () => {
      const { summaryErrors, loadingSummaries, fetchSummariesBatch } = useSummaries();
      const sessions = [{ id: 'sess-1' }];

      api.getSessionSummariesBatch.mockRejectedValue(new Error('Network error'));

      await fetchSummariesBatch(sessions);

      expect(summaryErrors['sess-1']).toBe(true);
      expect(loadingSummaries['sess-1']).toBe(false);
    });

    it('clears error state before fetching', async () => {
      const { summaryErrors, fetchSummariesBatch } = useSummaries();
      summaryErrors['sess-1'] = true;

      const sessions = [{ id: 'sess-1' }];
      api.getSessionSummariesBatch.mockResolvedValue({
        'sess-1': { title: 'Summary' },
      });

      await fetchSummariesBatch(sessions);

      expect(summaryErrors['sess-1']).toBe(false);
    });
  });

  describe('fetchSummary', () => {
    it('fetches a single summary', async () => {
      const { summaries, fetchSummary } = useSummaries();

      api.getSessionSummary.mockResolvedValue({ title: 'Summary' });

      await fetchSummary('sess-1');

      expect(api.getSessionSummary).toHaveBeenCalledWith('sess-1');
      expect(summaries['sess-1']).toEqual({ title: 'Summary' });
    });

    it('sets loading state during fetch', async () => {
      const { loadingSummaries, fetchSummary } = useSummaries();

      let loadingDuringFetch = null;
      api.getSessionSummary.mockImplementation(async () => {
        loadingDuringFetch = loadingSummaries['sess-1'];
        return { title: 'Summary' };
      });

      await fetchSummary('sess-1');

      expect(loadingDuringFetch).toBe(true);
      expect(loadingSummaries['sess-1']).toBe(false);
    });

    it('does not set error for null response (no summary yet)', async () => {
      const { summaries, summaryErrors, fetchSummary } = useSummaries();

      api.getSessionSummary.mockResolvedValue(null);

      await fetchSummary('sess-1');

      expect(summaries['sess-1']).toBeUndefined();
      expect(summaryErrors['sess-1']).toBeFalsy();
    });

    it('sets error on non-404 failures', async () => {
      const { summaryErrors, fetchSummary } = useSummaries();

      const error = new Error('Server error');
      error.response = { status: 500 };
      api.getSessionSummary.mockRejectedValue(error);

      await fetchSummary('sess-1');

      expect(summaryErrors['sess-1']).toBe(true);
    });

    it('does not set error on 404 (no summary yet)', async () => {
      const { summaryErrors, fetchSummary } = useSummaries();

      const error = new Error('Not found');
      error.response = { status: 404 };
      api.getSessionSummary.mockRejectedValue(error);

      await fetchSummary('sess-1');

      expect(summaryErrors['sess-1']).toBeFalsy();
    });
  });

  describe('retryFetchSummary', () => {
    it('clears error state and refetches', async () => {
      const { summaries, summaryErrors, retryFetchSummary } = useSummaries();
      summaryErrors['sess-1'] = true;

      api.getSessionSummary.mockResolvedValue({ title: 'Retried Summary' });

      await retryFetchSummary('sess-1');

      expect(summaryErrors['sess-1']).toBe(false);
      expect(summaries['sess-1']).toEqual({ title: 'Retried Summary' });
    });
  });

  describe('updateSummary', () => {
    it('updates summary and clears loading/error state', () => {
      const { summaries, loadingSummaries, summaryErrors, updateSummary } = useSummaries();
      loadingSummaries['sess-1'] = true;
      summaryErrors['sess-1'] = true;

      updateSummary('sess-1', { title: 'Updated Summary' });

      expect(summaries['sess-1']).toEqual({ title: 'Updated Summary' });
      expect(loadingSummaries['sess-1']).toBe(false);
      expect(summaryErrors['sess-1']).toBe(false);
    });
  });

  describe('cleanupSummary', () => {
    it('removes all state for a session', () => {
      const { summaries, loadingSummaries, summaryErrors, cleanupSummary } = useSummaries();
      summaries['sess-1'] = { title: 'Summary' };
      loadingSummaries['sess-1'] = false;
      summaryErrors['sess-1'] = false;

      cleanupSummary('sess-1');

      expect(summaries['sess-1']).toBeUndefined();
      expect(loadingSummaries['sess-1']).toBeUndefined();
      expect(summaryErrors['sess-1']).toBeUndefined();
    });
  });

  describe('watchSessionsForSummaries', () => {
    it('returns a cleanup function', () => {
      const { watchSessionsForSummaries } = useSummaries();

      const cleanup = watchSessionsForSummaries(() => []);

      expect(typeof cleanup).toBe('function');
      cleanup(); // Should not throw
    });
  });
});
