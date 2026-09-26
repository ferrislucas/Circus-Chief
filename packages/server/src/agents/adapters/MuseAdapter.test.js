import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MuseAdapter, resolveMuseReasoningEffort } from './MuseAdapter.js';

/**
 * Minimal fake of the `@muse-code/sdk` client surface the adapter uses:
 * `startSession` / `resumeSession` / `close`, plus sessions with
 * `onApproval` / `sendUserTurn`.
 */
function createFakeClient({ items = [], outcome = { kind: 'completed', params: { terminal: 'completed' } }, sessionId = 'msp-session-1' } = {}) {
  const calls = { startSession: [], resumeSession: [], sendUserTurn: [], close: 0, approvals: [] };
  let approvalHandler = null;

  const session = {
    sessionId,
    onApproval(handler) { approvalHandler = handler; },
    onApprovalError() {},
    async sendUserTurn(options) {
      calls.sendUserTurn.push(options);
      return {
        async *items() {
          for (const item of items) yield item;
        },
        completed: Promise.resolve(outcome),
      };
    },
  };

  const client = {
    calls,
    __approvalHandler: () => approvalHandler,
    async startSession(options) {
      calls.startSession.push(options || {});
      return session;
    },
    async resumeSession(options) {
      calls.resumeSession.push(options || {});
      return session;
    },
    async close() {
      calls.close += 1;
    },
  };
  return client;
}

describe('MuseAdapter', () => {
  let warnSpy;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  async function collect(adapter, queryParams) {
    const events = [];
    for await (const event of adapter.execute(queryParams)) events.push(event);
    return events;
  }

  it('exposes SDK-native capabilities with resume support', () => {
    const adapter = new MuseAdapter();
    expect(adapter.getCapabilities()).toEqual({
      streaming: true,
      thinking: false,
      reasoningEffort: true,
      toolUse: true,
      resume: true,
    });
    expect(adapter.supportsResume()).toBe(true);
    expect(adapter.needsConversationContext()).toBe(false);
  });

  it('starts a session, emits system init, and folds items to a success result', async () => {
    const client = createFakeClient({
      items: [{ kind: 'agentMessage', text: 'Hello there' }],
      outcome: { kind: 'completed', params: { terminal: 'completed', usage: { inputTokens: 3, outputTokens: 7 } } },
    });
    const adapter = new MuseAdapter({ museClientFactory: async () => client });

    const events = await collect(adapter, {
      prompt: 'Say hi',
      options: { cwd: '/tmp/work', model: 'muse-spark-1.3', env: {} },
    });

    expect(client.calls.startSession).toHaveLength(1);
    expect(client.calls.startSession[0]).toMatchObject({
      workspaceRoot: '/tmp/work',
      modelId: 'muse-spark-1.3',
    });
    expect(client.calls.sendUserTurn[0].input).toEqual([{ type: 'text', text: 'Say hi' }]);
    expect(events[0]).toMatchObject({ type: 'system', subtype: 'init', session_id: 'msp-session-1' });
    expect(events).toContainEqual({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello there' }] },
    });
    expect(events.at(-1)).toEqual({
      type: 'result', subtype: 'success', usage: { input_tokens: 3, output_tokens: 7 },
    });
    expect(client.calls.close).toBe(1);
  });

  it('passes reasoning effort tiers through to the turn', async () => {
    const client = createFakeClient();
    const adapter = new MuseAdapter({ museClientFactory: async () => client });
    await collect(adapter, { prompt: 'p', options: { effortLevel: 'max', env: {} } });
    expect(client.calls.sendUserTurn[0].reasoningEffort).toBe('max');

    const client2 = createFakeClient();
    const adapter2 = new MuseAdapter({ museClientFactory: async () => client2 });
    await collect(adapter2, { prompt: 'p', options: { effortLevel: 'auto', env: {} } });
    expect(client2.calls.sendUserTurn[0]).not.toHaveProperty('reasoningEffort');
  });

  it('resumes the stored MSP session and falls back to start on resume failure', async () => {
    const client = createFakeClient();
    client.resumeSession = async (options) => {
      client.calls.resumeSession.push(options);
      throw new Error('no such session');
    };
    const adapter = new MuseAdapter({ museClientFactory: async () => client });

    await collect(adapter, { prompt: 'again', options: { resume: 'msp-old', env: {} } });
    expect(client.calls.resumeSession).toHaveLength(1);
    expect(client.calls.startSession).toHaveLength(1);
  });

  it('auto-approves the first server-offered choice', async () => {
    const client = createFakeClient();
    const adapter = new MuseAdapter({ museClientFactory: async () => client });
    await collect(adapter, { prompt: 'p', options: { env: {} } });

    const handler = client.__approvalHandler();
    expect(typeof handler).toBe('function');
    await expect(handler({ availableChoices: [{ choiceId: 'allow' }, { choiceId: 'deny' }] }))
      .resolves.toEqual({ choiceId: 'allow' });
    await expect(handler({ availableChoices: [] })).rejects.toThrow(/no choices/);
  });

  it('maps failed turn outcomes to error results and still closes the host', async () => {
    const client = createFakeClient({
      outcome: { kind: 'completed', params: { terminal: 'failed', error: { kind: 'authRequired', message: 'login first', retryable: false } } },
    });
    const adapter = new MuseAdapter({ museClientFactory: async () => client });
    const events = await collect(adapter, { prompt: 'p', options: { env: {} } });
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'error', error: 'login first' });
    expect(client.calls.close).toBe(1);
  });

  it('throws MUSE_CLI_NOT_FOUND when the muse binary is missing', async () => {
    const enoent = new Error('spawn muse ENOENT');
    enoent.code = 'ENOENT';
    const adapter = new MuseAdapter({ museClientFactory: async () => { throw enoent; } });
    await expect(collect(adapter, { prompt: 'p', options: {} }))
      .rejects.toMatchObject({ code: 'MUSE_CLI_NOT_FOUND' });
  });

  it('rethrows non-ENOENT factory errors unchanged', async () => {
    const boom = new Error('handshake exploded');
    const adapter = new MuseAdapter({ museClientFactory: async () => { throw boom; } });
    await expect(collect(adapter, { prompt: 'p', options: {} })).rejects.toBe(boom);
  });
});

describe('resolveMuseReasoningEffort', () => {
  it('maps known effort levels to MSP tiers and omits the rest', () => {
    expect(resolveMuseReasoningEffort('low')).toBe('low');
    expect(resolveMuseReasoningEffort('medium')).toBe('medium');
    expect(resolveMuseReasoningEffort('high')).toBe('high');
    expect(resolveMuseReasoningEffort('max')).toBe('max');
    expect(resolveMuseReasoningEffort('auto')).toBeNull();
    expect(resolveMuseReasoningEffort(null)).toBeNull();
    expect(resolveMuseReasoningEffort('turbo')).toBeNull();
  });
});
