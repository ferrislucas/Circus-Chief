import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { GeminiAdapter, _resetGeminiCliUnavailableForTests } from './GeminiAdapter.js';

function createMockChild({ autoSpawn = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = vi.fn();
  child.stdin = { end: vi.fn() };
  if (autoSpawn) {
    // Model a normal process start: Node confirms with 'spawn'
    // asynchronously after the spawner returns. Tests for the pre-start
    // error path opt out and emit 'error' with no 'spawn' instead.
    queueMicrotask(() => child.emit('spawn'));
  }
  return child;
}

function emitLine(child, jsonObj) {
  child.stdout.push(`${JSON.stringify(jsonObj)}\n`);
}

async function collectEvents(generator) {
  const events = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('GeminiAdapter', () => {
  beforeEach(() => {
    _resetGeminiCliUnavailableForTests();
  });

  describe('static capabilities shape', () => {
    it('has the correct capabilities', () => {
      expect(GeminiAdapter.capabilities).toEqual({
        streaming: true,
        thinking: false,
        reasoningEffort: false,
        toolUse: true,
        resume: false,
      });
    });
  });

  describe('getCapabilities()', () => {
    it('returns a copy of capabilities', () => {
      const adapter = new GeminiAdapter({});
      const caps = adapter.getCapabilities();
      expect(caps).toEqual(GeminiAdapter.capabilities);
      expect(caps).not.toBe(GeminiAdapter.capabilities);
    });
  });

  describe('supportsResume()', () => {
    it('returns false', () => {
      const adapter = new GeminiAdapter({});
      expect(adapter.supportsResume()).toBe(false);
    });
  });

  describe('needsConversationContext()', () => {
    it('returns true (inherited from BaseAgent)', () => {
      const adapter = new GeminiAdapter({});
      expect(adapter.needsConversationContext()).toBe(true);
    });
  });

  describe('execute()', () => {
    it('spawns gemini process with correct args', async () => {
      const mockChild = createMockChild();
      const spawnFn = vi.fn(() => mockChild);

      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });

      const gen = adapter.execute(
        { prompt: 'Hello world' },
        {},
      );

      // Start consuming to trigger spawn
      const eventPromise = collectEvents(gen);

      setTimeout(() => {
        emitLine(mockChild, { type: 'result', status: 'success', stats: { input_tokens: 1, output_tokens: 1 } });
        mockChild.emit('exit', 0);
      }, 10);

      await eventPromise;

      expect(spawnFn).toHaveBeenCalledWith(expect.objectContaining({
        command: 'gemini',
        args: expect.arrayContaining(['-p', 'Hello world', '--output-format', 'stream-json']),
      }));
    });

    it('yields system init event', async () => {
      const mockChild = createMockChild();
      const spawnFn = vi.fn(() => mockChild);

      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });
      const gen = adapter.execute(
        { prompt: 'Hi' },
        {},
      );
      const eventPromise = collectEvents(gen);

      setTimeout(() => {
        emitLine(mockChild, { type: 'init', session_id: 'test-session', model: 'gemini-2.5-flash' });
        emitLine(mockChild, { type: 'result', status: 'success', stats: { input_tokens: 1, output_tokens: 1 } });
        mockChild.emit('exit', 0);
      }, 10);

      const events = await eventPromise;
      expect(events[0]).toEqual({
        type: 'system',
        subtype: 'init',
        session_id: 'test-session',
        model: 'gemini-2.5-flash',
      });
    });

    it('mixed delta plus full-message output yields live stream and one persisted assistant', async () => {
      const mockChild = createMockChild();
      const spawnFn = vi.fn(() => mockChild);

      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });
      const gen = adapter.execute(
        { prompt: 'Hi' },
        {},
      );
      const eventPromise = collectEvents(gen);

      setTimeout(() => {
        emitLine(mockChild, { type: 'message', role: 'assistant', delta: true, content: 'Hello' });
        emitLine(mockChild, { type: 'message', role: 'assistant', delta: false, content: 'Hello there!' });
        emitLine(mockChild, { type: 'result', status: 'success', stats: { input_tokens: 1, output_tokens: 1 } });
        mockChild.emit('exit', 0);
      }, 10);

      const events = await eventPromise;
      const deltaEvent = events.find((e) => e.type === 'stream_event');
      expect(deltaEvent).toBeTruthy();
      expect(deltaEvent.event.delta.text).toBe('Hello');

      const assistantEvents = events.filter((e) => e.type === 'assistant');
      expect(assistantEvents).toHaveLength(1);
      expect(assistantEvents[0].message.content[0].text).toBe('Hello there!');
    });

    it.each([
      ['plan', 'plan'],
      ['standard', 'auto_edit'],
      ['yolo', 'yolo'],
    ])('spawns gemini with skip-trust and approval mode for %s mode', async (_mode, approvalMode) => {
      const mockChild = createMockChild();
      const spawnFn = vi.fn(() => mockChild);

      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });
      const gen = adapter.execute(
        { prompt: 'Hi', options: { model: 'gemini-2.5-flash', approvalMode } },
        {},
      );
      const eventPromise = collectEvents(gen);

      setTimeout(() => {
        mockChild.emit('exit', 0);
      }, 10);

      await eventPromise;

      const callArgs = spawnFn.mock.calls[0][0].args;
      expect(callArgs).toContain('--skip-trust');
      expect(callArgs).toContain(`--approval-mode=${approvalMode}`);
      expect(callArgs).not.toContain('--yolo');
    });

    it('yields tool_result on tool events', async () => {
      const mockChild = createMockChild();
      const spawnFn = vi.fn(() => mockChild);

      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });
      const gen = adapter.execute(
        { prompt: 'Hi' },
        {},
      );
      const eventPromise = collectEvents(gen);

      setTimeout(() => {
        emitLine(mockChild, { type: 'tool_use', tool_name: 'Bash', tool_id: 't1', parameters: { command: 'ls' } });
        emitLine(mockChild, { type: 'tool_result', tool_id: 't1', output: 'file1\nfile2' });
        emitLine(mockChild, { type: 'result', status: 'success', stats: { input_tokens: 1, output_tokens: 1 } });
        mockChild.emit('exit', 0);
      }, 10);

      const events = await eventPromise;
      const toolEvents = events.filter((e) => e.type === 'tool_result');
      expect(toolEvents.length).toBe(2);
      expect(toolEvents[0].tool_name).toBe('Bash');
      expect(toolEvents[1].tool_name).toBe('Bash');
      expect(toolEvents[1].content).toBe('file1\nfile2');
    });

    it('yields result on stream end', async () => {
      const mockChild = createMockChild();
      const spawnFn = vi.fn(() => mockChild);

      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });
      const gen = adapter.execute(
        { prompt: 'Hi' },
        {},
      );
      const eventPromise = collectEvents(gen);

      setTimeout(() => {
        emitLine(mockChild, { type: 'result', status: 'success', stats: { input_tokens: 100, output_tokens: 50 } });
        mockChild.emit('exit', 0);
      }, 10);

      const events = await eventPromise;
      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toEqual({
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 100, output_tokens: 50 },
      });
    });

    it('throws on ENOENT (CLI not found)', async () => {
      const spawnFn = vi.fn(() => {
        const err = new Error('spawn gemini ENOENT');
        err.code = 'ENOENT';
        throw err;
      });

      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });

      await expect(async () => {
        const gen = adapter.execute({ prompt: 'Hi' }, {});
        await collectEvents(gen);
      }).rejects.toThrow('Gemini CLI not found');
    });

    it('composes prompt with system prompt', async () => {
      const mockChild = createMockChild();
      const spawnFn = vi.fn(() => mockChild);

      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });
      const gen = adapter.execute(
        { prompt: 'Hello', options: { model: 'gemini-2.5-flash', systemPrompt: 'Be helpful' } },
        {},
      );
      const eventPromise = collectEvents(gen);

      setTimeout(() => {
        mockChild.emit('exit', 0);
      }, 10);

      await eventPromise;

      const callArgs = spawnFn.mock.calls[0][0].args;
      const promptIdx = callArgs.indexOf('-p');
      const promptValue = callArgs[promptIdx + 1];
      expect(promptValue).toContain('SYSTEM PROMPT:\nBe helpful');
      expect(promptValue).toContain('USER:\nHello');
    });

    it('composes prompt without system prompt', async () => {
      const mockChild = createMockChild();
      const spawnFn = vi.fn(() => mockChild);

      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });
      const gen = adapter.execute(
        { prompt: 'Hello', options: { model: 'gemini-2.5-flash' } },
        {},
      );
      const eventPromise = collectEvents(gen);

      setTimeout(() => {
        mockChild.emit('exit', 0);
      }, 10);

      await eventPromise;

      const callArgs = spawnFn.mock.calls[0][0].args;
      const promptIdx = callArgs.indexOf('-p');
      const promptValue = callArgs[promptIdx + 1];
      expect(promptValue).toBe('Hello');
    });
  });

  describe('_resetGeminiCliUnavailableForTests', () => {
    it('resets state allowing subsequent spawn attempts', async () => {
      // First trigger ENOENT
      const spawnFn1 = vi.fn(() => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      });

      const adapter1 = new GeminiAdapter({ spawnGeminiProcess: spawnFn1 });
      try {
        const gen = adapter1.execute({ prompt: 'Hi' }, {});
        await collectEvents(gen);
      } catch { /* expected */ }

      // Reset
      _resetGeminiCliUnavailableForTests();

      // Now should be able to spawn again
      const mockChild = createMockChild();
      const spawnFn2 = vi.fn(() => mockChild);
      const adapter2 = new GeminiAdapter({ spawnGeminiProcess: spawnFn2 });
      const gen2 = adapter2.execute({ prompt: 'Hi' }, {});

      setTimeout(() => {
        mockChild.emit('exit', 0);
      }, 10);

      await collectEvents(gen2);
      expect(spawnFn2).toHaveBeenCalled();
    });
  });

  describe('subprocess start confirmation', () => {
    function makeEmitterChild() {
      const child = new EventEmitter();
      child.stdout = new Readable({ read() {} });
      child.stderr = new Readable({ read() {} });
      child.stdin = { end: vi.fn() };
      child.kill = vi.fn();
      return child;
    }

    it('async pre-spawn error without spawn never signals acceptance and rejects definitively', async () => {
      const child = makeEmitterChild();
      const spawnFn = vi.fn(() => {
        // Node reports a missing executable asynchronously as 'error' with
        // no 'spawn' — a synchronous throw alone does not model production.
        process.nextTick(() => {
          const err = new Error('spawn gemini ENOENT');
          err.code = 'ENOENT';
          child.emit('error', err);
        });
        return child;
      });
      const onAccepted = vi.fn();
      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });

      let caught = null;
      try {
        await collectEvents(adapter.execute({ prompt: 'Hi' }, { sessionId: 's1', onProviderAccepted: onAccepted }));
      } catch (e) {
        caught = e;
      }
      expect(caught).not.toBeNull();
      expect(caught.code).toBe('GEMINI_CLI_NOT_FOUND');
      expect(onAccepted).not.toHaveBeenCalled();
    });

    it('acceptance fires only after confirmed spawn, exactly once', async () => {
      const child = makeEmitterChild();
      const spawnFn = vi.fn(() => {
        setTimeout(() => child.emit('spawn'), 10);
        setTimeout(() => {
          emitLine(child, { type: 'result', status: 'success', stats: { input_tokens: 1, output_tokens: 1 } });
          child.emit('exit', 0);
        }, 20);
        return child;
      });
      const onAccepted = vi.fn();
      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });

      const eventsPromise = collectEvents(
        adapter.execute({ prompt: 'Hi' }, { sessionId: 's1', onProviderAccepted: onAccepted }),
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      // The spawner returned but the process has not confirmed start yet.
      expect(onAccepted).not.toHaveBeenCalled();
      const events = await eventsPromise;
      expect(onAccepted).toHaveBeenCalledTimes(1);
      expect(onAccepted.mock.calls[0][0]).toMatchObject({ adapterType: 'gemini', boundary: 'subprocess_start' });
      expect(events.find((e) => e.type === 'result')).toMatchObject({ subtype: 'success' });
    });

    it('aborted signal before spawn never signals acceptance', async () => {
      const child = makeEmitterChild();
      const spawnFn = vi.fn(() => {
        setTimeout(() => child.emit('spawn'), 10);
        setTimeout(() => child.emit('exit', 0), 20);
        return child;
      });
      const controller = new AbortController();
      controller.abort(new Error('user stopped'));
      const onAccepted = vi.fn();
      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });

      let caught = null;
      try {
        await collectEvents(adapter.execute(
          { prompt: 'Hi', options: { abortController: controller } },
          { sessionId: 's1', onProviderAccepted: onAccepted },
        ));
      } catch (e) {
        caught = e;
      }
      expect(caught).not.toBeNull();
      expect(onAccepted).not.toHaveBeenCalled();
    });

    it('duplicate spawn events signal acceptance exactly once', async () => {
      const child = makeEmitterChild();
      const spawnFn = vi.fn(() => {
        setTimeout(() => {
          child.emit('spawn');
          child.emit('spawn');
        }, 10);
        // Stream activity follows start on a later tick, matching
        // production ordering where exit can never coincide with spawn.
        setTimeout(() => {
          emitLine(child, { type: 'result', status: 'success', stats: { input_tokens: 1, output_tokens: 1 } });
          child.emit('exit', 0);
        }, 20);
        return child;
      });
      const onAccepted = vi.fn();
      const adapter = new GeminiAdapter({ spawnGeminiProcess: spawnFn });

      await collectEvents(adapter.execute({ prompt: 'Hi' }, { sessionId: 's1', onProviderAccepted: onAccepted }));
      expect(onAccepted).toHaveBeenCalledTimes(1);
    });
  });
});
