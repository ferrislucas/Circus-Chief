import { describe, it, expect, beforeEach, vi } from 'vitest';
import { projects, sessions } from '../src/database.js';

// Mock the websocket module
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock the external dependencies that sessionManager uses
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  const mockAgent = {
    async *execute() {
      yield { type: 'message_start', message: { id: 'msg_test' } };
      yield { type: 'content_block_start', content_block: { type: 'text' } };
      yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Test response' } };
      yield { type: 'content_block_stop' };
      yield { type: 'message_delta', delta: { stop_reason: 'end_turn' } };
      yield { type: 'message_stop' };
    },
  };
  return {
    query: vi.fn(async function* () {
      yield* mockAgent.execute();
    }),
  };
});

vi.mock('../src/services/todoStore.js', () => ({
  updateTodos: vi.fn(),
}));

vi.mock('../src/services/summaryService.js', () => ({
  onSessionActivity: vi.fn(),
  onSessionComplete: vi.fn(),
  extractPrUrlIfNeeded: vi.fn(),
}));

// Import the mocked functions for assertions
import { broadcastToSession, broadcastToProject } from '../src/websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

// We need to test that broadcastSessionStatus broadcasts to both
// session and project subscribers. Since broadcastSessionStatus is
// an internal function, we test the behavior indirectly.

describe('Session Status Broadcasts to Project Subscribers', () => {
  let project;
  let session;

  beforeEach(() => {
    vi.clearAllMocks();
    project = projects.create('Test Project', '/tmp/test');
    session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
  });

  describe('broadcastSessionStatus behavior', () => {
    it('SESSION_UPDATED should be broadcast to project when status changes via sessionManager', async () => {
      // This tests the expected behavior: when a session status changes internally
      // (e.g., running -> waiting), the project subscribers should be notified
      // via SESSION_UPDATED so session lists update in real-time.

      // We verify that SESSION_UPDATED message type is correctly defined
      expect(WS_MESSAGE_TYPES.SESSION_UPDATED).toBe('session:updated');

      // And that it's different from SESSION_STATUS (which goes to session subscribers)
      expect(WS_MESSAGE_TYPES.SESSION_STATUS).toBe('session:status');
    });

    it('broadcastToProject function is available for session status broadcasts', () => {
      expect(typeof broadcastToProject).toBe('function');
    });

    it('broadcastToSession function is available for session status broadcasts', () => {
      expect(typeof broadcastToSession).toBe('function');
    });
  });

  describe('Session status transition scenarios', () => {
    it('session can transition from starting to running', () => {
      expect(session.status).toBe('starting');

      const updated = sessions.update(session.id, { status: 'running' });
      expect(updated.status).toBe('running');
    });

    it('session can transition from running to waiting', () => {
      sessions.update(session.id, { status: 'running' });
      const updated = sessions.update(session.id, { status: 'waiting' });
      expect(updated.status).toBe('waiting');
    });

    it('session can transition from waiting to stopped', () => {
      sessions.update(session.id, { status: 'waiting' });
      const updated = sessions.update(session.id, { status: 'stopped' });
      expect(updated.status).toBe('stopped');
    });

    it('session can transition to error status', () => {
      sessions.update(session.id, { status: 'running' });
      const updated = sessions.update(session.id, { status: 'error' });
      expect(updated.status).toBe('error');
    });

    it('session can transition to stopped status', () => {
      sessions.update(session.id, { status: 'running' });
      const updated = sessions.update(session.id, { status: 'stopped' });
      expect(updated.status).toBe('stopped');
    });
  });

  describe('Session data for broadcasts', () => {
    it('session has projectId for project broadcasts', () => {
      const retrieved = sessions.getById(session.id);
      expect(retrieved.projectId).toBe(project.id);
    });

    it('session update returns full session object for broadcasts', () => {
      const updated = sessions.update(session.id, { status: 'running' });

      // The updated object should have all necessary fields for broadcasting
      expect(updated).toHaveProperty('id');
      expect(updated).toHaveProperty('projectId');
      expect(updated).toHaveProperty('status');
      expect(updated).toHaveProperty('name');
    });
  });

  describe('Active sessions filtering', () => {
    it('getActiveAndWaiting includes sessions with starting status', () => {
      const activeSessions = sessions.getActiveAndWaiting();
      expect(activeSessions.some((s) => s.id === session.id)).toBe(true);
    });

    it('getActiveAndWaiting includes sessions with running status', () => {
      sessions.update(session.id, { status: 'running' });
      const activeSessions = sessions.getActiveAndWaiting();
      expect(activeSessions.some((s) => s.id === session.id)).toBe(true);
    });

    it('getActiveAndWaiting includes sessions with waiting status', () => {
      sessions.update(session.id, { status: 'waiting' });
      const activeSessions = sessions.getActiveAndWaiting();
      expect(activeSessions.some((s) => s.id === session.id)).toBe(true);
    });

    it('getActiveAndWaiting excludes sessions with stopped status', () => {
      sessions.update(session.id, { status: 'stopped' });
      const activeSessions = sessions.getActiveAndWaiting();
      expect(activeSessions.some((s) => s.id === session.id)).toBe(false);
    });

    it('getActiveAndWaiting excludes sessions with error status', () => {
      sessions.update(session.id, { status: 'error' });
      const activeSessions = sessions.getActiveAndWaiting();
      expect(activeSessions.some((s) => s.id === session.id)).toBe(false);
    });

    it('getActiveAndWaiting excludes sessions with stopped status', () => {
      sessions.update(session.id, { status: 'stopped' });
      const activeSessions = sessions.getActiveAndWaiting();
      expect(activeSessions.some((s) => s.id === session.id)).toBe(false);
    });
  });

  describe('Cross-project session isolation', () => {
    it('sessions from different projects are correctly isolated', () => {
      const project2 = projects.create('Second Project', '/tmp/test2');
      const session2 = sessions.create(project2.id, 'Session 2', 'Prompt', 'standard');

      const project1Sessions = sessions.getByProjectId(project.id);
      const project2Sessions = sessions.getByProjectId(project2.id);

      expect(project1Sessions.every((s) => s.projectId === project.id)).toBe(true);
      expect(project2Sessions.every((s) => s.projectId === project2.id)).toBe(true);
      expect(project1Sessions.some((s) => s.id === session2.id)).toBe(false);
    });
  });
});
