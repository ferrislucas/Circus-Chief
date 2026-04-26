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
import { CodexAdapter } from './adapters/CodexAdapter.js';
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
      'Unknown agent type: "nonexistent". Available: claude-code, codex'
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
    expect(gateway.getAvailableAgents()).toEqual(['claude-code', 'codex']);

    class FakeAdapter extends BaseAgent {}
    gateway.registerAdapter('fake', FakeAdapter);
    expect(gateway.getAvailableAgents()).toEqual(['claude-code', 'codex', 'fake']);
  });

  it('returns capabilities for registered agent types', () => {
    const gateway = new AgentGateway();
    const capabilities = gateway.getAgentCapabilities('claude-code');
    expect(capabilities).toEqual({
      streaming: true,
      thinking: true,
      reasoningEffort: true,
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

  // ── Codex integration ───────────────────────────────────────────────────
  describe('codex adapter integration', () => {
    it('createAgent("codex") returns a CodexAdapter instance', () => {
      const gateway = new AgentGateway();
      const agent = gateway.createAgent('codex');
      expect(agent).toBeInstanceOf(CodexAdapter);
    });

    it('createAgent("codex", config) forwards config to the adapter', () => {
      const gateway = new AgentGateway();
      const fakeSpawner = () => ({});
      const agent = gateway.createAgent('codex', { spawnCodexProcess: fakeSpawner });
      // The constructor pulls spawnCodexProcess into a private field
      expect(agent._spawnCodex).toBe(fakeSpawner);
    });

    it('getAgentCapabilities("codex") returns codex capabilities WITHOUT calling constructor', () => {
      const gateway = new AgentGateway();
      // Spy on the constructor via a prototype method hook is awkward in JS;
      // instead, rely on the contract that the static field is present and
      // ensure the returned caps match the static field exactly (same reference
      // content).
      const caps = gateway.getAgentCapabilities('codex');
      expect(caps).toEqual({
        streaming: true,
        thinking: false,
        reasoningEffort: true,
        toolUse: true,
        resume: false,
      });
      expect(caps).toEqual(CodexAdapter.capabilities);
    });

    it('getAllAgentCapabilities() returns entries for every registered adapter', () => {
      const gateway = new AgentGateway();
      const all = gateway.getAllAgentCapabilities();
      expect(all).toHaveLength(2);
      const byType = Object.fromEntries(all.map((e) => [e.agentType, e.capabilities]));
      expect(byType['claude-code']).toEqual({
        streaming: true, thinking: true, reasoningEffort: true, toolUse: true, resume: true,
      });
      expect(byType['codex']).toEqual({
        streaming: true, thinking: false, reasoningEffort: true, toolUse: true, resume: false,
      });
    });

    it('getAvailableAgents() includes both claude-code and codex', () => {
      const gateway = new AgentGateway();
      expect(gateway.getAvailableAgents()).toEqual(['claude-code', 'codex']);
    });
  });
});
