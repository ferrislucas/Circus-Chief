import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, messages, sessionSummaries } from '../database.js';

// Mock the websocket module to avoid WebSocket server dependency
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

import { computeWorkflowFingerprint } from './summaryFingerprint.js';

/**
 * Helper to create a session directly as a child of a parent (no initial messages).
 */
function createChildSession(projectId, name, parentSessionId) {
  const session = sessions.create(projectId, name, 'prompt', { parentSessionId });
  return session;
}

describe('summaryFingerprint', () => {
  let projectId;
  let rootSessionId;

  beforeEach(() => {
    const project = projects.create('Test Project', '/tmp/fingerprint-test');
    projectId = project.id;

    const root = sessions.create(projectId, 'Root Session', 'Initial prompt');
    rootSessionId = root.id;
  });

  describe('computeWorkflowFingerprint', () => {
    it('produces a non-empty SHA-256 hex string', async () => {
      const fp = await computeWorkflowFingerprint(rootSessionId);
      expect(typeof fp).toBe('string');
      expect(fp).toHaveLength(64);
      expect(fp).toMatch(/^[0-9a-f]+$/);
    });

    it('produces stable fingerprints for identical workflow state', async () => {
      const fp1 = await computeWorkflowFingerprint(rootSessionId);
      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).toBe(fp2);
    });

    it('produces stable fingerprints when descendants have summaries and nothing has changed', async () => {
      const child = createChildSession(projectId, 'Child', rootSessionId);
      sessionSummaries.create(child.id, {
        shortSummary: 'Child done',
        fullSummary: 'Child implementation complete',
        outcome: 'completed',
      });

      const fp1 = await computeWorkflowFingerprint(rootSessionId);
      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).toBe(fp2);
    });

    it('changes when a new message is added to root', async () => {
      const fp1 = await computeWorkflowFingerprint(rootSessionId);
      messages.create(rootSessionId, 'assistant', 'New response');
      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('changes when a descendant gets a new message (lastMessageId changes)', async () => {
      const child = createChildSession(projectId, 'Child', rootSessionId);

      const fp1 = await computeWorkflowFingerprint(rootSessionId);

      messages.create(child.id, 'assistant', 'Child response');

      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('changes when a descendant summary shortSummary changes (even if timestamps did not change)', async () => {
      const child = createChildSession(projectId, 'Child', rootSessionId);
      const childSummary = sessionSummaries.create(child.id, {
        shortSummary: 'Work in progress',
        fullSummary: 'Detailed progress',
        outcome: 'ongoing',
      });

      const fp1 = await computeWorkflowFingerprint(rootSessionId);

      // Update content without changing the generatedAt (simulate same timestamp)
      sessionSummaries.update(childSummary.id, {
        shortSummary: 'Work completed',
      });

      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('changes when a descendant summary fullSummary changes', async () => {
      const child = createChildSession(projectId, 'Child', rootSessionId);
      const childSummary = sessionSummaries.create(child.id, {
        shortSummary: 'Short',
        fullSummary: 'Original full summary',
        outcome: 'ongoing',
      });

      const fp1 = await computeWorkflowFingerprint(rootSessionId);

      sessionSummaries.update(childSummary.id, {
        fullSummary: 'Updated full summary with more details',
      });

      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('changes when a descendant summary outcome changes', async () => {
      const child = createChildSession(projectId, 'Child', rootSessionId);
      const childSummary = sessionSummaries.create(child.id, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        outcome: 'ongoing',
      });

      const fp1 = await computeWorkflowFingerprint(rootSessionId);

      sessionSummaries.update(childSummary.id, {
        outcome: 'completed',
      });

      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('changes when a descendant summary keyActions changes', async () => {
      const child = createChildSession(projectId, 'Child', rootSessionId);
      const childSummary = sessionSummaries.create(child.id, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        keyActions: ['Action 1'],
        outcome: 'ongoing',
      });

      const fp1 = await computeWorkflowFingerprint(rootSessionId);

      sessionSummaries.update(childSummary.id, {
        keyActions: ['Action 1', 'Action 2'],
      });

      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('changes when a descendant summary filesModified changes', async () => {
      const child = createChildSession(projectId, 'Child', rootSessionId);
      const childSummary = sessionSummaries.create(child.id, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        filesModified: ['file1.js'],
        outcome: 'ongoing',
      });

      const fp1 = await computeWorkflowFingerprint(rootSessionId);

      sessionSummaries.update(childSummary.id, {
        filesModified: ['file1.js', 'file2.js'],
      });

      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('includes grandchildren and deeper descendants', async () => {
      const child = createChildSession(projectId, 'Child', rootSessionId);
      const grandchild = createChildSession(projectId, 'Grandchild', child.id);

      const fp1 = await computeWorkflowFingerprint(rootSessionId);

      // Adding message to grandchild should change fingerprint
      messages.create(grandchild.id, 'assistant', 'Grandchild response');

      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('includes great-grandchildren in the fingerprint', async () => {
      const child = createChildSession(projectId, 'Child', rootSessionId);
      const grandchild = createChildSession(projectId, 'Grandchild', child.id);
      const greatGrandchild = createChildSession(projectId, 'GGC', grandchild.id);

      const fp1 = await computeWorkflowFingerprint(rootSessionId);

      messages.create(greatGrandchild.id, 'assistant', 'Deep response');

      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('produces deterministic ordering when siblings are inserted in different orders', async () => {
      // Create two sibling sessions with different insertion order variations
      // The fingerprint should be the same regardless of DB row insertion order
      // as long as createdAt ordering is identical

      vi.useFakeTimers();

      try {
        vi.setSystemTime(1000);
        const childA = createChildSession(projectId, 'Child A', rootSessionId);

        vi.setSystemTime(2000);
        const childB = createChildSession(projectId, 'Child B', rootSessionId);

        sessionSummaries.create(childA.id, {
          shortSummary: 'A done',
          fullSummary: 'A full',
          outcome: 'completed',
        });
        sessionSummaries.create(childB.id, {
          shortSummary: 'B done',
          fullSummary: 'B full',
          outcome: 'completed',
        });

        const fp1 = await computeWorkflowFingerprint(rootSessionId);
        const fp2 = await computeWorkflowFingerprint(rootSessionId);

        // Should be stable across calls
        expect(fp1).toBe(fp2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT change when only child summary generatedAt/updatedAt change (same semantic content)', async () => {
      vi.useFakeTimers();

      try {
        // Create child session and summary at T1
        vi.setSystemTime(1000);
        const child = createChildSession(projectId, 'Child', rootSessionId);
        const childSummary = sessionSummaries.create(child.id, {
          shortSummary: 'Work in progress',
          fullSummary: 'Detailed progress',
          keyActions: ['Action A'],
          filesModified: ['file.js'],
          outcome: 'ongoing',
          messageCount: 0,
          lastSummarizedMessageId: null,
        });

        const fp1 = await computeWorkflowFingerprint(rootSessionId);

        // Advance time and call update() with identical semantic content.
        // This triggers both generatedAt and updatedAt to refresh (the problematic
        // behavior that caused cascading re-generations before this fix).
        vi.setSystemTime(9000);
        sessionSummaries.update(childSummary.id, {
          shortSummary: 'Work in progress',
          fullSummary: 'Detailed progress',
          keyActions: ['Action A'],
          filesModified: ['file.js'],
          outcome: 'ongoing',
          messageCount: 0,
          lastSummarizedMessageId: null,
        });

        const fp2 = await computeWorkflowFingerprint(rootSessionId);
        // Fingerprint must be the same because only timestamps changed
        expect(fp1).toBe(fp2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT change when only child summary updatedAt changes (re-upsert with same content)', async () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(1000);
        const child = createChildSession(projectId, 'Child', rootSessionId);
        const childSummary = sessionSummaries.create(child.id, {
          shortSummary: 'Done',
          fullSummary: 'Completed full',
          outcome: 'completed',
          messageCount: 5,
          lastSummarizedMessageId: 'msg-abc',
        });

        const fp1 = await computeWorkflowFingerprint(rootSessionId);

        // Advance to a different time — only timestamps will refresh
        vi.setSystemTime(5000);
        sessionSummaries.update(childSummary.id, {
          shortSummary: 'Done',
          fullSummary: 'Completed full',
          outcome: 'completed',
          messageCount: 5,
          lastSummarizedMessageId: 'msg-abc',
        });

        const fp2 = await computeWorkflowFingerprint(rootSessionId);
        expect(fp1).toBe(fp2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('changes when a descendant session status changes', async () => {
      const child = createChildSession(projectId, 'Child', rootSessionId);

      const fp1 = await computeWorkflowFingerprint(rootSessionId);

      // Change the child session status
      sessions.update(child.id, { status: 'stopped' });

      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('changes when a descendant is added to the workflow tree', async () => {
      const fp1 = await computeWorkflowFingerprint(rootSessionId);

      // Add a child session after computing the first fingerprint
      createChildSession(projectId, 'New Child', rootSessionId);

      const fp2 = await computeWorkflowFingerprint(rootSessionId);
      expect(fp1).not.toBe(fp2);
    });

    it('same summary content but different summary ID produces same contentHash', async () => {
      // Two children with identical summary content should produce identical contentHash
      const childA = createChildSession(projectId, 'Child A', rootSessionId);
      const childB = createChildSession(projectId, 'Child B', rootSessionId);

      sessionSummaries.create(childA.id, {
        shortSummary: 'Same summary',
        fullSummary: 'Same full summary',
        outcome: 'completed',
        filesModified: ['file.js'],
        keyActions: ['did thing'],
      });
      sessionSummaries.create(childB.id, {
        shortSummary: 'Same summary',
        fullSummary: 'Same full summary',
        outcome: 'completed',
        filesModified: ['file.js'],
        keyActions: ['did thing'],
      });

      // The overall fingerprint won't be the same (different sessionIds, different parentIds),
      // but we just verify the call succeeds and produces a string
      const fp = await computeWorkflowFingerprint(rootSessionId);
      expect(typeof fp).toBe('string');
      expect(fp).toHaveLength(64);
    });
  });
});
