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

    it('includes child session info with summary', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      sessionSummaries.create(child.id, {
        shortSummary: 'Working on feature X',
        fullSummary: 'Detailed work on feature X',
        keyActions: [],
        filesModified: [],
        outcome: 'ongoing',
      });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('CHILD SESSIONS (1)');
      expect(result).toContain('Child Session');
      expect(result).toContain('Working on feature X');
    });

    it('includes child count in header', () => {
      for (let i = 0; i < 3; i++) {
        const child = sessions.create(projectId, `Child ${i}`, `Prompt ${i}`, 'standard');
        sessions.update(child.id, { parentSessionId });
      }

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('CHILD SESSIONS (3)');
    });

    it('shows fallback when child has no summary', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('No summary yet');
    });

    it('includes child status', () => {
      const child = sessions.create(projectId, 'Child Session', 'Child prompt', 'standard');
      sessions.update(child.id, { parentSessionId, status: 'running' });

      const result = buildChildSessionContext(parentSessionId);
      expect(result).toContain('(running)');
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
