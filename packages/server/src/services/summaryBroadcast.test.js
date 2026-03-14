import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the websocket module
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

import { broadcastSummaryUpdate, broadcastGeneratingStatus, broadcastConversationSummaryUpdate, broadcastSessionUpdate } from './summaryBroadcast.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';

describe('summaryBroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('broadcastSummaryUpdate', () => {
    it('broadcasts summary update to session subscribers', () => {
      const summary = { shortSummary: 'Test', outcome: 'ongoing' };
      broadcastSummaryUpdate('sess-1', null, summary);

      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        'session:summary_updated',
        { sessionId: 'sess-1', summary }
      );
    });

    it('broadcasts summary update to project subscribers when projectId provided', () => {
      const summary = { shortSummary: 'Test', outcome: 'ongoing' };
      broadcastSummaryUpdate('sess-1', 'proj-1', summary);

      expect(broadcastToProject).toHaveBeenCalledWith(
        'proj-1',
        'session:summary_updated',
        { projectId: 'proj-1', sessionId: 'sess-1', summary }
      );
    });

    it('does not broadcast to project when projectId is null', () => {
      broadcastSummaryUpdate('sess-1', null, {});
      expect(broadcastToProject).not.toHaveBeenCalled();
    });
  });

  describe('broadcastGeneratingStatus', () => {
    it('broadcasts generating: true', () => {
      broadcastGeneratingStatus('sess-1', true);

      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        'session:summary_generating',
        { sessionId: 'sess-1', generating: true }
      );
    });

    it('broadcasts generating: false', () => {
      broadcastGeneratingStatus('sess-1', false);

      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        'session:summary_generating',
        { sessionId: 'sess-1', generating: false }
      );
    });
  });

  describe('broadcastConversationSummaryUpdate', () => {
    it('broadcasts with correct message type and data', () => {
      const data = { conversationId: 'conv-1', conversation: { id: 'conv-1', summary: 'Test' } };
      broadcastConversationSummaryUpdate('sess-1', data);

      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        'conversation:summary_updated',
        { sessionId: 'sess-1', conversationId: 'conv-1', conversation: { id: 'conv-1', summary: 'Test' } }
      );
    });

    it('calls broadcastToSession with expected arguments', () => {
      const data = { conversationId: 'conv-2', summary: 'Another test' };
      broadcastConversationSummaryUpdate('sess-2', data);

      expect(broadcastToSession).toHaveBeenCalledTimes(1);
      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-2',
        'conversation:summary_updated',
        expect.objectContaining({ sessionId: 'sess-2', conversationId: 'conv-2' })
      );
    });
  });

  describe('broadcastSessionUpdate', () => {
    it('broadcasts session update to session subscribers', () => {
      const session = { id: 'sess-1', name: 'Test Session' };
      broadcastSessionUpdate('sess-1', null, session);

      expect(broadcastToSession).toHaveBeenCalledWith(
        'sess-1',
        'session:updated',
        { sessionId: 'sess-1', session }
      );
    });

    it('broadcasts session update to project subscribers when projectId provided', () => {
      const session = { id: 'sess-1', name: 'Test Session' };
      broadcastSessionUpdate('sess-1', 'proj-1', session);

      expect(broadcastToProject).toHaveBeenCalledWith(
        'proj-1',
        'session:updated',
        { projectId: 'proj-1', sessionId: 'sess-1', session }
      );
    });

    it('does not broadcast to project when projectId is null', () => {
      broadcastSessionUpdate('sess-1', null, {});
      expect(broadcastToProject).not.toHaveBeenCalled();
    });
  });
});
