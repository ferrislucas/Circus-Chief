import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, messages } from '../database.js';

// Mock the websocket module (needed by summaryBroadcast.js)
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock summaryBroadcast
vi.mock('./summaryBroadcast.js', () => ({
  broadcastSessionUpdate: vi.fn(),
}));

// Mock ghService
vi.mock('./ghService.js', () => ({
  getPrInfo: vi.fn().mockResolvedValue({
    merged: false,
    state: 'open',
    hasMergeConflicts: false,
    ciStatus: 'success',
  }),
  isGhAvailable: vi.fn().mockResolvedValue(true),
}));

import {
  parsePrUrl,
  validatePrUrl,
  extractPrUrlFromMessages,
  extractPrUrlIfNeeded,
  enrichPrData,
  setSessionNameFromPr,
} from './prUrlService.js';
import { broadcastSessionUpdate } from './summaryBroadcast.js';
import * as ghService from './ghService.js';

describe('prUrlService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parsePrUrl', () => {
    it('parses a valid GitHub PR URL', () => {
      const result = parsePrUrl('https://github.com/anthropics/circus-chief/pull/123');
      expect(result).toEqual({ owner: 'anthropics', repo: 'circus-chief', number: 123 });
    });

    it('returns null for null input', () => {
      expect(parsePrUrl(null)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parsePrUrl('')).toBeNull();
    });

    it('returns null for invalid URL format', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(parsePrUrl('https://github.com/user/repo')).toBeNull();
      expect(parsePrUrl('https://github.com/user/repo/issues/123')).toBeNull();
      expect(parsePrUrl('https://gitlab.com/user/repo/merge_requests/123')).toBeNull();
      consoleWarnSpy.mockRestore();
    });

    it('parses PR numbers correctly', () => {
      const result = parsePrUrl('https://github.com/org/repo/pull/42');
      expect(result.number).toBe(42);
    });
  });

  describe('validatePrUrl', () => {
    it('validates matching repository', () => {
      const result = validatePrUrl(
        'https://github.com/anthropics/circus-chief/pull/123',
        'https://github.com/anthropics/circus-chief'
      );
      expect(result.valid).toBe(true);
      expect(result.mismatch).toBe(false);
    });

    it('rejects PR from different owner', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validatePrUrl(
        'https://github.com/user/circus-chief/pull/123',
        'https://github.com/anthropics/circus-chief'
      );
      expect(result.valid).toBe(false);
      expect(result.mismatch).toBe(true);
      consoleWarnSpy.mockRestore();
    });

    it('rejects PR from different repo', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validatePrUrl(
        'https://github.com/anthropics/different-repo/pull/123',
        'https://github.com/anthropics/circus-chief'
      );
      expect(result.valid).toBe(false);
      expect(result.mismatch).toBe(true);
      consoleWarnSpy.mockRestore();
    });

    it('accepts when no expected repo URL provided', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validatePrUrl('https://github.com/user/repo/pull/123', null);
      expect(result.valid).toBe(true);
      consoleWarnSpy.mockRestore();
    });

    it('returns invalid for null PR URL', () => {
      const result = validatePrUrl(null, 'https://github.com/user/repo');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('No PR URL provided');
    });

    it('rejects invalid PR URL format', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validatePrUrl('https://github.com/org/repo', 'https://github.com/org/repo');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid PR URL format');
      consoleWarnSpy.mockRestore();
    });

    it('accepts invalid expected repo URL format gracefully', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = validatePrUrl('https://github.com/user/repo/pull/123', 'invalid-url');
      expect(result.valid).toBe(true);
      consoleWarnSpy.mockRestore();
    });

    it('handles trailing slash in expected repo URL', () => {
      const result = validatePrUrl(
        'https://github.com/user/repo/pull/123',
        'https://github.com/user/repo/'
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('extractPrUrlFromMessages', () => {
    let projectId, sessionId;

    beforeEach(() => {
      const project = projects.create('Test Project', '/tmp/test');
      projectId = project.id;
      const session = sessions.create(projectId, 'Test Session', 'Test prompt', 'standard');
      sessionId = session.id;
    });

    it('extracts PR URL from messages', () => {
      messages.create(sessionId, 'assistant', 'Created PR: https://github.com/user/repo/pull/42');
      const result = extractPrUrlFromMessages(sessionId);
      expect(result).toBe('https://github.com/user/repo/pull/42');
    });

    it('returns null when no PR URL found', () => {
      messages.create(sessionId, 'assistant', 'No PR created');
      const result = extractPrUrlFromMessages(sessionId);
      expect(result).toBeNull();
    });

    it('returns null for non-existent session', () => {
      const result = extractPrUrlFromMessages('non-existent');
      expect(result).toBeNull();
    });

    it('returns the most recent PR URL', () => {
      messages.create(sessionId, 'assistant', 'First PR: https://github.com/user/repo/pull/1');
      messages.create(sessionId, 'assistant', 'Second PR: https://github.com/user/repo/pull/2');
      const result = extractPrUrlFromMessages(sessionId);
      expect(result).toBe('https://github.com/user/repo/pull/2');
    });
  });

  describe('extractPrUrlIfNeeded', () => {
    let projectId, sessionId;

    beforeEach(() => {
      const project = projects.create('Test Project', '/tmp/test');
      projectId = project.id;
      const session = sessions.create(projectId, 'Test Session', 'Test prompt', 'standard');
      sessionId = session.id;
    });

    it('extracts and saves PR URL when found', async () => {
      messages.create(sessionId, 'assistant', 'PR: https://github.com/user/repo/pull/42');

      await extractPrUrlIfNeeded(sessionId);

      const session = sessions.getById(sessionId);
      expect(session.prUrl).toBe('https://github.com/user/repo/pull/42');
    });

    it('broadcasts session update when PR URL extracted', async () => {
      messages.create(sessionId, 'assistant', 'PR: https://github.com/user/repo/pull/42');

      await extractPrUrlIfNeeded(sessionId);

      expect(broadcastSessionUpdate).toHaveBeenCalledWith(
        sessionId,
        projectId,
        expect.objectContaining({ id: sessionId })
      );
    });

    it('skips if session already has a PR URL', async () => {
      sessions.update(sessionId, { prUrl: 'https://github.com/user/repo/pull/1' });
      messages.create(sessionId, 'assistant', 'PR: https://github.com/user/repo/pull/42');

      await extractPrUrlIfNeeded(sessionId);

      const session = sessions.getById(sessionId);
      expect(session.prUrl).toBe('https://github.com/user/repo/pull/1');
    });

    it('does nothing for non-existent session', async () => {
      await extractPrUrlIfNeeded('non-existent');
      expect(broadcastSessionUpdate).not.toHaveBeenCalled();
    });

    it('propagates extracted PR URL to root session', async () => {
      const root = sessions.create(projectId, 'Root Session', 'Root prompt');
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard', false, null, root.id);

      // Add a message to child with a PR URL
      messages.create(child.id, 'assistant', 'Created PR: https://github.com/user/repo/pull/999');

      await extractPrUrlIfNeeded(child.id);

      // Verify child has the PR URL
      const childAfter = sessions.getById(child.id);
      expect(childAfter.prUrl).toBe('https://github.com/user/repo/pull/999');

      // Verify root also has the PR URL (propagated)
      const rootAfter = sessions.getById(root.id);
      expect(rootAfter.prUrl).toBe('https://github.com/user/repo/pull/999');
    });

    it('does not propagate if root already has PR URL', async () => {
      const originalPrUrl = 'https://github.com/user/repo/pull/111';
      const root = sessions.create(projectId, 'Root Session', 'Root prompt');
      sessions.update(root.id, { prUrl: originalPrUrl });

      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard', false, null, root.id);

      // Add a message to child with a different PR URL
      messages.create(child.id, 'assistant', 'Created PR: https://github.com/user/repo/pull/888');

      await extractPrUrlIfNeeded(child.id);

      // Verify child has the new PR URL
      const childAfter = sessions.getById(child.id);
      expect(childAfter.prUrl).toBe('https://github.com/user/repo/pull/888');

      // Verify root keeps the original PR URL (first wins)
      const rootAfter = sessions.getById(root.id);
      expect(rootAfter.prUrl).toBe(originalPrUrl);
    });
  });

  describe('enrichPrData', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('enriches summary data with PR info when URL is valid', async () => {
      const summaryData = { prUrl: 'https://github.com/user/repo/pull/123' };

      ghService.getPrInfo.mockResolvedValue({
        state: 'OPEN',
        merged: false,
        hasMergeConflicts: false,
        ciStatus: 'passing',
        ciFailures: 0,
      });

      await enrichPrData(summaryData, 'https://github.com/user/repo/pull/123', 'https://github.com/user/repo', 'sess-1');

      expect(summaryData.prState).toBe('OPEN');
      expect(summaryData.prMerged).toBe(false);
      expect(summaryData.hasMergeConflicts).toBe(false);
      expect(summaryData.ciStatus).toBe('passing');
      expect(summaryData.ciFailures).toBe(0);
    });

    it('sets prUrl to null when validation fails', async () => {
      const summaryData = { prUrl: 'https://github.com/wrong-repo/pull/123' };
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await enrichPrData(summaryData, 'https://github.com/wrong-repo/pull/123', 'https://github.com/correct-repo', 'sess-1');

      expect(summaryData.prUrl).toBeNull();
      consoleWarnSpy.mockRestore();
    });

    it('handles ghService errors gracefully', async () => {
      const summaryData = { prUrl: 'https://github.com/user/repo/pull/123' };
      ghService.getPrInfo.mockRejectedValue(new Error('API error'));
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await enrichPrData(summaryData, 'https://github.com/user/repo/pull/123', 'https://github.com/user/repo', 'sess-1');

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[PrUrlService] Failed to get PR info for https://github.com/user/repo/pull/123:',
        'API error'
      );
      consoleWarnSpy.mockRestore();
    });

    it('does not modify summary data when ghService returns null', async () => {
      const summaryData = { prUrl: 'https://github.com/user/repo/pull/123' };
      ghService.getPrInfo.mockResolvedValue(null);

      await enrichPrData(summaryData, 'https://github.com/user/repo/pull/123', 'https://github.com/user/repo', 'sess-1');

      expect(summaryData.prUrl).toBe('https://github.com/user/repo/pull/123');
      expect(summaryData.prState).toBeUndefined();
    });

    it('adds PR title to summary data when available', async () => {
      const summaryData = { prUrl: 'https://github.com/user/repo/pull/123' };

      ghService.getPrInfo.mockResolvedValue({
        state: 'OPEN',
        merged: false,
        hasMergeConflicts: false,
        ciStatus: 'passing',
        title: 'Fix critical bug',
      });

      await enrichPrData(summaryData, 'https://github.com/user/repo/pull/123', 'https://github.com/user/repo', 'sess-1');

      expect(summaryData.prTitle).toBe('Fix critical bug');
    });

    it('does not add prTitle when title is not present', async () => {
      const summaryData = { prUrl: 'https://github.com/user/repo/pull/123' };

      ghService.getPrInfo.mockResolvedValue({
        state: 'OPEN',
        merged: false,
        hasMergeConflicts: false,
        ciStatus: 'passing',
        // No title field
      });

      await enrichPrData(summaryData, 'https://github.com/user/repo/pull/123', 'https://github.com/user/repo', 'sess-1');

      expect(summaryData.prTitle).toBeUndefined();
    });
  });

  describe('setSessionNameFromPr', () => {
    let projectId, sessionId;

    beforeEach(() => {
      vi.clearAllMocks();
      const project = projects.create('Test Project', '/tmp/test');
      projectId = project.id;
      const session = sessions.create(projectId, 'Original Name', 'Test prompt', 'standard');
      sessionId = session.id;
    });

    it('sets session name to PR title when PR URL is provided', async () => {
      ghService.getPrInfo.mockResolvedValue({
        title: 'Add new feature',
        state: 'OPEN',
        merged: false,
      });

      await setSessionNameFromPr(sessionId, 'https://github.com/org/repo/pull/123');

      const updated = sessions.getById(sessionId);
      expect(updated.name).toBe('Add new feature');
      expect(updated.manuallyNamed).toBe(true);
    });

    it('does not overwrite name if manuallyNamed is already true', async () => {
      sessions.update(sessionId, { name: 'Custom Name', manuallyNamed: true });

      ghService.getPrInfo.mockResolvedValue({
        title: 'Different Title',
        state: 'OPEN',
        merged: false,
      });

      await setSessionNameFromPr(sessionId, 'https://github.com/org/repo/pull/123');

      const updated = sessions.getById(sessionId);
      expect(updated.name).toBe('Custom Name'); // Should NOT change
    });

    it('handles gh CLI errors gracefully without setting name', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      ghService.getPrInfo.mockRejectedValue(new Error('gh not available'));

      await setSessionNameFromPr(sessionId, 'https://github.com/org/repo/pull/123');

      const updated = sessions.getById(sessionId);
      expect(updated.name).toBe('Original Name'); // Should NOT change
      expect(updated.manuallyNamed).toBe(false);
      consoleWarnSpy.mockRestore();
    });

    it('handles missing PR title gracefully without setting name', async () => {
      ghService.getPrInfo.mockResolvedValue({ state: 'OPEN', merged: false }); // No title

      await setSessionNameFromPr(sessionId, 'https://github.com/org/repo/pull/123');

      const updated = sessions.getById(sessionId);
      expect(updated.name).toBe('Original Name'); // Should NOT change
      expect(updated.manuallyNamed).toBe(false);
    });

    it('broadcasts session update after setting name', async () => {
      ghService.getPrInfo.mockResolvedValue({
        title: 'New Title',
        state: 'OPEN',
        merged: false,
      });

      await setSessionNameFromPr(sessionId, 'https://github.com/org/repo/pull/123');

      expect(broadcastSessionUpdate).toHaveBeenCalledWith(
        sessionId,
        projectId,
        expect.objectContaining({ name: 'New Title' })
      );
    });

    it('does nothing for non-existent session', async () => {
      await setSessionNameFromPr('non-existent', 'https://github.com/org/repo/pull/123');
      expect(ghService.getPrInfo).not.toHaveBeenCalled();
      expect(broadcastSessionUpdate).not.toHaveBeenCalled();
    });

    it('handles null session gracefully', async () => {
      await setSessionNameFromPr(null, 'https://github.com/org/repo/pull/123');
      expect(ghService.getPrInfo).not.toHaveBeenCalled();
      expect(broadcastSessionUpdate).not.toHaveBeenCalled();
    });
  });

  describe('extractPrUrlIfNeeded with name setting', () => {
    let projectId, sessionId;

    beforeEach(() => {
      vi.clearAllMocks();
      const project = projects.create('Test Project', '/tmp/test');
      projectId = project.id;
      const session = sessions.create(projectId, 'Original Name', 'Test prompt', 'standard');
      sessionId = session.id;
    });

    it('sets session name from PR title when extracting PR URL', async () => {
      const prUrl = 'https://github.com/org/repo/pull/123';
      messages.create(sessionId, 'assistant', `I've created a PR: ${prUrl}`);

      ghService.getPrInfo.mockResolvedValue({
        title: 'Extracted PR Title',
        state: 'OPEN',
        merged: false,
      });

      await extractPrUrlIfNeeded(sessionId);

      const session = sessions.getById(sessionId);
      expect(session.prUrl).toBe(prUrl);
      expect(session.name).toBe('Extracted PR Title');
      expect(session.manuallyNamed).toBe(true);
    });

    it('does not set name if manuallyNamed is true', async () => {
      sessions.update(sessionId, { name: 'My Custom Session', manuallyNamed: true });
      const prUrl = 'https://github.com/org/repo/pull/123';
      messages.create(sessionId, 'assistant', `I've created a PR: ${prUrl}`);

      ghService.getPrInfo.mockResolvedValue({
        title: 'Different PR Title',
        state: 'OPEN',
        merged: false,
      });

      await extractPrUrlIfNeeded(sessionId);

      const session = sessions.getById(sessionId);
      expect(session.prUrl).toBe(prUrl);
      expect(session.name).toBe('My Custom Session'); // Should NOT change
    });
  });
});
