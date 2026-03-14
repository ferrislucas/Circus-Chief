import { describe, it, expect, vi } from 'vitest';
import {
  MAX_MESSAGES,
  MIN_MESSAGES_FOR_SUMMARY,
  MAX_RETRIES,
  DEFAULT_SESSION_TITLE_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  CONVERSATION_SUMMARY_SYSTEM_PROMPT,
  COMBINED_SUMMARY_SYSTEM_PROMPT,
  formatMessages,
  buildIncrementalPrompt,
  buildConversationSummaryPrompt,
  stripMarkdownCodeBlock,
  trackMessageMetadata,
  parseSummaryResponse,
  parseConversationSummaryResponse,
} from './summaryPrompts.js';

describe('summaryPrompts', () => {
  describe('constants', () => {
    it('has a minimum message threshold for summary generation', () => {
      expect(MIN_MESSAGES_FOR_SUMMARY).toBe(3);
    });

    it('has a maximum of 10 messages', () => {
      expect(MAX_MESSAGES).toBe(10);
    });

    it('has a maximum of 2 retries', () => {
      expect(MAX_RETRIES).toBe(2);
    });
  });

  describe('system prompts', () => {
    it('SUMMARY_SYSTEM_PROMPT contains static instructions', () => {
      expect(SUMMARY_SYSTEM_PROMPT).toContain('updating a session summary');
      expect(SUMMARY_SYSTEM_PROMPT).toContain('Outcome guidelines');
    });

    it('SUMMARY_SYSTEM_PROMPT does not include dynamic content', () => {
      expect(SUMMARY_SYSTEM_PROMPT).not.toContain('${sessionStatus}');
      expect(SUMMARY_SYSTEM_PROMPT).not.toContain('${existingSummary}');
    });

    it('CONVERSATION_SUMMARY_SYSTEM_PROMPT contains conversation instructions', () => {
      expect(CONVERSATION_SUMMARY_SYSTEM_PROMPT).toContain('conversation thread');
      expect(CONVERSATION_SUMMARY_SYSTEM_PROMPT).toContain('Key actions taken');
    });

    it('COMBINED_SUMMARY_SYSTEM_PROMPT contains both session and conversation instructions', () => {
      expect(COMBINED_SUMMARY_SYSTEM_PROMPT).toContain('SESSION SUMMARY');
      expect(COMBINED_SUMMARY_SYSTEM_PROMPT).toContain('CONVERSATION SUMMARY');
    });
  });

  describe('DEFAULT_SESSION_TITLE_PROMPT', () => {
    it('includes strategic goal guidance', () => {
      expect(DEFAULT_SESSION_TITLE_PROMPT).toContain('STRATEGIC GOAL');
    });

    it('includes PR format guidance', () => {
      expect(DEFAULT_SESSION_TITLE_PROMPT).toContain('PR #N:');
    });

    it('includes character limit', () => {
      expect(DEFAULT_SESSION_TITLE_PROMPT).toContain('max 60 characters');
    });
  });

  describe('formatMessages', () => {
    it('formats user messages correctly', () => {
      const messageList = [{ role: 'user', content: 'Hello world' }];
      const result = formatMessages(messageList);
      expect(result).toBe('User: Hello world');
    });

    it('formats assistant messages correctly', () => {
      const messageList = [{ role: 'assistant', content: 'Hi there' }];
      const result = formatMessages(messageList);
      expect(result).toBe('Assistant: Hi there');
    });

    it('formats multiple messages with double newlines', () => {
      const messageList = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];
      const result = formatMessages(messageList);
      expect(result).toBe('User: Hello\n\nAssistant: Hi');
    });

    it('truncates messages longer than 500 characters', () => {
      const longContent = 'A'.repeat(1000);
      const messageList = [{ role: 'user', content: longContent }];
      const result = formatMessages(messageList);
      expect(result).toContain('... [truncated]');
      expect(result.length).toBeLessThan(1000);
    });

    it('includes tool use information when present', () => {
      const messageList = [
        {
          role: 'assistant',
          content: 'Let me read that file',
          toolUse: [{ name: 'Read' }, { name: 'Write' }],
        },
      ];
      const result = formatMessages(messageList);
      expect(result).toContain('[Tools used: Read, Write]');
    });

    it('handles empty tool use array', () => {
      const messageList = [{ role: 'assistant', content: 'Hello', toolUse: [] }];
      const result = formatMessages(messageList);
      expect(result).toBe('Assistant: Hello');
      expect(result).not.toContain('Tools used');
    });

    it('handles missing tool use', () => {
      const messageList = [{ role: 'assistant', content: 'Hello' }];
      const result = formatMessages(messageList);
      expect(result).toBe('Assistant: Hello');
    });
  });

  describe('buildIncrementalPrompt', () => {
    it('includes no previous summary when existingSummary is null', () => {
      const recentMessages = [{ role: 'user', content: 'Test message' }];
      const result = buildIncrementalPrompt(null, recentMessages, 'running');
      expect(result).toContain('No previous summary - this is the first generation');
    });

    it('includes existing summary when provided', () => {
      const existingSummary = {
        fullSummary: 'Previous summary content',
        keyActions: ['action1'],
        filesModified: ['file1.js'],
        outcome: 'ongoing',
      };
      const recentMessages = [{ role: 'user', content: 'Test message' }];
      const result = buildIncrementalPrompt(existingSummary, recentMessages, 'running');
      expect(result).toContain('Previous summary content');
      expect(result).toContain('action1');
      expect(result).toContain('file1.js');
    });

    it('includes session status', () => {
      const recentMessages = [{ role: 'user', content: 'Test message' }];
      const result = buildIncrementalPrompt(null, recentMessages, 'stopped');
      expect(result).toContain('Current session status: stopped');
    });

    it('includes formatted messages', () => {
      const recentMessages = [{ role: 'user', content: 'My question' }];
      const result = buildIncrementalPrompt(null, recentMessages, 'running');
      expect(result).toContain('User: My question');
    });

    it('does not include static instructions (moved to system prompt)', () => {
      const recentMessages = [{ role: 'user', content: 'Test' }];
      const result = buildIncrementalPrompt(null, recentMessages, 'running');
      expect(result).not.toContain('Generate an updated summary');
      expect(result).not.toContain('Outcome guidelines');
    });

    it('includes session title guidelines', () => {
      const recentMessages = [{ role: 'user', content: 'Test' }];
      const result = buildIncrementalPrompt(null, recentMessages, 'running');
      expect(result).toContain('Session title guidelines');
    });

    it('uses default session title prompt when none provided', () => {
      const recentMessages = [{ role: 'user', content: 'Test' }];
      const result = buildIncrementalPrompt(null, recentMessages, 'running', null);
      expect(result).toContain('STRATEGIC GOAL');
    });

    it('uses custom session title prompt when provided', () => {
      const customPrompt = 'Custom title guidelines!';
      const recentMessages = [{ role: 'user', content: 'Test' }];
      const result = buildIncrementalPrompt(null, recentMessages, 'running', customPrompt);
      expect(result).toContain(customPrompt);
      expect(result).not.toContain('STRATEGIC GOAL');
    });

    it('includes previous title in context when existing summary provided', () => {
      const existingSummary = {
        fullSummary: 'Previous work',
        keyActions: ['action1'],
        filesModified: ['file1.js'],
        outcome: 'ongoing',
        sessionTitle: 'Add dark mode support',
      };
      const recentMessages = [{ role: 'user', content: 'Test message' }];
      const result = buildIncrementalPrompt(existingSummary, recentMessages, 'running');
      expect(result).toContain('Previous title: Add dark mode support');
    });

    it('shows not set for previous title when missing', () => {
      const existingSummary = {
        fullSummary: 'Previous work',
        keyActions: ['action1'],
        filesModified: ['file1.js'],
        outcome: 'ongoing',
        sessionTitle: null,
      };
      const recentMessages = [{ role: 'user', content: 'Test message' }];
      const result = buildIncrementalPrompt(existingSummary, recentMessages, 'running');
      expect(result).toContain('Previous title: Not set');
    });

    it('includes child context when provided', () => {
      const recentMessages = [{ role: 'user', content: 'Test' }];
      const childContext = '\nCHILD SESSIONS (2):\n- Child 1 (running): Working on feature';
      const result = buildIncrementalPrompt(null, recentMessages, 'running', null, childContext);
      expect(result).toContain('CHILD SESSIONS (2)');
      expect(result).toContain('Child 1 (running)');
    });
  });

  describe('buildConversationSummaryPrompt', () => {
    it('formats conversation messages into prompt', () => {
      const conversationMessages = [
        { role: 'user', content: 'Help me with this' },
        { role: 'assistant', content: 'Sure, let me help' },
      ];
      const result = buildConversationSummaryPrompt(conversationMessages);
      expect(result).toContain('CONVERSATION:');
      expect(result).toContain('User: Help me with this');
      expect(result).toContain('Assistant: Sure, let me help');
    });
  });

  describe('stripMarkdownCodeBlock', () => {
    it('strips ```json code blocks', () => {
      const input = '```json\n{"key": "value"}\n```';
      const result = stripMarkdownCodeBlock(input);
      expect(result).toBe('{"key": "value"}');
    });

    it('strips ``` code blocks without language specifier', () => {
      const input = '```\n{"key": "value"}\n```';
      const result = stripMarkdownCodeBlock(input);
      expect(result).toBe('{"key": "value"}');
    });

    it('handles code blocks with extra whitespace', () => {
      const input = '```json  \n  {"key": "value"}  \n  ```  ';
      const result = stripMarkdownCodeBlock(input);
      expect(result).toBe('{"key": "value"}');
    });

    it('does not strip when content does not start with ```', () => {
      const input = '{"key": "value"}';
      const result = stripMarkdownCodeBlock(input);
      expect(result).toBe('{"key": "value"}');
    });

    it('handles empty string', () => {
      const result = stripMarkdownCodeBlock('');
      expect(result).toBe('');
    });

    it('handles malformed code block (missing closing)', () => {
      const input = '```json\n{"key": "value"}';
      const result = stripMarkdownCodeBlock(input);
      expect(result).toBe('```json\n{"key": "value"}');
    });

    it('logs when stripping markdown', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      stripMarkdownCodeBlock('```json\n{"key": "value"}\n```');
      expect(consoleSpy).toHaveBeenCalledWith('[SummaryPrompts] Stripped markdown code block from response');
      consoleSpy.mockRestore();
    });
  });

  describe('trackMessageMetadata', () => {
    it('adds message count and last message ID to summary data', () => {
      const summaryData = { short_summary: 'Test' };
      const allMessages = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi' },
        { id: 'msg-3', role: 'user', content: 'How are you?' },
      ];

      trackMessageMetadata(summaryData, allMessages);

      expect(summaryData.messageCount).toBe(3);
      expect(summaryData.lastSummarizedMessageId).toBe('msg-3');
    });

    it('handles empty messages array', () => {
      const summaryData = { short_summary: 'Test' };
      trackMessageMetadata(summaryData, []);
      expect(summaryData.messageCount).toBe(0);
      expect(summaryData.lastSummarizedMessageId).toBeNull();
    });

    it('handles single message', () => {
      const summaryData = { short_summary: 'Test' };
      trackMessageMetadata(summaryData, [{ id: 'msg-1', role: 'user', content: 'Hello' }]);
      expect(summaryData.messageCount).toBe(1);
      expect(summaryData.lastSummarizedMessageId).toBe('msg-1');
    });

    it('preserves existing summary data fields', () => {
      const summaryData = {
        short_summary: 'Test',
        prUrl: 'https://github.com/user/repo/pull/123',
        outcome: 'completed',
      };
      trackMessageMetadata(summaryData, [{ id: 'msg-1', role: 'user', content: 'Hello' }]);
      expect(summaryData.short_summary).toBe('Test');
      expect(summaryData.prUrl).toBe('https://github.com/user/repo/pull/123');
      expect(summaryData.outcome).toBe('completed');
    });
  });

  describe('parseSummaryResponse', () => {
    it('parses valid JSON response', () => {
      const responseText = JSON.stringify({
        short_summary: 'Short test',
        full_summary: 'Full test summary',
        key_actions: ['action1', 'action2'],
        files_modified: ['file1.js'],
        outcome: 'partial',
      });

      const result = parseSummaryResponse(responseText);
      expect(result.shortSummary).toBe('Short test');
      expect(result.fullSummary).toBe('Full test summary');
      expect(result.keyActions).toEqual(['action1', 'action2']);
      expect(result.filesModified).toEqual(['file1.js']);
      expect(result.outcome).toBe('partial');
    });

    it('provides defaults for missing fields', () => {
      const result = parseSummaryResponse(JSON.stringify({}));
      expect(result.shortSummary).toBe('Summary generation failed');
      expect(result.fullSummary).toBe('Unable to generate summary');
      expect(result.keyActions).toEqual([]);
      expect(result.filesModified).toEqual([]);
      expect(result.outcome).toBe('ongoing');
    });

    it('handles invalid JSON with fallback', () => {
      const result = parseSummaryResponse('Not valid JSON');
      expect(result.shortSummary).toBe('Not valid JSON');
      expect(result._parseFailed).toBe(true);
    });

    it('sets _parseFailed to false on successful parse', () => {
      const result = parseSummaryResponse(JSON.stringify({ short_summary: 'Test', full_summary: 'Full' }));
      expect(result._parseFailed).toBe(false);
    });

    it('parses pr_url and session_title', () => {
      const result = parseSummaryResponse(JSON.stringify({
        short_summary: 'Test',
        full_summary: 'Full',
        pr_url: 'https://github.com/owner/repo/pull/123',
        session_title: 'PR #123: Test',
      }));
      expect(result.prUrl).toBe('https://github.com/owner/repo/pull/123');
      expect(result.sessionTitle).toBe('PR #123: Test');
    });

    it('strips markdown code blocks before parsing', () => {
      const jsonContent = { short_summary: 'Test', full_summary: 'Full', key_actions: [], files_modified: [], outcome: 'partial' };
      const responseText = '```json\n' + JSON.stringify(jsonContent) + '\n```';
      const result = parseSummaryResponse(responseText);
      expect(result.shortSummary).toBe('Test');
      expect(result._parseFailed).toBe(false);
    });

    it('truncates fallback short summary to 150 chars', () => {
      const result = parseSummaryResponse('A'.repeat(200));
      expect(result.shortSummary.length).toBe(150);
    });

    it('truncates fallback full summary to 500 chars', () => {
      const result = parseSummaryResponse('A'.repeat(600));
      expect(result.fullSummary.length).toBe(500);
    });
  });

  describe('parseConversationSummaryResponse', () => {
    it('parses valid JSON response with summary field', () => {
      const responseText = JSON.stringify({ summary: 'Conversation about feature X' });
      const result = parseConversationSummaryResponse(responseText);
      expect(result).toBe('Conversation about feature X');
    });

    it('returns fallback when summary field missing', () => {
      const result = parseConversationSummaryResponse(JSON.stringify({}));
      expect(result).toBe('Summary generation failed');
    });

    it('truncates raw text to 200 chars on parse failure', () => {
      const longText = 'A'.repeat(300);
      const result = parseConversationSummaryResponse(longText);
      expect(result.length).toBe(200);
    });

    it('strips code blocks before parsing', () => {
      const jsonContent = { summary: 'Test conversation summary' };
      const responseText = '```json\n' + JSON.stringify(jsonContent) + '\n```';
      const result = parseConversationSummaryResponse(responseText);
      expect(result).toBe('Test conversation summary');
    });
  });
});
