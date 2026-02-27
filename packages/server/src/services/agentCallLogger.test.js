import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentCallLogger } from './agentCallLogger.js';

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'mock-call-id-' + Math.random().toString(36).slice(2, 8)),
}));

// Mock the database module
vi.mock('../database.js', () => ({
  agentCallLogs: {
    create: vi.fn(),
    updateUsage: vi.fn(),
    complete: vi.fn(),
    getSessionStats: vi.fn(() => [{ call_type: 'runSession', call_count: 1 }]),
    getGlobalStats: vi.fn(() => []),
  },
}));

import { agentCallLogs } from '../database.js';

describe('AgentCallLogger', () => {
  let logger;

  beforeEach(() => {
    logger = new AgentCallLogger();
    vi.clearAllMocks();
  });

  describe('startCall', () => {
    it('creates a log entry and returns callId', () => {
      const meta = {
        sessionId: 'session-1',
        conversationId: 'conv-1',
        callType: 'runSession',
        agentType: 'claude-code',
        model: 'claude-sonnet-4-20250514',
        promptLength: 500,
      };

      const callId = logger.startCall(meta);

      expect(callId).toBeTruthy();
      expect(agentCallLogs.create).toHaveBeenCalledWith({
        id: callId,
        sessionId: 'session-1',
        conversationId: 'conv-1',
        agentType: 'claude-code',
        model: 'claude-sonnet-4-20250514',
        callType: 'runSession',
        promptLength: 500,
      });
      expect(logger.activeCalls.has(callId)).toBe(true);
    });

    it('defaults agentType to claude-code when not provided', () => {
      const meta = {
        sessionId: 'session-1',
        callType: 'runSession',
        promptLength: 100,
      };

      logger.startCall(meta);

      expect(agentCallLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ agentType: 'claude-code' })
      );
    });
  });

  describe('updateUsage', () => {
    it('persists token updates for active calls', () => {
      const callId = logger.startCall({
        sessionId: 'session-1',
        callType: 'runSession',
        promptLength: 100,
      });

      logger.updateUsage(callId, {
        inputTokens: 1000,
        outputTokens: 500,
        thinkingTokens: 200,
        cacheReadInputTokens: 300,
        cacheCreationInputTokens: 100,
      });

      expect(agentCallLogs.updateUsage).toHaveBeenCalledWith(callId, {
        inputTokens: 1000,
        outputTokens: 500,
        thinkingTokens: 200,
        cacheReadTokens: 300,
        cacheWriteTokens: 100,
      });
    });

    it('is a no-op for unknown callId', () => {
      logger.updateUsage('unknown-call', { inputTokens: 1000 });
      expect(agentCallLogs.updateUsage).not.toHaveBeenCalled();
    });
  });

  describe('completeCall', () => {
    it('with success persists final state and removes from activeCalls', () => {
      const callId = logger.startCall({
        sessionId: 'session-1',
        callType: 'runSession',
        promptLength: 100,
      });

      logger.completeCall(callId, {
        success: true,
        usage: {
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadInputTokens: 300,
          cacheCreationInputTokens: 100,
        },
      });

      expect(agentCallLogs.complete).toHaveBeenCalledWith(callId, {
        success: true,
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 300,
        cacheWriteTokens: 100,
        errorMessage: undefined,
      });
      expect(logger.activeCalls.has(callId)).toBe(false);
    });

    it('with error persists error_message', () => {
      const callId = logger.startCall({
        sessionId: 'session-1',
        callType: 'runSession',
        promptLength: 100,
      });

      const error = new Error('Connection timeout');
      logger.completeCall(callId, { success: false, error });

      expect(agentCallLogs.complete).toHaveBeenCalledWith(callId, {
        success: false,
        inputTokens: undefined,
        outputTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
        errorMessage: 'Connection timeout',
      });
      expect(logger.activeCalls.has(callId)).toBe(false);
    });
  });

  describe('getSessionStats', () => {
    it('delegates to repository correctly', () => {
      const result = logger.getSessionStats('session-1');
      expect(agentCallLogs.getSessionStats).toHaveBeenCalledWith('session-1');
      expect(result).toEqual([{ call_type: 'runSession', call_count: 1 }]);
    });
  });

  describe('getGlobalStats', () => {
    it('delegates to repository correctly', () => {
      logger.getGlobalStats(1000, 2000);
      expect(agentCallLogs.getGlobalStats).toHaveBeenCalledWith(1000, 2000);
    });
  });
});
