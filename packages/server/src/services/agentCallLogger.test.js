import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AgentCallLogger } from './agentCallLogger.js';

// Mock nanoid
vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => `mock-call-id-${  Math.random().toString(36).slice(2, 8)}`),
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
      // Updated expectation - agentCallLogger always passes metadata object (may be empty)
      expect(agentCallLogs.create).toHaveBeenCalledWith({
        id: callId,
        sessionId: 'session-1',
        conversationId: 'conv-1',
        agentType: 'claude-code',
        model: 'claude-sonnet-4-20250514',
        callType: 'runSession',
        promptLength: 500,
        metadata: {}, // No effortLevel or thinkingEnabled in meta
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

  describe('startCall with metadata', () => {
    it('includes effortLevel in metadata when provided', () => {
      const meta = {
        sessionId: 'session-1',
        callType: 'runSession',
        promptLength: 100,
        effortLevel: 'high',
      };

      logger.startCall(meta);

      expect(agentCallLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { effortLevel: 'high' },
        })
      );
    });

    it('includes thinkingEnabled in metadata when provided', () => {
      const meta = {
        sessionId: 'session-1',
        callType: 'runSession',
        promptLength: 100,
        thinkingEnabled: true,
      };

      logger.startCall(meta);

      expect(agentCallLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { thinkingEnabled: true },
        })
      );
    });

    it('includes both effortLevel and thinkingEnabled in metadata when both provided', () => {
      const meta = {
        sessionId: 'session-1',
        callType: 'runSession',
        promptLength: 100,
        effortLevel: 'max',
        thinkingEnabled: true,
      };

      logger.startCall(meta);

      expect(agentCallLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { effortLevel: 'max', thinkingEnabled: true },
        })
      );
    });

    it('passes empty metadata object when no effortLevel or thinkingEnabled', () => {
      const meta = {
        sessionId: 'session-1',
        callType: 'runSession',
        promptLength: 100,
      };

      logger.startCall(meta);

      expect(agentCallLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {},
        })
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

  // ── _logFailoverEvent (Issue 4) ────────────────────────────────────────
  //
  // A failover that successfully advances to another tier member is a
  // benign system event, not a call failure — and the entry must reflect
  // the *source* (failing) member's agent type rather than assuming
  // 'claude-code'.

  describe('_logFailoverEvent', () => {
    it('uses the passed agentType instead of hardcoding claude-code', () => {
      logger._logFailoverEvent('session-1', {
        fromModel: 'gpt-5-codex',
        fromProviderId: 'provider-codex',
        toModel: 'claude-sonnet-4-20250514',
        toProviderId: 'provider-claude',
        tierRef: 'tier::abc',
        tierName: 'My Tier',
        reason: 'rate limit reached',
        agentType: 'codex',
      });

      expect(agentCallLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          agentType: 'codex',
          model: 'gpt-5-codex',
          callType: 'tierFailover',
        })
      );
    });

    it('defaults agentType to claude-code when not provided', () => {
      logger._logFailoverEvent('session-1', {
        fromModel: 'claude-sonnet-4-20250514',
        fromProviderId: 'provider-claude',
        toModel: 'claude-opus-4-20250514',
        toProviderId: 'provider-claude-2',
        tierRef: 'tier::abc',
        tierName: 'My Tier',
        reason: 'quota exhausted',
      });

      expect(agentCallLogs.create).toHaveBeenCalledWith(
        expect.objectContaining({ agentType: 'claude-code' })
      );
    });

    it('completes the log entry with success: true (status completed, not error)', () => {
      logger._logFailoverEvent('session-1', {
        fromModel: 'gemini-2.5-pro',
        fromProviderId: 'provider-gemini',
        toModel: 'claude-sonnet-4-20250514',
        toProviderId: 'provider-claude',
        tierRef: 'tier::abc',
        tierName: 'My Tier',
        reason: 'service unavailable',
        agentType: 'gemini',
      });

      expect(agentCallLogs.complete).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          success: true,
          errorMessage: 'service unavailable',
        })
      );
    });
  });
});
