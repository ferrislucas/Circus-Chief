import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../database.js', () => ({
  messages: {
    getByConversationId: vi.fn(),
  },
}));

import { messages } from '../database.js';
import {
  formatConversationHistory,
  buildConversationContextForModelSwitch,
  buildConversationContextForBranch,
} from './conversationContext.js';

describe('conversationContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── formatConversationHistory ─────────────────────────────────────────

  describe('formatConversationHistory', () => {
    it('formats user messages with "User:" prefix', () => {
      const result = formatConversationHistory([{ role: 'user', content: 'Hello' }]);
      expect(result).toBe('User: Hello');
    });

    it('formats assistant messages with "Assistant:" prefix', () => {
      const result = formatConversationHistory([{ role: 'assistant', content: 'Hi there' }]);
      expect(result).toBe('Assistant: Hi there');
    });

    it('joins multiple messages with double newlines', () => {
      const msgs = [
        { role: 'user', content: 'Question?' },
        { role: 'assistant', content: 'Answer.' },
      ];
      const result = formatConversationHistory(msgs);
      expect(result).toBe('User: Question?\n\nAssistant: Answer.');
    });

    it('truncates messages longer than 10000 characters', () => {
      const longContent = 'x'.repeat(15000);
      const result = formatConversationHistory([{ role: 'user', content: longContent }]);
      expect(result).toContain('[... message truncated ...]');
      // Should include first 10000 chars
      expect(result.length).toBeLessThan(15200); // 10000 + prefix + truncation note
    });

    it('does not truncate messages at or under 10000 characters', () => {
      const content = 'x'.repeat(10000);
      const result = formatConversationHistory([{ role: 'user', content }]);
      expect(result).not.toContain('[... message truncated ...]');
      expect(result).toBe(`User: ${content}`);
    });

    it('returns empty string for empty array', () => {
      expect(formatConversationHistory([])).toBe('');
    });

    it('handles multiple roles', () => {
      const msgs = [
        { role: 'user', content: 'A' },
        { role: 'assistant', content: 'B' },
        { role: 'user', content: 'C' },
      ];
      const result = formatConversationHistory(msgs);
      expect(result).toBe('User: A\n\nAssistant: B\n\nUser: C');
    });
  });

  // ── buildConversationContextForModelSwitch ────────────────────────────

  describe('buildConversationContextForModelSwitch', () => {
    it('returns empty string when no messages', () => {
      messages.getByConversationId.mockReturnValue([]);
      expect(buildConversationContextForModelSwitch('conv-1')).toBe('');
    });

    it('returns empty string when only one message (current prompt)', () => {
      messages.getByConversationId.mockReturnValue([
        { role: 'user', content: 'current prompt' },
      ]);
      // slice(0, -1) removes the last message, leaving empty array
      expect(buildConversationContextForModelSwitch('conv-1')).toBe('');
    });

    it('formats previous messages excluding last one', () => {
      messages.getByConversationId.mockReturnValue([
        { role: 'user', content: 'First question' },
        { role: 'assistant', content: 'First answer' },
        { role: 'user', content: 'Current prompt' },
      ]);
      const result = buildConversationContextForModelSwitch('conv-1');
      expect(result).toContain('<conversation_history>');
      expect(result).toContain('User: First question');
      expect(result).toContain('Assistant: First answer');
      expect(result).not.toContain('Current prompt');
      expect(result).toContain('switched to a different model');
      expect(result).toContain('</conversation_history>');
    });

    it('passes correct conversationId to database', () => {
      messages.getByConversationId.mockReturnValue([]);
      buildConversationContextForModelSwitch('conv-42');
      expect(messages.getByConversationId).toHaveBeenCalledWith('conv-42');
    });
  });

  // ── buildConversationContextForBranch ─────────────────────────────────

  describe('buildConversationContextForBranch', () => {
    it('returns empty string when no messages', () => {
      messages.getByConversationId.mockReturnValue([]);
      expect(buildConversationContextForBranch('conv-1')).toBe('');
    });

    it('returns empty string when only one message', () => {
      messages.getByConversationId.mockReturnValue([
        { role: 'user', content: 'the only message' },
      ]);
      expect(buildConversationContextForBranch('conv-1')).toBe('');
    });

    it('formats previous messages excluding last one', () => {
      messages.getByConversationId.mockReturnValue([
        { role: 'user', content: 'Branch starter' },
        { role: 'assistant', content: 'Branch reply' },
        { role: 'user', content: 'Next prompt' },
      ]);
      const result = buildConversationContextForBranch('conv-1');
      expect(result).toContain('<conversation_history>');
      expect(result).toContain('User: Branch starter');
      expect(result).toContain('Assistant: Branch reply');
      expect(result).not.toContain('Next prompt');
      expect(result).toContain('branched session');
      expect(result).toContain('</conversation_history>');
    });

    it('uses branched-session specific wording (not model-switch wording)', () => {
      messages.getByConversationId.mockReturnValue([
        { role: 'user', content: 'Q' },
        { role: 'assistant', content: 'A' },
        { role: 'user', content: 'Current' },
      ]);
      const result = buildConversationContextForBranch('conv-1');
      expect(result).toContain('branched session');
      expect(result).not.toContain('switched to a different model');
    });

    it('passes correct conversationId to database', () => {
      messages.getByConversationId.mockReturnValue([]);
      buildConversationContextForBranch('conv-99');
      expect(messages.getByConversationId).toHaveBeenCalledWith('conv-99');
    });
  });
});
