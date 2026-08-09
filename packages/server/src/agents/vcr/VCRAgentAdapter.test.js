import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { VCRAgentAdapter } from './VCRAgentAdapter.js';
import { CassetteStore } from './CassetteStore.js';

describe('VCRAgentAdapter', () => {
  let testCassetteDir;

  // Mock inner agent
  const createMockAgent = (events) => ({
    async *execute(_queryParams, _meta) {
      for (const event of events) {
        yield event;
      }
    },
    supportsResume: () => true,
    getCapabilities: () => ({ tools: ['all'] }),
  });

  // Mock inner agent that invokes options.canUseTool for each gated call
  // before yielding events, simulating the real SDK gating a tool mid-turn.
  const createGatedMockAgent = (events, gatedCalls) => ({
    async *execute(queryParams, _meta) {
      for (const call of gatedCalls) {
        await queryParams.options.canUseTool(call.toolName, call.input, call.opts);
      }
      for (const event of events) {
        yield event;
      }
    },
  });

  beforeEach(() => {
    // Each test gets a private absolute directory. This keeps parallel
    // workers and separate worktrees from deleting one another's cassettes.
    testCassetteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'circuschief-vcr-'));
  });

  afterEach(() => {
    if (testCassetteDir && fs.existsSync(testCassetteDir)) {
      fs.rmSync(testCassetteDir, { recursive: true, force: true });
    }
    testCassetteDir = undefined;
    // Reset VCR_MODE
    delete process.env.VCR_MODE;
  });

  it('keeps simultaneous VCR contexts isolated when one fixture is cleaned up', async () => {
    const anotherFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'circuschief-vcr-'));
    try {
      expect(path.isAbsolute(testCassetteDir)).toBe(true);
      expect(anotherFixtureDir).not.toBe(testCassetteDir);

      process.env.VCR_MODE = 'record';
      const first = new VCRAgentAdapter(createMockAgent([{ type: 'result', subtype: 'first' }]), { cassetteDir: testCassetteDir });
      const second = new VCRAgentAdapter(createMockAgent([{ type: 'result', subtype: 'second' }]), { cassetteDir: anotherFixtureDir });
      await Promise.all([
        (async () => { for await (const _event of first.execute({ prompt: 'first canary' }, { callType: 'runSession' })) { /* drain */ } })(),
        (async () => { for await (const _event of second.execute({ prompt: 'second canary' }, { callType: 'runSession' })) { /* drain */ } })(),
      ]);

      fs.rmSync(testCassetteDir, { recursive: true, force: true });
      expect(CassetteStore.load(anotherFixtureDir, CassetteStore.buildKey('runSession', 'second canary'))).toMatchObject({
        events: [{ type: 'result', subtype: 'second' }],
      });
    } finally {
      fs.rmSync(anotherFixtureDir, { recursive: true, force: true });
    }
  });

  describe('record mode', () => {
    it('should record all events and save cassette', async () => {
      process.env.VCR_MODE = 'record';
      const events = [
        { type: 'system', subtype: 'init' },
        { type: 'stream_event', event: { type: 'message_start' } },
        { type: 'result', subtype: 'success' },
      ];
      const mockAgent = createMockAgent(events);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const queryParams = { prompt: 'test prompt', options: { model: 'claude-haiku-4-5-20251001' } };
      const meta = { callType: 'runSession' };

      const collectedEvents = [];
      for await (const event of adapter.execute(queryParams, meta)) {
        collectedEvents.push(event);
      }

      // Verify events were yielded
      expect(collectedEvents).toEqual(events);

      // Verify cassette was saved
      const key = CassetteStore.buildKey('runSession', 'test prompt');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette).not.toBeNull();
      expect(cassette.prompt).toBe('test prompt');
      expect(cassette.model).toBe('claude-haiku-4-5-20251001');
      expect(cassette.events).toEqual(events);
    });

    it('captures gated tool calls in order, with their resolved results, for deterministic replay', async () => {
      process.env.VCR_MODE = 'record';
      const events = [{ type: 'result', subtype: 'success' }];
      const canUseTool = vi.fn()
        .mockResolvedValueOnce({ behavior: 'allow' })
        .mockResolvedValueOnce({ behavior: 'deny', message: 'no' });
      const gatedCalls = [
        { toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which?' }] }, opts: { toolUseID: 'tool-1', signal: new AbortController().signal } },
        { toolName: 'Bash', input: { command: 'ls' }, opts: { toolUseID: 'tool-2' } },
      ];
      const mockAgent = createGatedMockAgent(events, gatedCalls);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });
      const queryParams = { prompt: 'gated record prompt', options: { canUseTool } };

      const collected = [];
      for await (const event of adapter.execute(queryParams, { callType: 'runSession' })) collected.push(event);
      expect(collected).toEqual(events);

      const key = CassetteStore.buildKey('runSession', 'gated record prompt');
      const cassette = CassetteStore.load(testCassetteDir, key);
      // Both calls happen before any event is yielded (see createGatedMockAgent),
      // so both are recorded at position 0.
      expect(cassette.gatedToolCalls).toEqual([
        { toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which?' }] }, opts: { toolUseID: 'tool-1' }, result: { behavior: 'allow' }, afterEventIndex: 0 },
        { toolName: 'Bash', input: { command: 'ls' }, opts: { toolUseID: 'tool-2' }, result: { behavior: 'deny', message: 'no' }, afterEventIndex: 0 },
      ]);
      expect(canUseTool).toHaveBeenCalledTimes(2);
    });

    it('omits gatedToolCalls when a recorded run has no gated interactions', async () => {
      process.env.VCR_MODE = 'record';
      const events = [{ type: 'result', subtype: 'success' }];
      const mockAgent = createMockAgent(events);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      for await (const _event of adapter.execute({ prompt: 'no gated calls' }, { callType: 'runSession' })) { /* drain */ }

      const key = CassetteStore.buildKey('runSession', 'no gated calls');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette.gatedToolCalls).toBeUndefined();
    });

    it('refuses to write a cassette when a gated tool payload contains a secret', async () => {
      process.env.VCR_MODE = 'record';
      const adapter = new VCRAgentAdapter(createGatedMockAgent([], [
        { toolName: 'Bash', input: { command: 'curl -H "Authorization: Bearer sk_live_abcdefghijklmnop" example.test' }, opts: {} },
      ]), { cassetteDir: testCassetteDir });
      const prompt = 'unsafe gated record prompt';

      const draining = (async () => { for await (const _event of adapter.execute({ prompt, options: { canUseTool: vi.fn().mockResolvedValue({ behavior: 'allow' }) } }, { callType: 'runSession' })) { /* drain */ } })();
      await expect(draining).rejects.toThrow('VCR recording rejected: sensitive data detected');
      expect(CassetteStore.load(testCassetteDir, CassetteStore.buildKey('runSession', prompt))).toBeNull();
    });

    it('replays a freshly recorded gated cassette without hand-editing it, reproducing equivalent callback behavior', async () => {
      process.env.VCR_MODE = 'record';
      const recordCanUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
      const mockAgent = createGatedMockAgent([{ type: 'result', subtype: 'success' }], [
        { toolName: 'AskUserQuestion', input: { questions: [{ question: 'Proceed?' }] }, opts: { toolUseID: 'tool-9' } },
      ]);
      const recordAdapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });
      for await (const _event of recordAdapter.execute({ prompt: 'record then replay', options: { canUseTool: recordCanUseTool } }, { callType: 'runSession' })) { /* drain */ }

      process.env.VCR_MODE = 'replay';
      // The replaying host reproduces the same decision the recording made —
      // a divergent decision is covered separately (see "compares the
      // replayed canUseTool result against the recorded one...").
      const replayCanUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
      const replayAdapter = new VCRAgentAdapter(createMockAgent([]), { cassetteDir: testCassetteDir });
      const received = [];
      for await (const event of replayAdapter.execute({ prompt: 'record then replay', options: { canUseTool: replayCanUseTool } }, { callType: 'runSession' })) received.push(event);

      expect(replayCanUseTool).toHaveBeenCalledWith('AskUserQuestion', { questions: [{ question: 'Proceed?' }] }, { toolUseID: 'tool-9' });
      expect(received).toEqual([{ type: 'result', subtype: 'success' }]);
    });
  });

  describe('record/replay ordering and result verification', () => {
    // A mock agent that yields events and interleaves a canUseTool call at a
    // specific point in the stream, simulating the real SDK gating a tool
    // mid-turn rather than before or after the whole turn.
    const createInterleavedMockAgent = (timeline) => ({
      async *execute(queryParams, _meta) {
        for (const step of timeline) {
          if (step.type === 'event') {
            yield step.event;
          } else {
            await queryParams.options.canUseTool(step.toolName, step.input, step.opts);
          }
        }
      },
    });

    it('registers simultaneous replay callbacks before either decision settles', async () => {
      process.env.VCR_MODE = 'replay';
      const key = CassetteStore.buildKey('runSession', 'concurrent replay');
      CassetteStore.save(testCassetteDir, key, {
        events: [],
        gatedToolCalls: [
          { toolName: 'Bash', input: { command: 'first' }, opts: {}, result: { behavior: 'allow' }, afterEventIndex: 0 },
          { toolName: 'Bash', input: { command: 'second' }, opts: {}, result: { behavior: 'allow' }, afterEventIndex: 0 },
        ],
      });
      const resolvers = [];
      const canUseTool = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
      const adapter = new VCRAgentAdapter(createMockAgent([]), { cassetteDir: testCassetteDir });
      const draining = (async () => { for await (const _event of adapter.execute({ prompt: 'concurrent replay', options: { canUseTool } }, { callType: 'runSession' })) { /* drain */ } })();

      await vi.waitFor(() => expect(canUseTool).toHaveBeenCalledTimes(2));
      resolvers[1]({ behavior: 'allow' });
      resolvers[0]({ behavior: 'allow' });
      await draining;
      expect(canUseTool.mock.calls.map(([, input]) => input.command)).toEqual(['first', 'second']);
    });

    it('records concurrent callbacks in invocation order even when they resolve in reverse', async () => {
      process.env.VCR_MODE = 'record';
      const resolvers = [];
      const canUseTool = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
      const concurrentAgent = {
        async *execute(queryParams) {
          const first = queryParams.options.canUseTool('Bash', { command: 'first' }, {});
          const second = queryParams.options.canUseTool('Bash', { command: 'second' }, {});
          await Promise.all([first, second]);
          yield { type: 'result', subtype: 'success' };
        },
      };
      const adapter = new VCRAgentAdapter(concurrentAgent, { cassetteDir: testCassetteDir });
      const draining = (async () => { for await (const _event of adapter.execute({ prompt: 'concurrent record', options: { canUseTool } }, { callType: 'runSession' })) { /* drain */ } })();

      await vi.waitFor(() => expect(canUseTool).toHaveBeenCalledTimes(2));
      resolvers[1]({ behavior: 'allow' });
      resolvers[0]({ behavior: 'allow' });
      await draining;
      const cassette = CassetteStore.load(testCassetteDir, CassetteStore.buildKey('runSession', 'concurrent record'));
      expect(cassette.gatedToolCalls.map(({ input }) => input.command)).toEqual(['first', 'second']);
    });

    it('captures the position of a gated call relative to the event stream during record', async () => {
      process.env.VCR_MODE = 'record';
      const canUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
      const mockAgent = createInterleavedMockAgent([
        { type: 'event', event: { type: 'system', subtype: 'init' } },
        { type: 'call', toolName: 'AskUserQuestion', input: { questions: [] }, opts: { toolUseID: 'tool-1' } },
        { type: 'event', event: { type: 'result', subtype: 'success' } },
      ]);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      for await (const _e of adapter.execute({ prompt: 'positioned gated call', options: { canUseTool } }, { callType: 'runSession' })) { /* drain */ }

      const key = CassetteStore.buildKey('runSession', 'positioned gated call');
      const cassette = CassetteStore.load(testCassetteDir, key);
      // Exactly one event (system/init) had been yielded by the time the
      // gated call occurred.
      expect(cassette.gatedToolCalls[0].afterEventIndex).toBe(1);
    });

    it('replays in the recorded interleaving: events before the gated call are yielded first, then canUseTool fires, then the rest', async () => {
      process.env.VCR_MODE = 'record';
      const recordCanUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
      const mockAgent = createInterleavedMockAgent([
        { type: 'event', event: { type: 'system', subtype: 'init' } },
        { type: 'call', toolName: 'AskUserQuestion', input: { questions: [] }, opts: { toolUseID: 'tool-1' } },
        { type: 'event', event: { type: 'assistant', message: { content: [] } } },
        { type: 'event', event: { type: 'result', subtype: 'success' } },
      ]);
      const recordAdapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });
      for await (const _e of recordAdapter.execute({ prompt: 'interleaving order', options: { canUseTool: recordCanUseTool } }, { callType: 'runSession' })) { /* drain */ }

      process.env.VCR_MODE = 'replay';
      const observedOrder = [];
      const replayCanUseTool = vi.fn(async (toolName) => { observedOrder.push(`call:${toolName}`); return { behavior: 'allow' }; });
      const replayAdapter = new VCRAgentAdapter(createMockAgent([]), { cassetteDir: testCassetteDir });
      for await (const event of replayAdapter.execute({ prompt: 'interleaving order', options: { canUseTool: replayCanUseTool } }, { callType: 'runSession' })) {
        observedOrder.push(`event:${event.type}`);
      }

      expect(observedOrder).toEqual([
        'event:system',
        'call:AskUserQuestion',
        'event:assistant',
        'event:result',
      ]);
    });

    it('preserves the ordering of multiple gated calls at different positions, including a run with none', async () => {
      process.env.VCR_MODE = 'record';
      const recordCanUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
      const mockAgent = createInterleavedMockAgent([
        { type: 'call', toolName: 'Bash', input: { command: 'ls' }, opts: { toolUseID: 'tool-1' } },
        { type: 'event', event: { type: 'system', subtype: 'init' } },
        { type: 'call', toolName: 'Write', input: { file_path: 'a.txt' }, opts: { toolUseID: 'tool-2' } },
        { type: 'call', toolName: 'Edit', input: { file_path: 'b.txt' }, opts: { toolUseID: 'tool-3' } },
        { type: 'event', event: { type: 'result', subtype: 'success' } },
      ]);
      const recordAdapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });
      for await (const _e of recordAdapter.execute({ prompt: 'multi gated ordering', options: { canUseTool: recordCanUseTool } }, { callType: 'runSession' })) { /* drain */ }

      process.env.VCR_MODE = 'replay';
      const observedOrder = [];
      const replayCanUseTool = vi.fn(async (toolName) => { observedOrder.push(`call:${toolName}`); return { behavior: 'allow' }; });
      const replayAdapter = new VCRAgentAdapter(createMockAgent([]), { cassetteDir: testCassetteDir });
      for await (const event of replayAdapter.execute({ prompt: 'multi gated ordering', options: { canUseTool: replayCanUseTool } }, { callType: 'runSession' })) {
        observedOrder.push(`event:${event.type}`);
      }

      expect(observedOrder).toEqual([
        'call:Bash',
        'event:system',
        'call:Write',
        'call:Edit',
        'event:result',
      ]);
    });

    it('compares the replayed canUseTool result against the recorded one and throws a clear diagnostic on divergence', async () => {
      const key = CassetteStore.buildKey('runSession', 'mismatched result');
      CassetteStore.save(testCassetteDir, key, {
        prompt: 'mismatched result',
        events: [{ type: 'result', subtype: 'success' }],
        gatedToolCalls: [{
          toolName: 'AskUserQuestion', input: { questions: [] }, opts: { toolUseID: 'tool-1' },
          result: { behavior: 'allow' }, afterEventIndex: 0,
        }],
      });
      process.env.VCR_MODE = 'replay';
      const canUseTool = vi.fn().mockResolvedValue({ behavior: 'deny', message: 'live host disagrees' });
      const adapter = new VCRAgentAdapter(createMockAgent([]), { cassetteDir: testCassetteDir });

      const executePromise = (async () => {
        for await (const _e of adapter.execute({ prompt: 'mismatched result', options: { canUseTool } }, { callType: 'runSession' })) { /* drain */ }
      })();

      await expect(executePromise).rejects.toThrow(new RegExp(`cassette "${key}"[\\s\\S]*re-record`, 'i'));
    });

    it('does not throw when the replayed result matches the recorded one', async () => {
      const key = CassetteStore.buildKey('runSession', 'matched result');
      CassetteStore.save(testCassetteDir, key, {
        prompt: 'matched result',
        events: [{ type: 'result', subtype: 'success' }],
        gatedToolCalls: [{
          toolName: 'AskUserQuestion', input: { questions: [] }, opts: { toolUseID: 'tool-1' },
          result: { behavior: 'allow' }, afterEventIndex: 0,
        }],
      });
      process.env.VCR_MODE = 'replay';
      const canUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
      const adapter = new VCRAgentAdapter(createMockAgent([]), { cassetteDir: testCassetteDir });

      const received = [];
      for await (const event of adapter.execute({ prompt: 'matched result', options: { canUseTool } }, { callType: 'runSession' })) received.push(event);
      expect(received).toEqual([{ type: 'result', subtype: 'success' }]);
    });

    it('rejects a gated cassette that has no recorded callback result', async () => {
      const fixtureKey = CassetteStore.buildKey('runSession', 'missing gated result');
      CassetteStore.save(testCassetteDir, fixtureKey, {
        prompt: 'missing gated result',
        events: [{ type: 'result', subtype: 'success' }],
        gatedToolCalls: [{ toolName: 'Edit', input: { file_path: 'safe.txt' }, opts: { toolUseID: 'tool-1' } }],
      });

      process.env.VCR_MODE = 'replay';
      const canUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
      const adapter = new VCRAgentAdapter(createMockAgent([]), { cassetteDir: testCassetteDir });

      await expect((async () => {
        for await (const _event of adapter.execute({ prompt: 'missing gated result', options: { canUseTool } }, { callType: 'runSession' })) { /* drain */ }
      })()).rejects.toThrow(/without a recorded result/i);
    });
  });

  describe('replay mode', () => {
    it('replays gated tool calls through the query canUseTool callback', async () => {
      const key = CassetteStore.buildKey('runSession', 'gated prompt');
      CassetteStore.save(testCassetteDir, key, {
        prompt: 'gated prompt',
        events: [{ type: 'result', subtype: 'success' }],
        gatedToolCalls: [{ toolName: 'AskUserQuestion', input: { questions: [] }, opts: { toolUseID: 'tool-1' }, result: { behavior: 'allow' } }],
      });
      process.env.VCR_MODE = 'replay';
      const canUseTool = vi.fn().mockResolvedValue({ behavior: 'allow' });
      const adapter = new VCRAgentAdapter(createMockAgent([]), { cassetteDir: testCassetteDir });

      const received = [];
      for await (const event of adapter.execute({ prompt: 'gated prompt', options: { canUseTool } }, { callType: 'runSession' })) received.push(event);

      expect(canUseTool).toHaveBeenCalledWith('AskUserQuestion', { questions: [] }, { toolUseID: 'tool-1' });
      expect(received).toEqual([{ type: 'result', subtype: 'success' }]);
    });

    it('should replay from existing cassette', async () => {
      // First, save a cassette
      const key = CassetteStore.buildKey('runSession', 'test prompt');
      const events = [
        { type: 'system', subtype: 'init' },
        { type: 'stream_event', event: { type: 'message_start' } },
      ];
      CassetteStore.save(testCassetteDir, key, {
        prompt: 'test prompt',
        model: 'claude-haiku-4-5-20251001',
        events,
      });

      // Set replay mode
      process.env.VCR_MODE = 'replay';
      const mockAgent = createMockAgent([]); // Should not be called
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const queryParams = { prompt: 'test prompt' };
      const meta = { callType: 'runSession' };

      const collectedEvents = [];
      for await (const event of adapter.execute(queryParams, meta)) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);
    });

    it('should throw error when cassette missing', async () => {
      process.env.VCR_MODE = 'replay';
      const mockAgent = createMockAgent([]);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const queryParams = { prompt: 'nonexistent prompt' };
      const meta = { callType: 'runSession' };

      // Execute returns an async generator, need to consume it to trigger error
      const executePromise = (async () => {
        for await (const _event of adapter.execute(queryParams, meta)) {
          // consume
        }
      })();

      await expect(executePromise).rejects.toThrow('no cassette found');
    });
  });

  describe('auto mode', () => {
    it('should replay when cassette exists', async () => {
      // Save a cassette
      const key = CassetteStore.buildKey('runSession', 'test prompt');
      const events = [{ type: 'test' }];
      CassetteStore.save(testCassetteDir, key, {
        prompt: 'test prompt',
        events,
      });

      process.env.VCR_MODE = 'auto';
      const mockAgent = createMockAgent([]); // Should not be called
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const queryParams = { prompt: 'test prompt' };
      const collectedEvents = [];
      for await (const event of adapter.execute(queryParams, { callType: 'runSession' })) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);
    });

    it('should record when cassette missing', async () => {
      process.env.VCR_MODE = 'auto';
      const events = [{ type: 'test' }];
      const mockAgent = createMockAgent(events);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const collectedEvents = [];
      for await (const event of adapter.execute({ prompt: 'new prompt' }, { callType: 'runSession' })) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);

      const key = CassetteStore.buildKey('runSession', 'new prompt');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette).not.toBeNull();
      expect(cassette.events).toEqual(events);
    });
  });

  describe('VCR disabled (no VCR_MODE)', () => {
    it('should pass through to inner agent', async () => {
      delete process.env.VCR_MODE;
      const events = [{ type: 'test' }];
      const mockAgent = createMockAgent(events);
      const adapter = new VCRAgentAdapter(mockAgent, { cassetteDir: testCassetteDir });

      const collectedEvents = [];
      for await (const event of adapter.execute({ prompt: 'test' }, { callType: 'runSession' })) {
        collectedEvents.push(event);
      }

      expect(collectedEvents).toEqual(events);

      // No cassette should be created
      const key = CassetteStore.buildKey('runSession', 'test');
      const cassette = CassetteStore.load(testCassetteDir, key);
      expect(cassette).toBeNull();
    });
  });

  describe('proxy methods', () => {
    it('should proxy supportsResume to inner agent', () => {
      const mockAgent = createMockAgent([]);
      const adapter = new VCRAgentAdapter(mockAgent);

      expect(adapter.supportsResume()).toBe(true);
    });

    it('should proxy getCapabilities to inner agent', () => {
      const mockAgent = createMockAgent([]);
      const adapter = new VCRAgentAdapter(mockAgent);

      expect(adapter.getCapabilities()).toEqual({ tools: ['all'] });
    });

    it('should handle missing proxy methods gracefully', () => {
      const bareAgent = { async *execute() { yield { type: 'test' }; } };
      const adapter = new VCRAgentAdapter(bareAgent);

      expect(adapter.supportsResume()).toBe(false);
      expect(adapter.getCapabilities()).toEqual({});
    });
  });

  describe('codex event shape round-trip', () => {
    it('records then replays Codex-shaped events identically', async () => {
      // Reuse this test's private fixture directory. A repository-relative
      // scratch directory is unsafe when Vitest workers or worktrees run in
      // parallel: one test's cleanup can delete another's recording.
      const codexDir = testCassetteDir;

      try {
        const codexEvents = [
          { type: 'system', subtype: 'init', session_id: 'codex-xyz', model: 'gpt-4o' },
          {
            type: 'stream_event',
            event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
          },
          { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello' }] } },
          { type: 'result', subtype: 'success', usage: { input_tokens: 5, output_tokens: 2 } },
        ];

        const uniquePrompt = `vcr-codex-round-trip-${Date.now()}`;

        // Record
        process.env.VCR_MODE = 'record';
        const recorder = new VCRAgentAdapter(createMockAgent(codexEvents), { cassetteDir: codexDir });
        const recorded = [];
        for await (const e of recorder.execute({ prompt: uniquePrompt }, { callType: 'runSession' })) {
          recorded.push(e);
        }
        expect(recorded).toEqual(codexEvents);

        // Confirm cassette on disk
        const key = CassetteStore.buildKey('runSession', uniquePrompt);
        const cassette = CassetteStore.load(codexDir, key);
        expect(cassette).not.toBeNull();
        expect(cassette.events).toEqual(codexEvents);

        // Replay
        process.env.VCR_MODE = 'replay';
        const replayer = new VCRAgentAdapter(createMockAgent([]), { cassetteDir: codexDir });
        const replayed = [];
        for await (const e of replayer.execute({ prompt: uniquePrompt }, { callType: 'runSession' })) {
          replayed.push(e);
        }
        expect(replayed).toEqual(codexEvents);
      } finally {
        delete process.env.VCR_MODE;
      }
    });
  });

  describe('buildCassetteKey', () => {
    it('should use callType from meta', () => {
      const mockAgent = createMockAgent([]);
      const adapter = new VCRAgentAdapter(mockAgent);

      const key = adapter.buildCassetteKey({ prompt: 'test' }, { callType: 'runSession' });
      expect(key).toBe(CassetteStore.buildKey('runSession', 'test'));
    });

    it('should default to "unknown" callType', () => {
      const mockAgent = createMockAgent([]);
      const adapter = new VCRAgentAdapter(mockAgent);

      const key = adapter.buildCassetteKey({ prompt: 'test' }, {});
      expect(key).toBe(CassetteStore.buildKey('unknown', 'test'));
    });
  });
});
