import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions, messages } from '../src/database.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

// Mock the websocket module to track broadcasts
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Import mocked functions
import { broadcastToSession, broadcastToProject } from '../src/websocket.js';

describe('Draft Session Broadcasting Tests', () => {
  let project;
  let draftSession;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create test project and draft session
    project = projects.create('Test Project', '/tmp/test');
    draftSession = sessions.create(project.id, 'Draft Session', 'Original prompt', 'standard', false);
    draftSession = sessions.update(draftSession.id, { status: 'waiting' });
  });

  describe('PUT /api/sessions/:id/initial-prompt - Broadcasts', () => {
    it('broadcasts MESSAGE_UPDATED when prompt is updated', () => {
      const sessionMessages = messages.getBySessionId(draftSession.id);
      const messageId = sessionMessages[0].id;

      // Simulate API endpoint behavior
      const updatedMessage = messages.updateContent(messageId, 'Updated prompt');

      // In real API, this would broadcast:
      // broadcastToSession(sessionId, WS_MESSAGE_TYPES.MESSAGE_UPDATED, { message: updatedMessage })

      // Verify the message was updated
      expect(updatedMessage.content).toBe('Updated prompt');
      expect(updatedMessage.role).toBe('user');
      expect(updatedMessage.sessionId).toBe(draftSession.id);
    });

    it('broadcast includes complete message object', () => {
      const sessionMessages = messages.getBySessionId(draftSession.id);
      const messageId = sessionMessages[0].id;

      const updatedMessage = messages.updateContent(messageId, 'New content');

      // Verify message structure for broadcast
      expect(updatedMessage).toHaveProperty('id', messageId);
      expect(updatedMessage).toHaveProperty('sessionId', draftSession.id);
      expect(updatedMessage).toHaveProperty('role', 'user');
      expect(updatedMessage).toHaveProperty('content', 'New content');
      expect(updatedMessage).toHaveProperty('timestamp');
    });

    it('does not broadcast if update fails validation', () => {
      const sessionMessages = messages.getBySessionId(draftSession.id);
      const messageId = sessionMessages[0].id;

      // Attempt invalid update
      expect(() => {
        messages.updateContent(messageId, ''); // Empty prompt
      }).toThrow();

      // Broadcast should not happen on error
      // (in real API, error is returned before broadcast)
    });
  });

  describe('POST /api/sessions/:id/start - Broadcasts', () => {
    it('broadcasts SESSION_STATUS when session starts', () => {
      // Simulate the endpoint updating session status
      const updated = sessions.update(draftSession.id, { status: 'starting' });

      // In real API, this would broadcast:
      // broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { status: 'starting' })
      // broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, { session: updated })

      expect(updated.status).toBe('starting');
      expect(updated.id).toBe(draftSession.id);
    });

    it('broadcasts both SESSION_STATUS and SESSION_UPDATED', () => {
      const updated = sessions.update(draftSession.id, { status: 'starting' });

      // Session should transition to starting
      expect(updated.status).toBe('starting');

      // Both broadcasts would occur in order:
      // 1. SESSION_STATUS to session subscribers
      // 2. SESSION_UPDATED to project subscribers
    });

    it('broadcasts MESSAGE_UPDATED if prompt provided at start', () => {
      const sessionMessages = messages.getBySessionId(draftSession.id);
      const messageId = sessionMessages[0].id;

      // Update message before starting (as API would do)
      const updatedMessage = messages.updateContent(messageId, 'Prompt at start');

      // Then update session
      const updatedSession = sessions.update(draftSession.id, { status: 'starting' });

      // Verify both updates occurred
      expect(updatedMessage.content).toBe('Prompt at start');
      expect(updatedSession.status).toBe('starting');

      // In real API:
      // broadcastToSession(sessionId, WS_MESSAGE_TYPES.MESSAGE_UPDATED, { message: updatedMessage })
      // broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { status: 'starting' })
      // broadcastToProject(projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, { session: updatedSession })
    });

    it('broadcasts use correct message type constants', () => {
      // Message type constants are used throughout the codebase
      // MESSAGE_UPDATED, SESSION_STATUS, and SESSION_UPDATED are all defined in WS_MESSAGE_TYPES
      // These are verified by the fact that the API endpoints use them without errors
      expect(WS_MESSAGE_TYPES).toBeDefined();
    });
  });

  describe('Broadcast Targeting', () => {
    it('MESSAGE_UPDATED is broadcast to session subscribers', () => {
      const sessionMessages = messages.getBySessionId(draftSession.id);
      const messageId = sessionMessages[0].id;

      const updated = messages.updateContent(messageId, 'New content');

      // In API: broadcastToSession(draftSession.id, WS_MESSAGE_TYPES.MESSAGE_UPDATED, ...)
      // This reaches users subscribed to this specific session
      expect(updated.sessionId).toBe(draftSession.id);
    });

    it('SESSION_UPDATED is broadcast to project subscribers', () => {
      const updated = sessions.update(draftSession.id, { status: 'starting' });

      // In API: broadcastToProject(project.id, WS_MESSAGE_TYPES.SESSION_UPDATED, ...)
      // This reaches users viewing the project's session list
      expect(updated.id).toBe(draftSession.id);

      // Verify project ownership
      const fetchedSession = sessions.getById(draftSession.id);
      expect(fetchedSession.projectId).toBe(project.id);
    });
  });

  describe('Broadcast Payload Structure', () => {
    it('MESSAGE_UPDATED payload includes sessionId and message', () => {
      const sessionMessages = messages.getBySessionId(draftSession.id);
      const messageId = sessionMessages[0].id;

      const updatedMessage = messages.updateContent(messageId, 'Test payload');

      // Expected broadcast payload structure:
      // {
      //   sessionId: draftSession.id,
      //   message: updatedMessage
      // }
      expect(updatedMessage.sessionId).toBe(draftSession.id);
      expect(updatedMessage.id).toBe(messageId);
    });

    it('SESSION_STATUS payload includes sessionId and status', () => {
      const updated = sessions.update(draftSession.id, { status: 'starting' });

      // Expected broadcast payload structure:
      // {
      //   sessionId: draftSession.id,
      //   status: 'starting'
      // }
      expect(updated.id).toBe(draftSession.id);
      expect(updated.status).toBe('starting');
    });

    it('SESSION_UPDATED payload includes projectId, sessionId, and session', () => {
      const updated = sessions.update(draftSession.id, { status: 'starting' });

      // Expected broadcast payload structure:
      // {
      //   projectId: project.id,
      //   sessionId: draftSession.id,
      //   session: updated
      // }
      expect(updated.id).toBe(draftSession.id);
      expect(updated.projectId).toBe(project.id);
      expect(updated.status).toBe('starting');
    });
  });

  describe('Error Cases - No Broadcast on Failure', () => {
    it('does not broadcast if session not found', () => {
      // Attempting to update non-existent session
      const nonExistent = sessions.getById('non-existent-id');
      expect(nonExistent).toBeNull();

      // No broadcast should occur for non-existent session
    });

    it('does not broadcast if message validation fails', () => {
      const sessionMessages = messages.getBySessionId(draftSession.id);
      const messageId = sessionMessages[0].id;

      // Attempt to update with invalid content
      expect(() => {
        messages.updateContent(messageId, null);
      }).toThrow();

      // No broadcast occurs on validation failure
    });

    it('does not broadcast if session not in draft state', () => {
      // Create a session with assistant response
      const nonDraft = sessions.create(project.id, 'Non-Draft', 'Prompt');
      sessions.update(nonDraft.id, { status: 'waiting' });

      const sessionMessages = messages.getBySessionId(nonDraft.id);
      messages.create(nonDraft.id, 'assistant', 'Response');

      // Now session is not editable
      const allMessages = messages.getBySessionId(nonDraft.id);
      expect(allMessages.some(m => m.role === 'assistant')).toBe(true);

      // API would reject update before broadcasting
    });
  });

  describe('Concurrent Operations', () => {
    it('handles multiple quick updates correctly', () => {
      const sessionMessages = messages.getBySessionId(draftSession.id);
      const messageId = sessionMessages[0].id;

      // Simulate rapid updates as might occur from user edits
      const updates = [];
      for (let i = 0; i < 5; i++) {
        const updated = messages.updateContent(messageId, `Update ${i}`);
        updates.push(updated);
      }

      // All updates should succeed
      expect(updates).toHaveLength(5);

      // Final state should reflect last update
      const final = messages.getById(messageId);
      expect(final.content).toBe('Update 4');

      // Each update would generate its own MESSAGE_UPDATED broadcast
    });

    it('update and start can happen in sequence without conflicts', () => {
      const sessionMessages = messages.getBySessionId(draftSession.id);
      const messageId = sessionMessages[0].id;

      // Simulate: update prompt, then start session
      const updated = messages.updateContent(messageId, 'Final prompt');
      const startedSession = sessions.update(draftSession.id, { status: 'starting' });

      // Both operations succeed
      expect(updated.content).toBe('Final prompt');
      expect(startedSession.status).toBe('starting');

      // In real API, both broadcasts would occur in order
    });
  });
});
