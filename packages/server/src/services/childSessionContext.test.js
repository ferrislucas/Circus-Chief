import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, sessionSummaries } from '../database.js';

// Mock the websocket module
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

import { getChildSessions, buildChildSessionContext, aggregateFilesModified } from './childSessionContext.js';

describe('childSessionContext', () => {
  let projectId;
  let parentSessionId;

  beforeEach(() => {
    const project = projects.create('Test Project', '/tmp/test');
    projectId = project.id;

    const parentSession = sessions.create(projectId, 'Parent Session', 'Test prompt', 'standard');
    parentSessionId = parentSession.id;
  });

  describe('getChildSessions', () => {
    it('returns empty array when no children', () => {
      const children = getChildSessions(parentSessionId);
      expect(children).toEqual([]);
    });

    it('returns child sessions', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      const children = getChildSessions(parentSessionId);
      expect(children.length).toBe(1);
      expect(children[0].name).toBe('Child Session');
    });

    it('returns multiple child sessions', () => {
      const child1 = sessions.create(projectId, 'Child 1', 'Prompt 1', 'standard');
      const child2 = sessions.create(projectId, 'Child 2', 'Prompt 2', 'standard');
      sessions.update(child1.id, { parentSessionId });
      sessions.update(child2.id, { parentSessionId });

      const children = getChildSessions(parentSessionId);
      expect(children.length).toBe(2);
    });
  });

  describe('buildChildSessionContext', () => {
    it('returns empty string when no children', () => {
      const result = buildChildSessionContext(parentSessionId);
      expect(result).toBe('');
    });

    it('includes WORKFLOW DESCENDANT SUMMARIES header', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('WORKFLOW DESCENDANT SUMMARIES');
    });

    it('includes child session name and IDs', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('Child Session');
      expect(result).toContain(`Session ID: ${child.id}`);
      expect(result).toContain(`Parent ID: ${parentSessionId}`);
    });

    it('includes child status', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId, status: 'stopped' });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('Status: stopped');
    });

    it('includes full summary details when summary exists', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      sessionSummaries.create(child.id, {
        shortSummary: 'Feature X implemented',
        fullSummary: 'Detailed implementation of feature X',
        keyActions: ['Created component', 'Added tests'],
        filesModified: ['src/feature.js', 'src/feature.test.js'],
        outcome: 'completed',
      });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('Feature X implemented');
      expect(result).toContain('Detailed implementation of feature X');
      expect(result).toContain('Created component');
      expect(result).toContain('Added tests');
      expect(result).toContain('src/feature.js');
      expect(result).toContain('src/feature.test.js');
      expect(result).toContain('Outcome: completed');
    });

    it('includes fullSummary truncated to 1500 chars', () => {
      const child = sessions.create(projectId, 'Child', 'Prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      const longSummary = 'x'.repeat(2000);
      sessionSummaries.create(child.id, {
        shortSummary: 'Short',
        fullSummary: longSummary,
        outcome: 'completed',
      });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('[truncated]');
      // Should include truncated prefix
      expect(result).toContain('x'.repeat(1500));
    });

    it('limits key actions to 8', () => {
      const child = sessions.create(projectId, 'Child', 'Prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      const manyActions = Array.from({ length: 12 }, (_, i) => `Action ${i + 1}`);
      sessionSummaries.create(child.id, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        keyActions: manyActions,
        outcome: 'completed',
      });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('Action 1');
      expect(result).toContain('Action 8');
      expect(result).not.toContain('Action 9');
      expect(result).toContain('and 4 more');
    });

    it('limits files modified to 20', () => {
      const child = sessions.create(projectId, 'Child', 'Prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      const manyFiles = Array.from({ length: 25 }, (_, i) => `file${i + 1}.js`);
      sessionSummaries.create(child.id, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        filesModified: manyFiles,
        outcome: 'completed',
      });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('file1.js');
      expect(result).toContain('file20.js');
      expect(result).not.toContain('file21.js');
      expect(result).toContain('and 5 more');
    });

    it('includes PR state and CI status when present', () => {
      const child = sessions.create(projectId, 'Child', 'Prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      sessionSummaries.create(child.id, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        outcome: 'completed',
        prState: 'merged',
        ciStatus: 'passed',
        ciFailures: [],
        hasMergeConflicts: false,
      });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('PR state: merged');
      expect(result).toContain('CI status: passed');
      expect(result).toContain('Merge conflicts: no');
    });

    it('includes CI failures when present', () => {
      const child = sessions.create(projectId, 'Child', 'Prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      sessionSummaries.create(child.id, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        outcome: 'failed',
        ciStatus: 'failed',
        ciFailures: ['test-suite-a', 'test-suite-b'],
      });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('CI failures: test-suite-a, test-suite-b');
    });

    it('includes merge conflict status when present', () => {
      const child = sessions.create(projectId, 'Child', 'Prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      sessionSummaries.create(child.id, {
        shortSummary: 'Short',
        fullSummary: 'Full',
        outcome: 'partial',
        hasMergeConflicts: true,
      });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('Merge conflicts: yes');
    });

    it('shows placeholder for descendants without summaries showing status and message count', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId, status: 'running' });
      // No summary for child

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('No summary yet');
      expect(result).toContain('Status: running');
    });

    it('includes grandchildren (recursive)', () => {
      const child = sessions.create(projectId, 'Child', 'Prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      const grandchild = sessions.create(projectId, 'Grandchild', 'Prompt', 'standard');
      sessions.update(grandchild.id, { parentSessionId: child.id });

      sessionSummaries.create(grandchild.id, {
        shortSummary: 'Grandchild work done',
        fullSummary: 'Grandchild full',
        outcome: 'completed',
      });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('Grandchild');
      expect(result).toContain('Grandchild work done');
    });

    it('applies total context truncation limit', () => {
      // Each child contributes ~1700 chars (full summary truncated to 1500 + overhead).
      // Need at least 8 children to exceed the 12000 char total limit.
      for (let i = 0; i < 8; i++) {
        const child = sessions.create(projectId, `Child ${i}`, 'Prompt', 'standard');
        sessions.update(child.id, { parentSessionId });
        sessionSummaries.create(child.id, {
          shortSummary: `Child ${i} summary`,
          fullSummary: 'x'.repeat(2500),
          outcome: 'completed',
        });
      }

      const result = buildChildSessionContext(parentSessionId);
      expect(result.length).toBeLessThanOrEqual(12000 + 100); // allow for truncation marker
      expect(result).toContain('[workflow context truncated]');
    });

    it('produces deterministic ordering by createdAt', () => {
      vi.useFakeTimers();

      try {
        vi.setSystemTime(1000);
        const childA = sessions.create(projectId, 'Child A', 'Prompt', { parentSessionId });
        vi.setSystemTime(2000);
        const childB = sessions.create(projectId, 'Child B', 'Prompt', { parentSessionId });

        sessionSummaries.create(childA.id, { shortSummary: 'A done', fullSummary: 'A full', outcome: 'completed' });
        sessionSummaries.create(childB.id, { shortSummary: 'B done', fullSummary: 'B full', outcome: 'completed' });

        const result1 = buildChildSessionContext(parentSessionId);
        const result2 = buildChildSessionContext(parentSessionId);

        // Same result on every call
        expect(result1).toBe(result2);

        // Child A (earlier) should appear before Child B
        const posA = result1.indexOf('Child A');
        const posB = result1.indexOf('Child B');
        expect(posA).toBeLessThan(posB);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('aggregateFilesModified', () => {
    it('returns current files when no children', () => {
      const result = aggregateFilesModified(parentSessionId, ['file1.js', 'file2.js']);
      expect(result).toEqual(['file1.js', 'file2.js']);
    });

    it('returns empty array when no files and no children', () => {
      const result = aggregateFilesModified(parentSessionId, []);
      expect(result).toEqual([]);
    });

    it('aggregates files from child sessions', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      sessionSummaries.create(child.id, {
        shortSummary: 'Test',
        fullSummary: 'Test',
        keyActions: [],
        filesModified: ['child-file.js'],
        outcome: 'ongoing',
      });

      const result = aggregateFilesModified(parentSessionId, ['parent-file.js']);
      expect(result).toContain('parent-file.js');
      expect(result).toContain('child-file.js');
    });

    it('deduplicates files across parent and child', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      sessionSummaries.create(child.id, {
        shortSummary: 'Test',
        fullSummary: 'Test',
        keyActions: [],
        filesModified: ['shared-file.js', 'child-only.js'],
        outcome: 'ongoing',
      });

      const result = aggregateFilesModified(parentSessionId, ['shared-file.js', 'parent-only.js']);
      const uniqueResult = new Set(result);
      expect(result.length).toBe(uniqueResult.size); // No duplicates
      expect(result).toContain('shared-file.js');
      expect(result).toContain('parent-only.js');
      expect(result).toContain('child-only.js');
    });

    it('recursively aggregates from grandchildren', () => {
      const child = sessions.create(projectId, 'Child', 'Prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      const grandchild = sessions.create(projectId, 'Grandchild', 'Prompt', 'standard');
      sessions.update(grandchild.id, { parentSessionId: child.id });

      sessionSummaries.create(grandchild.id, {
        shortSummary: 'Test',
        fullSummary: 'Test',
        keyActions: [],
        filesModified: ['grandchild-file.js'],
        outcome: 'ongoing',
      });

      const result = aggregateFilesModified(parentSessionId, ['parent-file.js']);
      expect(result).toContain('parent-file.js');
      expect(result).toContain('grandchild-file.js');
    });

    it('handles children with no summary', () => {
      const child = sessions.create(projectId, 'Child', 'Prompt', 'standard');
      sessions.update(child.id, { parentSessionId });
      // No summary for child

      const result = aggregateFilesModified(parentSessionId, ['parent-file.js']);
      expect(result).toEqual(['parent-file.js']);
    });

    it('defaults to empty array when no current files provided', () => {
      const result = aggregateFilesModified(parentSessionId);
      expect(result).toEqual([]);
    });
  });
});
