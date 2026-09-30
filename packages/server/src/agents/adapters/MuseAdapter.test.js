import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MuseAdapter, MUSE_CLIENT_INFO, MUSE_SDK_VERSION, MuseTurnTimeoutError, resolveMuseBin, resolveMuseReasoningEffort, resolveMuseServeArgs, buildMuseHostEnv } from './MuseAdapter.js';
import { getNodeBinDir } from '../../services/nodeSpawnHelper.js';

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
  client.session = session;
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

  it('composes options.systemPrompt into the user turn like the Codex/Gemini adapters', async () => {
    const client = createFakeClient();
    const adapter = new MuseAdapter({ museClientFactory: async () => client });
    await collect(adapter, {
      prompt: 'Say hi',
      options: { cwd: '/tmp/work', model: 'muse-spark-1.3', systemPrompt: 'POST /api/workspaces/sess-1/canvas', env: {} },
    });
    const sent = client.calls.sendUserTurn[0].input[0].text;
    expect(sent).toContain('POST /api/workspaces/sess-1/canvas');
    expect(sent).toContain('Say hi');
  });

  it('sends the bare user prompt when no system prompt is provided', async () => {
    const client = createFakeClient();
    const adapter = new MuseAdapter({ museClientFactory: async () => client });
    await collect(adapter, { prompt: 'Say hi', options: { env: {} } });
    expect(client.calls.sendUserTurn[0].input).toEqual([{ type: 'text', text: 'Say hi' }]);
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

  it('auto-approves the first server-offered choice in allowAll (yolo) mode', async () => {
    const client = createFakeClient();
    const adapter = new MuseAdapter({ museClientFactory: async () => client });
    await collect(adapter, { prompt: 'p', options: { approvalMode: 'allowAll', env: {} } });

    const handler = client.__approvalHandler();
    expect(typeof handler).toBe('function');
    await expect(handler({ availableChoices: [{ choiceId: 'allow' }, { choiceId: 'deny' }] }))
      .resolves.toEqual({ choiceId: 'allow' });
    await expect(handler({ availableChoices: [] })).rejects.toThrow(/no choices/);
  });

  it('denies approval requests in standard mode instead of auto-approving', async () => {
    const client = createFakeClient();
    const adapter = new MuseAdapter({ museClientFactory: async () => client });
    await collect(adapter, { prompt: 'p', options: { approvalMode: 'onRequest', env: {} } });

    const handler = client.__approvalHandler();
    await expect(handler({ availableChoices: [{ choiceId: 'allow' }] }))
      .rejects.toThrow(/not auto-approve.*standard|standard.*approval/i);
  });

  it('denies approval requests when no approval mode is set (fail-closed)', async () => {
    const client = createFakeClient();
    const adapter = new MuseAdapter({ museClientFactory: async () => client });
    await collect(adapter, { prompt: 'p', options: { env: {} } });

    const handler = client.__approvalHandler();
    await expect(handler({ availableChoices: [{ choiceId: 'allow' }] }))
      .rejects.toThrow();
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

  it('forwards a user-credential env to the muse host even when options.env is empty', async () => {
    let capturedArgs = null;
    const client = createFakeClient();
    const adapter = new MuseAdapter({
      museClientFactory: async (spawnArgs) => {
        capturedArgs = spawnArgs;
        return client;
      },
    });

    await collect(adapter, { prompt: 'run git status', options: { cwd: '/tmp/work', env: {} } });

    expect(capturedArgs).not.toBeNull();
    expect(capturedArgs.env.HOME).toBeDefined();
    expect(capturedArgs.env.PATH).toBeDefined();
    expect(capturedArgs.env.PATH).toContain(getNodeBinDir());
    if (process.platform !== 'win32') {
      expect(capturedArgs.env.PATH).toContain('/opt/homebrew/bin');
    }
  });

  it('carries a login-shell-derived SSH_AUTH_SOCK even when the host env lacks it', () => {
    const env = buildMuseHostEnv({}, { PATH: '/usr/bin:/bin' }, {
      shellEnv: { SSH_AUTH_SOCK: '/tmp/login-shell-agent.sock' },
      // Fixture socket is not a live socket file; liveness is covered
      // separately — here we prove the derivation reaches the host env.
      isSshAgentAlive: () => ({ alive: true }),
    });

    expect(env.SSH_AUTH_SOCK).toBe('/tmp/login-shell-agent.sock');
  });

  it('session env values win over the host env in the muse host env', async () => {
    let capturedArgs = null;
    const client = createFakeClient();
    const adapter = new MuseAdapter({
      museClientFactory: async (spawnArgs) => {
        capturedArgs = spawnArgs;
        return client;
      },
    });

    await collect(adapter, {
      prompt: 'p',
      options: { cwd: '/tmp/work', env: { FOO: 'session-wins', GH_TOKEN: 'session-token' } },
    });

    expect(capturedArgs.env.FOO).toBe('session-wins');
    expect(capturedArgs.env.GH_TOKEN).toBe('session-token');
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

  it('fails compatibility preflight before it opens an MSP session', async () => {
    const client = createFakeClient();
    const factory = vi.fn(async () => client);
    const adapter = new MuseAdapter({
      museClientFactory: factory,
      museVersionResolver: async () => '1.4.0',
    });

    await expect(collect(adapter, { prompt: 'p', options: {} }))
      .rejects.toMatchObject({ code: 'MUSE_VERSION_MISMATCH', cliVersion: '1.4.0', sdkVersion: MUSE_SDK_VERSION });
    expect(factory).not.toHaveBeenCalled();
    expect(client.calls.startSession).toHaveLength(0);
  });

  it('times out a never-resolving sendUserTurn, closes the host, and returns a typed error', async () => {
    const client = createFakeClient();
    client.session.sendUserTurn = async () => new Promise(() => {});
    const adapter = new MuseAdapter({
      museClientFactory: async () => client,
      timeouts: { startupMs: 15, turnMs: 100, idleMs: 100 },
    });

    await expect(collect(adapter, { prompt: 'p', options: {} }))
      .rejects.toBeInstanceOf(MuseTurnTimeoutError);
    expect(client.calls.close).toBe(1);
  });

  it('does not cancel a quiet stream merely because no item has arrived', async () => {
    const client = createFakeClient();
    let resolveCompleted;
    client.session.sendUserTurn = async () => ({
      async *items() {
        await new Promise((resolve) => setTimeout(resolve, 30));
        yield { kind: 'agentMessage', text: 'tool finished' };
        resolveCompleted({ kind: 'completed', params: { terminal: 'completed' } });
      },
      completed: new Promise((resolve) => { resolveCompleted = resolve; }),
    });
    const adapter = new MuseAdapter({
      museClientFactory: async () => client,
      // `idleMs` is deliberately ignored. A value below the quiet interval
      // proves an inter-event watchdog no longer exists.
      timeouts: { startupMs: 100, turnMs: 100, idleMs: 5 },
    });

    const events = await collect(adapter, { prompt: 'p', options: {} });
    expect(events).toContainEqual({ type: 'assistant', message: { content: [{ type: 'text', text: 'tool finished' }] } });
    expect(client.calls.close).toBe(1);
  });

  it('keeps a long-running quiet tool interval active until the turn completes', async () => {
    const client = createFakeClient();
    let resolveCompleted;
    client.session.sendUserTurn = async () => ({
      async *items() {
        yield { kind: 'agentMessage', text: 'starting command' };
        await new Promise((resolve) => setTimeout(resolve, 30));
        yield { kind: 'agentMessage', text: 'command complete' };
        resolveCompleted({ kind: 'completed', params: { terminal: 'completed' } });
      },
      completed: new Promise((resolve) => { resolveCompleted = resolve; }),
    });
    const adapter = new MuseAdapter({
      museClientFactory: async () => client,
      timeouts: { startupMs: 100, turnMs: 100, idleMs: 5 },
    });

    const events = await collect(adapter, { prompt: 'p', options: {} });
    expect(events).toContainEqual({ type: 'assistant', message: { content: [{ type: 'text', text: 'command complete' }] } });
    expect(client.calls.close).toBe(1);
  });

  it('responds promptly to explicit cancellation while the stream is quiet', async () => {
    const client = createFakeClient();
    client.session.sendUserTurn = async () => ({
      async *items() { await new Promise(() => {}); yield undefined; },
      completed: new Promise(() => {}),
    });
    const controller = new AbortController();
    const adapter = new MuseAdapter({ museClientFactory: async () => client, timeouts: { turnMs: 1_000 } });
    const pending = collect(adapter, { prompt: 'p', options: { abortController: controller } });
    setTimeout(() => controller.abort(), 10);

    const events = await pending;
    expect(events[0]).toMatchObject({ type: 'system', subtype: 'init' });
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'cancelled' });
    expect(client.calls.close).toBe(1);
  });

  it('includes host exit state and recent stderr when the host disconnects', async () => {
    const client = createFakeClient();
    client.exit = Promise.resolve({ kind: 'crash', exitCode: 1 });
    client.session.sendUserTurn = async () => ({
      async *items() { yield* []; throw new Error('MSP connection closed'); },
      completed: new Promise(() => {}),
    });
    const adapter = new MuseAdapter({
      museClientFactory: async ({ onStderr }) => {
        onStderr('fatal: transport lost');
        return client;
      },
    });

    await expect(collect(adapter, { prompt: 'p', options: {} }))
      .rejects.toThrow(/Muse host state=exited:crash.*Recent host stderr: fatal: transport lost/);
  });

  it('forces a stuck host shutdown after the configured grace period', async () => {
    const client = createFakeClient();
    client.close = async () => new Promise(() => {});
    const forceTerminateHost = vi.fn();
    const adapter = new MuseAdapter({
      museClientFactory: async () => client,
      forceTerminateHost,
      timeouts: { shutdownGraceMs: 10 },
    });

    await collect(adapter, { prompt: 'p', options: {} });
    expect(forceTerminateHost).toHaveBeenCalledWith(client, 'unavailable');
  });

  it('passes --disable-sandbox to the host for allowAll (yolo) turns', async () => {
    let capturedArgs = null;
    const client = createFakeClient();
    const adapter = new MuseAdapter({
      museClientFactory: async (spawnArgs) => {
        capturedArgs = spawnArgs;
        return client;
      },
    });

    await collect(adapter, { prompt: 'p', options: { approvalMode: 'allowAll', env: {} } });

    expect(capturedArgs).not.toBeNull();
    expect(capturedArgs.args).toContain('--disable-sandbox');
    expect(capturedArgs.args).toContain('--trust-workspace');
  });

  it('keeps sandbox enabled for gated turns', async () => {
    let capturedArgs = null;
    const client = createFakeClient();
    const adapter = new MuseAdapter({
      museClientFactory: async (spawnArgs) => {
        capturedArgs = spawnArgs;
        return client;
      },
    });

    await collect(adapter, { prompt: 'p', options: { approvalMode: 'onRequest', env: {} } });

    expect(capturedArgs).not.toBeNull();
    expect(capturedArgs.args).toContain('--trust-workspace');
    expect(capturedArgs.args).not.toContain('--disable-sandbox');
  });

  it('can start a valid continuation after a timed-out turn', async () => {
    const hung = createFakeClient();
    hung.session.sendUserTurn = async () => new Promise(() => {});
    const recovered = createFakeClient({ sessionId: 'msp-recovered' });
    const clients = [hung, recovered];
    const adapter = new MuseAdapter({
      museClientFactory: async () => clients.shift(),
      timeouts: { startupMs: 15, turnMs: 100, idleMs: 100 },
    });

    await expect(collect(adapter, { prompt: 'first', options: {} })).rejects.toMatchObject({ code: 'MUSE_TURN_TIMEOUT' });
    const events = await collect(adapter, { prompt: 'continue', options: { resume: 'msp-old' } });
    expect(recovered.calls.resumeSession).toHaveLength(1);
    expect(events[0]).toMatchObject({ subtype: 'init', session_id: 'msp-recovered' });
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
    expect(recovered.calls.close).toBe(1);
  });

  it('gives sendUserTurn its own budget instead of reusing the startup allowance', async () => {
    const client = createFakeClient();
    client.session.sendUserTurn = async (options) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return createFakeClient().session.sendUserTurn(options);
    };
    const adapter = new MuseAdapter({
      museClientFactory: async () => client,
      timeouts: { startupMs: 20, sendTurnMs: 500, turnMs: 5_000 },
    });

    const events = await collect(adapter, { prompt: 'p', options: { env: {} } });
    expect(events.at(-1)).toMatchObject({ type: 'result', subtype: 'success' });
  });

  it('defaults the send-turn budget above 45s', () => {
    expect(new MuseAdapter()._timeouts.sendTurnMs).toBeGreaterThan(45_000);
  });

  it('attaches actionable ssh-agent remediation when the socket is dead', async () => {
    const secret = 'TEST_SENTINEL_GH_SECRET_ZZ9';
    const client = createFakeClient();
    client.session.sendUserTurn = async () => { throw new Error('turn exploded'); };
    const adapter = new MuseAdapter({ museClientFactory: async () => client });

    const error = await collect(adapter, {
      prompt: 'p',
      options: { env: { SSH_AUTH_SOCK: '/nonexistent-dir-xyz/agent.sock', GH_TOKEN: secret } },
    }).then(() => { throw new Error('should have thrown'); }, (err) => err);

    expect(error.message).toMatch(/ssh-add/);
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain('TEST_SENTINEL');
    const warnings = error.museHostDiagnostics?.parityWarnings || [];
    expect(warnings.some((w) => w.signal === 'ssh-agent')).toBe(true);
  });

  it('never surfaces a secret planted in host stderr through turn diagnostics', async () => {
    const secret = 'TEST_SENTINEL_TOK_REDACT_ME';
    const client = createFakeClient();
    client.session.sendUserTurn = async () => { throw new Error('boom'); };
    const adapter = new MuseAdapter({
      museClientFactory: async ({ onStderr }) => {
        onStderr(`request failed with token ${secret} embedded`);
        return client;
      },
    });

    const error = await collect(adapter, { prompt: 'p', options: { env: { GH_TOKEN: secret } } })
      .then(() => { throw new Error('should have thrown'); }, (err) => err);

    expect(error.message).not.toContain(secret);
    expect(error.message).toContain('[REDACTED]');
    const tail = (error.museHostDiagnostics?.stderrTail || []).join('\n');
    expect(tail).not.toContain(secret);
  });

  it('fails fast with MUSE_CLI_NOT_FOUND when the muse binary is off PATH', async () => {
    const { assertMuseHostParity } = await import('./MuseAdapter.js');
    expect(() => assertMuseHostParity({ PATH: '/nonexistent-bin-dir-xyz', HOME: '/tmp' }, {
      museBin: 'muse',
      skipBinaries: false,
    })).toThrow(expect.objectContaining({ code: 'MUSE_CLI_NOT_FOUND' }));
  });

  it('caches the muse --version preflight per binary mtime instead of per turn', async () => {
    const { readMuseCliVersion, clearMuseCliVersionCache } = await import('./museCliVersion.js');
    clearMuseCliVersionCache();
    let execCalls = 0;
    const deps = {
      statSync: () => ({ mtimeMs: 111 }),
      execFile: async () => {
        execCalls += 1;
        return { stdout: 'Muse Code 1.3.0 (1.3.0-R3401.1)\n' };
      },
    };

    await expect(readMuseCliVersion('/tmp/fake-muse', deps)).resolves.toBe('1.3.0');
    await expect(readMuseCliVersion('/tmp/fake-muse', deps)).resolves.toBe('1.3.0');
    expect(execCalls).toBe(1);
  });

  it('re-probes muse --version after the binary changes on disk', async () => {
    const { readMuseCliVersion, clearMuseCliVersionCache } = await import('./museCliVersion.js');
    clearMuseCliVersionCache();
    let execCalls = 0;
    let mtimeMs = 111;
    const deps = {
      statSync: () => ({ mtimeMs }),
      execFile: async () => {
        execCalls += 1;
        return { stdout: 'Muse Code 1.3.0\n' };
      },
    };

    await readMuseCliVersion('/tmp/fake-muse', deps);
    mtimeMs = 222;
    await readMuseCliVersion('/tmp/fake-muse', deps);
    expect(execCalls).toBe(2);
  });
});

describe('resolveMuseServeArgs', () => {
  it('disables sandbox for allowAll (yolo) sessions', () => {
    expect(resolveMuseServeArgs({ approvalMode: 'allowAll' }))
      .toEqual(['serve', '--trust-workspace', '--disable-sandbox']);
  });

  it('keeps sandbox enabled for gated approval modes', () => {
    expect(resolveMuseServeArgs({ approvalMode: 'onRequest' }))
      .toEqual(['serve', '--trust-workspace']);
    expect(resolveMuseServeArgs({ approvalMode: 'promptUnmatched' }))
      .toEqual(['serve', '--trust-workspace']);
    expect(resolveMuseServeArgs({})).toEqual(['serve', '--trust-workspace']);
  });

});

describe('MUSE_CLIENT_INFO', () => {
  it('satisfies the MSP handshake name constraint (^[a-z0-9_]+$)', () => {
    // Live-verified: the host rejects anything else at initialize,
    // which would break every Muse session before it starts.
    expect(MUSE_CLIENT_INFO.name).toMatch(/^[a-z0-9_]+$/);
  });

  it('derives the handshake version from the installed SDK', () => {
    expect(MUSE_CLIENT_INFO.version).toBe(MUSE_SDK_VERSION);
  });
});

describe('resolveMuseBin', () => {
  it('uses the PATH launcher when no explicit binary is configured', () => {
    expect(resolveMuseBin({})).toBe('muse');
  });

  it('honors an explicitly configured Muse executable', () => {
    expect(resolveMuseBin({ MUSE_BIN: '/opt/muse-1.3.0/bin/muse' })).toBe('/opt/muse-1.3.0/bin/muse');
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
