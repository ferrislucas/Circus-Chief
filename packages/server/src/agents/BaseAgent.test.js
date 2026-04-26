import { describe, it, expect } from 'vitest';
import { BaseAgent } from './BaseAgent.js';

describe('BaseAgent', () => {
  it('throws when execute() is called on base class', async () => {
    const agent = new BaseAgent();
    const gen = agent.execute({ prompt: 'test' });
    await expect(gen.next()).rejects.toThrow('execute() must be implemented by adapter');
  });

  it('returns false for supportsResume() by default', () => {
    const agent = new BaseAgent();
    expect(agent.supportsResume()).toBe(false);
  });

  it('returns all-false capabilities by default', () => {
    const agent = new BaseAgent();
    expect(agent.getCapabilities()).toEqual({
      streaming: false,
      thinking: false,
      reasoningEffort: false,
      toolUse: false,
      resume: false,
    });
  });

  it('stores config passed to constructor', () => {
    const config = { agentType: 'test', model: 'test-model' };
    const agent = new BaseAgent(config);
    expect(agent.config).toEqual(config);
  });

  it('defaults config to empty object', () => {
    const agent = new BaseAgent();
    expect(agent.config).toEqual({});
  });

  it('needsConversationContext() returns true by default (BaseAgent)', () => {
    const agent = new BaseAgent();
    expect(agent.needsConversationContext()).toBe(true);
  });

  it('needsConversationContext() returns false when supportsResume() returns true', () => {
    class ResumableAgent extends BaseAgent {
      supportsResume() { return true; }
    }
    const agent = new ResumableAgent();
    expect(agent.needsConversationContext()).toBe(false);
  });
});
