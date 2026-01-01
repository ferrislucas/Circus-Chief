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

  describe('End-of-turn work log association', () => {
    // These tests document the expected behavior where work logs are:
    // 1. Created as unassociated during the turn (shown in LiveWorkLogPanel)
    // 2. Associated with the message at the END of the turn (moved to WorkLogPanel)

    it('work logs created with null messageId are unassociated', () => {
      // During a turn, work logs are created without a messageId
      workLogs.create(session.id, 'thinking', 'First thought', null);
      workLogs.create(session.id, 'tool_input', '{"command": "ls"}', null, 'Bash');
      workLogs.create(session.id, 'tool_output', 'file1.txt\nfile2.txt', null, 'Bash');

      const grouped = workLogs.getBySessionIdGrouped(session.id);

      // All logs should be in _unassociated
      expect(grouped['_unassociated']).toBeDefined();
      expect(grouped['_unassociated'].length).toBe(3);
    });

    it('unassociated logs remain visible until associated', () => {
      // Create unassociated logs (simulating work during turn)
      workLogs.create(session.id, 'thinking', 'Analyzing request');
      workLogs.create(session.id, 'tool_input', 'Some tool input');

      // Before association, logs should be in _unassociated
      let grouped = workLogs.getBySessionIdGrouped(session.id);
      expect(grouped['_unassociated'].length).toBe(2);

      // Create a message (this happens during the turn)
      const message = messages.create(session.id, 'assistant', 'Response');

      // Logs are STILL unassociated (association happens at end of turn)
      grouped = workLogs.getBySessionIdGrouped(session.id);
      expect(grouped['_unassociated'].length).toBe(2);
      expect(grouped[message.id]).toBeUndefined();

      // Now associate logs (this happens at end of turn)
      const count = workLogs.associatePendingLogs(session.id, message.id);
      expect(count).toBe(2);

      // After association, logs move to the message
      grouped = workLogs.getBySessionIdGrouped(session.id);
      expect(grouped['_unassociated']).toBeUndefined();
      expect(grouped[message.id].length).toBe(2);
    });

    it('multiple logs can be associated in a single call', () => {
      // Simulate a full turn with multiple work log entries
      workLogs.create(session.id, 'thinking', 'Let me analyze this');
      workLogs.create(session.id, 'tool_input', '{"pattern": "*.js"}', null, 'Glob');
      workLogs.create(session.id, 'tool_output', 'src/index.js\nsrc/app.js', null, 'Glob');
      workLogs.create(session.id, 'thinking', 'Found the files, now reading');
      workLogs.create(session.id, 'tool_input', '{"path": "src/index.js"}', null, 'Read');
      workLogs.create(session.id, 'tool_output', 'console.log("Hello");', null, 'Read');

      const message = messages.create(session.id, 'assistant', 'I found 2 JS files.');

      // All 6 logs should be associated
      const count = workLogs.associatePendingLogs(session.id, message.id);
      expect(count).toBe(6);

      const grouped = workLogs.getBySessionIdGrouped(session.id);
      expect(grouped[message.id].length).toBe(6);
    });

    it('returns 0 when no logs to associate', () => {
      const message = messages.create(session.id, 'assistant', 'Quick response');

      // No unassociated logs exist
      const count = workLogs.associatePendingLogs(session.id, message.id);
      expect(count).toBe(0);
    });

    it('only associates logs for the correct session', () => {
      // Create a second session
      const session2 = sessions.create(project.id, 'Session 2', 'Prompt 2', 'standard');

      // Create logs in both sessions
      workLogs.create(session.id, 'thinking', 'Session 1 thought');
      workLogs.create(session2.id, 'thinking', 'Session 2 thought');

      const message = messages.create(session.id, 'assistant', 'Response');

      // Associate only session 1 logs
      const count = workLogs.associatePendingLogs(session.id, message.id);
      expect(count).toBe(1);

      // Session 2 logs should still be unassociated
      const grouped2 = workLogs.getBySessionIdGrouped(session2.id);
      expect(grouped2['_unassociated'].length).toBe(1);
    });
  });

  describe('Multi-message turn work log association', () => {
    // These tests document the fix for the bug where all work logs were
    // associated with the LAST message of a turn instead of being distributed
    // across multiple messages. The fix associates logs immediately when
    // each message is created.

    it('associates work logs with each message as they are created', () => {
      // Simulate: think -> message1 -> think -> tool -> message2

      // First batch of work (before message 1)
      workLogs.create(session.id, 'thinking', 'Analyzing the request');

      // Message 1 is created - associate pending logs
      const message1 = messages.create(session.id, 'assistant', 'Let me check that for you.');
      const count1 = workLogs.associatePendingLogs(session.id, message1.id);
      expect(count1).toBe(1);

      // Second batch of work (before message 2)
      workLogs.create(session.id, 'thinking', 'Now I need to run a command');
      workLogs.create(session.id, 'tool_input', '{"command": "ls"}', null, 'Bash');
      workLogs.create(session.id, 'tool_output', 'file1.txt', null, 'Bash');

      // Message 2 is created - associate pending logs
      const message2 = messages.create(session.id, 'assistant', 'Here are the files I found.');
      const count2 = workLogs.associatePendingLogs(session.id, message2.id);
      expect(count2).toBe(3);

      // Verify logs are correctly distributed
      const grouped = workLogs.getBySessionIdGrouped(session.id);

      expect(grouped[message1.id]).toBeDefined();
      expect(grouped[message1.id].length).toBe(1);
      expect(grouped[message1.id][0].content).toBe('Analyzing the request');

      expect(grouped[message2.id]).toBeDefined();
      expect(grouped[message2.id].length).toBe(3);
      expect(grouped[message2.id][0].content).toBe('Now I need to run a command');

      // No unassociated logs remain
      expect(grouped['_unassociated']).toBeUndefined();
    });

    it('handles three messages in a turn correctly', () => {
      // Simulate a complex turn with 3 messages

      // Work before message 1
      workLogs.create(session.id, 'thinking', 'Step 1 thinking');
      const msg1 = messages.create(session.id, 'assistant', 'First, let me...');
      workLogs.associatePendingLogs(session.id, msg1.id);

      // Work before message 2
      workLogs.create(session.id, 'tool_input', 'tool1 input', null, 'Read');
      workLogs.create(session.id, 'tool_output', 'tool1 output', null, 'Read');
      const msg2 = messages.create(session.id, 'assistant', 'I found...');
      workLogs.associatePendingLogs(session.id, msg2.id);

      // Work before message 3
      workLogs.create(session.id, 'thinking', 'Final analysis');
      workLogs.create(session.id, 'tool_input', 'tool2 input', null, 'Write');
      workLogs.create(session.id, 'tool_output', 'tool2 output', null, 'Write');
      const msg3 = messages.create(session.id, 'assistant', 'Done! Here is the result.');
      workLogs.associatePendingLogs(session.id, msg3.id);

      // Verify distribution
      const grouped = workLogs.getBySessionIdGrouped(session.id);

      expect(grouped[msg1.id].length).toBe(1);
      expect(grouped[msg2.id].length).toBe(2);
      expect(grouped[msg3.id].length).toBe(3);
      expect(grouped['_unassociated']).toBeUndefined();
    });

    it('handles message with no preceding work logs', () => {
      // First message has work logs
      workLogs.create(session.id, 'thinking', 'Initial thought');
      const msg1 = messages.create(session.id, 'assistant', 'Let me help.');
      workLogs.associatePendingLogs(session.id, msg1.id);

      // Second message has NO work logs before it (quick follow-up)
      const msg2 = messages.create(session.id, 'assistant', 'Actually, one more thing...');
      const count = workLogs.associatePendingLogs(session.id, msg2.id);
      expect(count).toBe(0);

      // Verify
      const grouped = workLogs.getBySessionIdGrouped(session.id);
      expect(grouped[msg1.id].length).toBe(1);
      expect(grouped[msg2.id]).toBeUndefined(); // No logs for this message
    });

    it('handles trailing work logs after the last message', () => {
      // Message 1 with its logs
      workLogs.create(session.id, 'thinking', 'Initial thought');
      const msg1 = messages.create(session.id, 'assistant', 'First response.');
      workLogs.associatePendingLogs(session.id, msg1.id);

      // Trailing work logs (created after the last text message)
      // This can happen when tool execution happens after the text
      workLogs.create(session.id, 'tool_input', 'trailing tool', null, 'Bash');
      workLogs.create(session.id, 'tool_output', 'trailing output', null, 'Bash');

      // End of turn - associate trailing logs with last message
      const trailingCount = workLogs.associatePendingLogs(session.id, msg1.id);
      expect(trailingCount).toBe(2);

      // Verify all logs are now with message 1
      const grouped = workLogs.getBySessionIdGrouped(session.id);
      expect(grouped[msg1.id].length).toBe(3); // 1 initial + 2 trailing
      expect(grouped['_unassociated']).toBeUndefined();
    });

    it('preserves work log order within each message', () => {
      // Create logs in specific order
      workLogs.create(session.id, 'thinking', 'Think A');
      workLogs.create(session.id, 'tool_input', 'Input B', null, 'Bash');
      workLogs.create(session.id, 'tool_output', 'Output C', null, 'Bash');

      const msg = messages.create(session.id, 'assistant', 'Response');
      workLogs.associatePendingLogs(session.id, msg.id);

      const grouped = workLogs.getBySessionIdGrouped(session.id);
      const logs = grouped[msg.id];

      // Logs should be in timestamp order (which is creation order)
      expect(logs[0].content).toBe('Think A');
      expect(logs[1].content).toBe('Input B');
      expect(logs[2].content).toBe('Output C');
    });

    it('correctly separates logs between two sessions running simultaneously', () => {
      // Create second session
      const session2 = sessions.create(project.id, 'Session 2', 'Prompt 2', 'standard');

      // Interleaved work logs from both sessions
      workLogs.create(session.id, 'thinking', 'Session 1 thought');
      workLogs.create(session2.id, 'thinking', 'Session 2 thought');
      workLogs.create(session.id, 'tool_input', 'Session 1 tool', null, 'Bash');
      workLogs.create(session2.id, 'tool_input', 'Session 2 tool', null, 'Bash');

      // Each session creates a message and associates
      const msg1 = messages.create(session.id, 'assistant', 'Session 1 response');
      const msg2 = messages.create(session2.id, 'assistant', 'Session 2 response');

      workLogs.associatePendingLogs(session.id, msg1.id);
      workLogs.associatePendingLogs(session2.id, msg2.id);

      // Verify each session has its own logs
      const grouped1 = workLogs.getBySessionIdGrouped(session.id);
      const grouped2 = workLogs.getBySessionIdGrouped(session2.id);

      expect(grouped1[msg1.id].length).toBe(2);
      expect(grouped1[msg1.id][0].content).toBe('Session 1 thought');
      expect(grouped1[msg1.id][1].content).toBe('Session 1 tool');

      expect(grouped2[msg2.id].length).toBe(2);
      expect(grouped2[msg2.id][0].content).toBe('Session 2 thought');
      expect(grouped2[msg2.id][1].content).toBe('Session 2 tool');
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
      const validStatuses = ['starting', 'running', 'waiting', 'error', 'stopped'];

      for (const status of validStatuses) {
        sessions.update(session.id, { status });
        const updated = sessions.getById(session.id);
        expect(updated.status).toBe(status);
      }
    });
  });
});
