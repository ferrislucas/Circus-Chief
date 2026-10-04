import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
    update: vi.fn(),
    touch: vi.fn(),
  },
  messages: {
    getByConversationId: vi.fn(),
    create: vi.fn(),
  },
  conversations: {
    ensureActiveConversation: vi.fn(),
  },
}));

vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
}));

vi.mock('./summaryService.js', () => ({
  onSessionComplete: vi.fn(),
  extractPrUrlIfNeeded: vi.fn(),
}));

vi.mock('./streamUsageHandler.js', () => ({
  handleResultUsage: vi.fn(),
}));

import { sessions, messages } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { handleStreamResultEvent } from './streamErrorHandler.js';
import { normalizeFinalErrorMessage } from './visibleFinalErrorMessage.js';

const SENTINEL = 'sentinel-9c2e-session-error-secret';

function credentialBearingError() {
  return new Error(`GET https://example/v1/models/m:generateContent?key=${SENTINEL} failed`);
}

describe('normalizeFinalErrorMessage', () => {
  it('redacts credentials from provider error text', () => {
    expect(normalizeFinalErrorMessage(credentialBearingError())).not.toContain(SENTINEL);
  });

  it('leaves ordinary error text untouched', () => {
    expect(normalizeFinalErrorMessage(new Error('Overloaded, please retry later'))).toBe(
      'Overloaded, please retry later'
    );
  });
});

describe('handleStreamResultEvent (error subtype)', () => {
  const finalResultEvents = new Map();
  const finalErrorSessionIds = new Set();
  const activeConversationIds = new Map();

  beforeEach(() => {
    vi.clearAllMocks();
    finalResultEvents.clear();
    finalErrorSessionIds.clear();
    activeConversationIds.clear();
    activeConversationIds.set('session-1', 'conversation-1');
    sessions.getById.mockReturnValue({ id: 'session-1', agentType: 'claude-code' });
    messages.getByConversationId.mockReturnValue([]);
    messages.create.mockImplementation((sessionId, role, content, opts) => ({
      id: 'message-1',
      sessionId,
      role,
      content,
      conversationId: opts?.conversationId,
    }));
  });

  it('never persists or broadcasts credential-bearing provider error text', () => {
    handleStreamResultEvent(
      'session-1',
      { subtype: 'error', is_error: true, error: credentialBearingError() },
      {
        finalResultEvents,
        finalErrorSessionIds,
        activeConversationIds,
        broadcastSessionStatus: vi.fn(),
      }
    );

    const persistedError = sessions.update.mock.calls[0][1].error;
    expect(persistedError).not.toContain(SENTINEL);

    const sessionErrorCall = broadcastToSession.mock.calls.find(
      ([, type]) => type === WS_MESSAGE_TYPES.SESSION_ERROR
    );
    expect(sessionErrorCall).toBeDefined();
    expect(JSON.stringify(sessionErrorCall[2])).not.toContain(SENTINEL);

    const visibleMessage = messages.create.mock.calls[0][2];
    expect(visibleMessage).not.toContain(SENTINEL);
  });
});
