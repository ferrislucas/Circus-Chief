import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { executeGeminiCli } from './geminiCliRunner.js';

function createMockChild() {
  const child = new EventEmitter();
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = vi.fn();
  child.stdin = { end: vi.fn() };
  return child;
}

function emitLine(child, jsonObj) {
  child.stdout.push(`${JSON.stringify(jsonObj)}\n`);
}

function emitStderr(child, text) {
  child.stderr.push(text);
}

async function collectEvents(generator) {
  const events = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

describe('geminiCliRunner', () => {
  let child;
  let markCliUnavailable;

  beforeEach(() => {
    child = createMockChild();
    markCliUnavailable = vi.fn();
  });

  it('parses valid JSONL lines into events', async () => {
    const queryParams = { prompt: 'Hello' };
    const options = { model: 'gemini-2.5-flash' };

    const gen = executeGeminiCli(child, queryParams, options, markCliUnavailable);

    // Emit events asynchronously
    setTimeout(() => {
      emitLine(child, { type: 'init', session_id: 'sess-1', model: 'gemini-2.5-flash' });
      emitLine(child, { type: 'message', role: 'assistant', delta: false, content: 'Hi there!' });
      emitLine(child, { type: 'result', status: 'success', stats: { input_tokens: 10, output_tokens: 5 } });
      child.emit('exit', 0);
    }, 10);

    const events = await collectEvents(gen);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0].type).toBe('system');
    expect(events[0].subtype).toBe('init');
  });

  it('ignores empty lines', async () => {
    const gen = executeGeminiCli(child, { prompt: 'Hi' }, { model: 'test' }, markCliUnavailable);

    setTimeout(() => {
      child.stdout.push('\n\n');
      emitLine(child, { type: 'init', session_id: 'x' });
      child.emit('exit', 0);
    }, 10);

    const events = await collectEvents(gen);
    // Should have init + finalize result
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('ignores malformed JSON lines', async () => {
    const gen = executeGeminiCli(child, { prompt: 'Hi' }, { model: 'test' }, markCliUnavailable);

    setTimeout(() => {
      child.stdout.push('{invalid json}\n');
      emitLine(child, { type: 'init', session_id: 'x' });
      child.emit('exit', 0);
    }, 10);

    const events = await collectEvents(gen);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('includes stderr content in error on non-zero exit', async () => {
    const gen = executeGeminiCli(child, { prompt: 'Hi' }, { model: 'test' }, markCliUnavailable);

    setTimeout(() => {
      emitStderr(child, 'Error: something failed');
      child.emit('exit', 1);
    }, 10);

    await expect(collectEvents(gen)).rejects.toThrow('Error: something failed');
  });

  it('ENOENT error marks CLI unavailable', async () => {
    const gen = executeGeminiCli(child, { prompt: 'Hi' }, { model: 'test' }, markCliUnavailable);

    setTimeout(() => {
      const err = new Error('spawn gemini ENOENT');
      err.code = 'ENOENT';
      child.emit('error', err);
    }, 10);

    await expect(collectEvents(gen)).rejects.toThrow('Gemini CLI not found');
    expect(markCliUnavailable).toHaveBeenCalled();
  });

  it('finalize is called on clean exit', async () => {
    const gen = executeGeminiCli(child, { prompt: 'Hi' }, { model: 'test' }, markCliUnavailable);

    setTimeout(() => {
      child.emit('exit', 0);
    }, 10);

    const events = await collectEvents(gen);
    // Should get finalize result event
    expect(events.some((e) => e.type === 'result')).toBe(true);
  });

  it('abort handler sends SIGTERM', async () => {
    const controller = new AbortController();
    const gen = executeGeminiCli(child, { prompt: 'Hi' }, { model: 'test', abortController: controller }, markCliUnavailable);

    setTimeout(() => {
      controller.abort();
      // Simulate child exiting after abort
      setTimeout(() => child.emit('exit', 0), 50);
    }, 10);

    await collectEvents(gen);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });
});
