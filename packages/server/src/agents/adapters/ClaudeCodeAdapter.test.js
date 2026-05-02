import { describe, it, expect, vi } from 'vitest';

// Mock the SDK before importing the adapter
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { ClaudeCodeAdapter } from './ClaudeCodeAdapter.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

describe('ClaudeCodeAdapter', () => {
  it('calls SDK query() and yields all events', async () => {
    const events = [
      { type: 'system', subtype: 'system.init' },
      { type: 'assistant', message: { content: 'Hello' } },
      { type: 'result', subtype: 'result.success' },
    ];

    query.mockImplementation(async function* (_params) {
      for (const event of events) {
        yield event;
      }
    });

    const adapter = new ClaudeCodeAdapter();
    const collected = [];
    for await (const event of adapter.execute({ prompt: 'test' })) {
      collected.push(event);
    }

    expect(collected).toEqual(events);
    expect(query).toHaveBeenCalledWith({ prompt: 'test' });
  });

  it('propagates errors from SDK query()', async () => {
    query.mockImplementation(async function* () {
      yield { type: 'system' };
      throw new Error('SDK error');
    });

    const adapter = new ClaudeCodeAdapter();
    const collected = [];
    await expect(async () => {
      for await (const event of adapter.execute({ prompt: 'test' })) {
        collected.push(event);
      }
    }).rejects.toThrow('SDK error');

    // Should have yielded the first event before error
    expect(collected).toHaveLength(1);
  });

  it('works with abort controller (yields events until aborted)', async () => {
    const controller = new AbortController();
    const events = [
      { type: 'system' },
      { type: 'assistant' },
      { type: 'result' },
    ];

    query.mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
    });

    const adapter = new ClaudeCodeAdapter();
    const collected = [];
    for await (const event of adapter.execute({ prompt: 'test', options: { abortController: controller } })) {
      collected.push(event);
      if (collected.length === 2) {
        controller.abort();
        break;
      }
    }

    expect(collected).toHaveLength(2);
  });

  it('returns true for supportsResume()', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.supportsResume()).toBe(true);
  });

  it('returns correct capabilities', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.getCapabilities()).toEqual({
      streaming: true,
      thinking: true,
      reasoningEffort: true,
      toolUse: true,
      resume: true,
    });
  });
});
