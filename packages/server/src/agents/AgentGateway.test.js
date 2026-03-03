import { describe, it, expect, vi } from 'vitest';

// Mock the SDK so ClaudeCodeAdapter doesn't try to import the real one
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

import { AgentGateway } from './AgentGateway.js';
import { ClaudeCodeAdapter } from './adapters/ClaudeCodeAdapter.js';
import { BaseAgent } from './BaseAgent.js';

describe('AgentGateway', () => {
  it('creates a ClaudeCodeAdapter for "claude-code" type', () => {
    const gateway = new AgentGateway();
    const agent = gateway.createAgent('claude-code');
    expect(agent).toBeInstanceOf(ClaudeCodeAdapter);
  });

  it('throws descriptive error for unknown agent type', () => {
    const gateway = new AgentGateway();
    expect(() => gateway.createAgent('nonexistent')).toThrow(
      'Unknown agent type: "nonexistent". Available: claude-code'
    );
  });

  it('registers and creates custom adapter classes', () => {
    class CustomAdapter extends BaseAgent {
      async *execute(_params) {
        yield { type: 'custom' };
      }
    }

    const gateway = new AgentGateway();
    gateway.registerAdapter('custom', CustomAdapter);
    const agent = gateway.createAgent('custom');
    expect(agent).toBeInstanceOf(CustomAdapter);
  });

  it('lists all registered agent types', () => {
    const gateway = new AgentGateway();
    expect(gateway.getAvailableAgents()).toEqual(['claude-code']);

    class FakeAdapter extends BaseAgent {}
    gateway.registerAdapter('fake', FakeAdapter);
    expect(gateway.getAvailableAgents()).toEqual(['claude-code', 'fake']);
  });

  it('returns capabilities for registered agent types', () => {
    const gateway = new AgentGateway();
    const capabilities = gateway.getAgentCapabilities('claude-code');
    expect(capabilities).toEqual({
      streaming: true,
      thinking: true,
      toolUse: true,
      resume: true,
    });
  });

  it('returns null capabilities for unknown agent type', () => {
    const gateway = new AgentGateway();
    expect(gateway.getAgentCapabilities('nonexistent')).toBeNull();
  });

  it('passes config to created agent', () => {
    const gateway = new AgentGateway();
    const agent = gateway.createAgent('claude-code', { model: 'test-model' });
    expect(agent.config).toEqual({ model: 'test-model', agentType: 'claude-code' });
  });
});
