import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, messages, workLogs } from '../src/database.js';

// Mock the websocket module
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
}));

describe('Work Logs API', () => {
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
  });

  describe('WorkLogRepository', () => {
    it('creates a work log entry', () => {
      const log = workLogs.create(session.id, 'thinking', 'Test thinking content');

      expect(log).toBeDefined();
      expect(log.sessionId).toBe(session.id);
      expect(log.type).toBe('thinking');
      expect(log.content).toBe('Test thinking content');
      expect(log.messageId).toBeNull();
    });

    it('creates a work log with tool name', () => {
      const log = workLogs.create(session.id, 'tool_input', '{"command": "ls"}', null, 'Bash');

      expect(log.toolName).toBe('Bash');
      expect(log.type).toBe('tool_input');
    });

    it('creates a work log associated with a message', () => {
      const message = messages.create(session.id, 'assistant', 'Test response');
      const log = workLogs.create(session.id, 'thinking', 'Test content', message.id);

      expect(log.messageId).toBe(message.id);
    });

    it('gets work logs by session ID', () => {
      workLogs.create(session.id, 'thinking', 'First thought');
      workLogs.create(session.id, 'tool_input', 'Tool input');
      workLogs.create(session.id, 'tool_output', 'Tool output');

      const logs = workLogs.getBySessionId(session.id);

      expect(logs.length).toBe(3);
      expect(logs[0].type).toBe('thinking');
      expect(logs[1].type).toBe('tool_input');
      expect(logs[2].type).toBe('tool_output');
    });

    it('gets work logs grouped by message ID', () => {
      const message = messages.create(session.id, 'assistant', 'Test response');

      // Create unassociated logs
      workLogs.create(session.id, 'thinking', 'Unassociated thought');

      // Create associated logs
      workLogs.create(session.id, 'tool_input', 'Associated input', message.id);
      workLogs.create(session.id, 'tool_output', 'Associated output', message.id);

      const grouped = workLogs.getBySessionIdGrouped(session.id);

      expect(grouped['_unassociated']).toBeDefined();
      expect(grouped['_unassociated'].length).toBe(1);
      expect(grouped[message.id]).toBeDefined();
      expect(grouped[message.id].length).toBe(2);
    });

    it('associates pending logs with a message', () => {
      // Create unassociated logs first
      workLogs.create(session.id, 'thinking', 'First thought');
      workLogs.create(session.id, 'tool_input', 'Tool input');

      // Create a message
      const message = messages.create(session.id, 'assistant', 'Test response');

      // Associate pending logs
      const count = workLogs.associatePendingLogs(session.id, message.id);

      expect(count).toBe(2);

      // Verify logs are now associated
      const grouped = workLogs.getBySessionIdGrouped(session.id);
      expect(grouped['_unassociated']).toBeUndefined();
      expect(grouped[message.id].length).toBe(2);
    });

    it('returns correct count when associating logs', () => {
      // This test verifies the fix for the bug where associatePendingLogs
      // wasn't returning the count, causing work logs to not appear in UI

      // Create some unassociated logs
      workLogs.create(session.id, 'thinking', 'Thought 1');
      workLogs.create(session.id, 'thinking', 'Thought 2');
      workLogs.create(session.id, 'thinking', 'Thought 3');

      const message = messages.create(session.id, 'assistant', 'Response');

      // The fix ensures this returns the actual count
      const associatedCount = workLogs.associatePendingLogs(session.id, message.id);

      expect(associatedCount).toBe(3);
      expect(typeof associatedCount).toBe('number');
    });

    it('gets work logs by message ID', () => {
      const message = messages.create(session.id, 'assistant', 'Test response');

      workLogs.create(session.id, 'thinking', 'Test content', message.id);
      workLogs.create(session.id, 'tool_input', 'More content', message.id);

      const logs = workLogs.getByMessageId(message.id);

      expect(logs.length).toBe(2);
    });

    it('deletes work logs when session is deleted', () => {
      workLogs.create(session.id, 'thinking', 'Test content');
      workLogs.create(session.id, 'tool_input', 'More content');

      // Verify logs exist
      expect(workLogs.getBySessionId(session.id).length).toBe(2);

      // Delete session (cascade should remove work logs)
      sessions.delete(session.id);

      // Verify logs are gone
      expect(workLogs.getBySessionId(session.id).length).toBe(0);
    });
  });

  describe('Session status update for polling', () => {
    it('can update session status', () => {
      // This tests that status can be updated, which is needed for the
      // polling mechanism to work correctly

      expect(session.status).toBe('starting');

      sessions.update(session.id, { status: 'running' });
      const updated = sessions.getById(session.id);

      expect(updated.status).toBe('running');
    });

    it('supports all valid statuses', () => {
      const validStatuses = ['starting', 'running', 'waiting', 'completed', 'error', 'stopped'];

      for (const status of validStatuses) {
        sessions.update(session.id, { status });
        const updated = sessions.getById(session.id);
        expect(updated.status).toBe(status);
      }
    });
  });
});
