import { describe, it, expect } from 'vitest';
import { CodexAdapter } from './CodexAdapter.js';
import { BaseAgent } from '../BaseAgent.js';

describe('CodexAdapter', () => {
  it('extends BaseAgent', () => {
    const adapter = new CodexAdapter();
    expect(adapter).toBeInstanceOf(BaseAgent);
  });

  it('throws "not yet implemented" from execute()', async () => {
    const adapter = new CodexAdapter();
    await expect(async () => {
      for await (const _event of adapter.execute({ prompt: 'test' })) {
        // consume
      }
    }).rejects.toThrow('CodexAdapter is not yet implemented');
  });

  it('returns false for supportsResume() (inherited default)', () => {
    const adapter = new CodexAdapter();
    expect(adapter.supportsResume()).toBe(false);
  });

  it('returns correct capabilities', () => {
    const adapter = new CodexAdapter();
    expect(adapter.getCapabilities()).toEqual({
      streaming: true,
      thinking: false,
      toolUse: true,
      resume: false,
    });
  });
});
