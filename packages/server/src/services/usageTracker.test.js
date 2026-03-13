import { describe, it, expect, beforeEach } from 'vitest';
import { estimateTokens, updateTurnUsage, currentTurnUsage, estimatedOutputTokens } from './usageTracker.js';

describe('usageTracker', () => {
  beforeEach(() => {
    // Clear state between tests
    currentTurnUsage.clear();
    estimatedOutputTokens.clear();
  });

  // ── estimateTokens ───────────────────────────────────────────────────

  describe('estimateTokens', () => {
    it('estimates ~4 characters per token', () => {
      expect(estimateTokens('abcd')).toBe(1); // 4 chars = 1 token
      expect(estimateTokens('abcdefgh')).toBe(2); // 8 chars = 2 tokens
    });

    it('returns 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });

    it('rounds up partial tokens', () => {
      expect(estimateTokens('abc')).toBe(1); // 3/4 = 0.75, ceil = 1
      expect(estimateTokens('abcde')).toBe(2); // 5/4 = 1.25, ceil = 2
    });

    it('handles long strings', () => {
      const text = 'a'.repeat(1000);
      expect(estimateTokens(text)).toBe(250); // 1000/4 = 250
    });

    it('handles single character', () => {
      expect(estimateTokens('x')).toBe(1); // 1/4 = 0.25, ceil = 1
    });
  });

  // ── updateTurnUsage ───────────────────────────────────────────────────

  describe('updateTurnUsage', () => {
    it('initializes turn usage on first message_start', () => {
      const usage = { input_tokens: 500, output_tokens: 0 };
      const result = updateTurnUsage('conv-1', usage, 'message_start');

      expect(result.inputTokens).toBe(500);
      expect(result.outputTokens).toBe(0);
    });

    it('tracks output tokens via message_delta', () => {
      // First message_start
      updateTurnUsage('conv-1', { input_tokens: 500 }, 'message_start');
      // Then output streaming
      const result = updateTurnUsage('conv-1', { output_tokens: 100 }, 'message_delta');

      expect(result.inputTokens).toBe(500);
      expect(result.outputTokens).toBe(100); // 0 accumulated + 100 current
    });

    it('accumulates output across multiple messages within a turn', () => {
      // First message
      updateTurnUsage('conv-1', { input_tokens: 500 }, 'message_start');
      updateTurnUsage('conv-1', { output_tokens: 80 }, 'message_delta');

      // Second message in same turn (e.g., tool use then response)
      updateTurnUsage('conv-1', { input_tokens: 600 }, 'message_start');
      // At this point, previous message output (80) is finalized into accumulated

      const result = updateTurnUsage('conv-1', { output_tokens: 50 }, 'message_delta');

      // inputTokens = max(500, 600) = 600
      expect(result.inputTokens).toBe(600);
      // outputTokens = accumulated(80) + current(50) = 130
      expect(result.outputTokens).toBe(130);
    });

    it('takes MAX of input tokens across messages', () => {
      updateTurnUsage('conv-1', { input_tokens: 300 }, 'message_start');
      updateTurnUsage('conv-1', { input_tokens: 800 }, 'message_start');
      updateTurnUsage('conv-1', { input_tokens: 500 }, 'message_start');

      const data = currentTurnUsage.get('conv-1');
      expect(data.inputTokens).toBe(800);
    });

    it('resets lastMessageOutput on new message_start', () => {
      updateTurnUsage('conv-1', { input_tokens: 100 }, 'message_start');
      updateTurnUsage('conv-1', { output_tokens: 50 }, 'message_delta');
      // New message: previous output (50) should be finalized
      updateTurnUsage('conv-1', { input_tokens: 200 }, 'message_start');

      const data = currentTurnUsage.get('conv-1');
      expect(data.outputTokens).toBe(50); // accumulated from first message
      expect(data.lastMessageOutput).toBe(0); // reset for new message
    });

    it('clears estimatedOutputTokens on message_start', () => {
      estimatedOutputTokens.set('conv-1', 999);
      updateTurnUsage('conv-1', { input_tokens: 100 }, 'message_start');
      expect(estimatedOutputTokens.has('conv-1')).toBe(false);
    });

    it('clears estimatedOutputTokens on message_delta', () => {
      estimatedOutputTokens.set('conv-1', 999);
      updateTurnUsage('conv-1', { input_tokens: 100 }, 'message_start');
      estimatedOutputTokens.set('conv-1', 123);
      updateTurnUsage('conv-1', { output_tokens: 50 }, 'message_delta');
      expect(estimatedOutputTokens.has('conv-1')).toBe(false);
    });

    it('tracks cache tokens', () => {
      const usage = {
        input_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100,
      };
      const result = updateTurnUsage('conv-1', usage, 'message_start');
      expect(result.cacheReadInputTokens).toBe(200);
      expect(result.cacheCreationInputTokens).toBe(100);
    });

    it('handles missing usage fields gracefully', () => {
      const result = updateTurnUsage('conv-1', {}, 'message_start');
      expect(result.inputTokens).toBe(0);
      expect(result.outputTokens).toBe(0);
      expect(result.cacheReadInputTokens).toBe(0);
      expect(result.cacheCreationInputTokens).toBe(0);
    });

    it('isolates different conversation IDs', () => {
      updateTurnUsage('conv-A', { input_tokens: 100 }, 'message_start');
      updateTurnUsage('conv-B', { input_tokens: 999 }, 'message_start');

      const dataA = currentTurnUsage.get('conv-A');
      const dataB = currentTurnUsage.get('conv-B');
      expect(dataA.inputTokens).toBe(100);
      expect(dataB.inputTokens).toBe(999);
    });
  });

  // ── State Maps ────────────────────────────────────────────────────────

  describe('state Maps', () => {
    it('currentTurnUsage is a Map', () => {
      expect(currentTurnUsage).toBeInstanceOf(Map);
    });

    it('estimatedOutputTokens is a Map', () => {
      expect(estimatedOutputTokens).toBeInstanceOf(Map);
    });

    it('currentTurnUsage starts empty', () => {
      expect(currentTurnUsage.size).toBe(0);
    });

    it('estimatedOutputTokens starts empty', () => {
      expect(estimatedOutputTokens.size).toBe(0);
    });
  });
});
