import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { executeCodexAppServer } from './codexAppServerRunner.js';
import { getPrompt, getPromptQueue, respondToPrompt } from '../../services/promptStore.js';
import logger from '../../logger.js';

function createAppServerChild(initializeResult = {
  userAgent: 'Circus Chief/0.145.0 (Mac OS; x86_64)',
  codexHome: '/tmp/codex', platformFamily: 'unix', platformOs: 'macos',
}) {
  const child = new EventEmitter();
  child.requests = [];
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.kill = vi.fn();
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      const request = JSON.parse(chunk.toString());
      child.requests.push(request);
      if (request.method === 'initialize') child.emitMessage({ id: request.id, result: initializeResult });
      if (request.method === 'thread/start') child.emitMessage({ id: request.id, result: { thread: { id: 'thread-1' } } });
      if (request.method === 'turn/start') child.emitMessage({ id: request.id, result: { turn: { id: 'turn-1' } } });
      callback();
    },
  });
  child.emitMessage = (message) => child.stdout.push(`${JSON.stringify(message)}\n`);
  return child;
}

async function nextWithDeadline(generator) {
  let timer;
  try {
    return await Promise.race([
      generator.next(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('App Server turn did not settle')), 50); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function execute(child, controller = new AbortController(), overrides = {}) {
  return executeCodexAppServer(child, { prompt: 'hello' }, {
    cwd: process.cwd(), model: 'gpt-5-codex', abortController: controller,
    ...overrides,
  }, { sessionId: 'session-1', conversationId: 'conversation-1' });
}

function requestUserInput(child, id) {
  child.emitMessage({
    id, method: 'item/tool/requestUserInput', params: {
      threadId: 'thread-1', turnId: 'turn-1', itemId: `item-${id}`,
      questions: [{ id: 'database', question: 'Database?', options: [{ label: 'PostgreSQL', description: 'Relational' }] }],
    },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('executeCodexAppServer lifecycle failures', () => {
  it('emits redacted request and settlement observability', async () => {
    const log = vi.spyOn(logger, 'log');
    const child = createAppServerChild();
    const generator = execute(child);
    const pending = generator.next();
    await new Promise((resolve) => setImmediate(resolve));
    child.emitMessage({
      id: 'provider-request-observability', method: 'item/tool/requestUserInput', params: {
        threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1',
        questions: [{ id: 'secret-question', question: 'What is the secret?', isOther: true }],
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const prompt = getPrompt('session-1');
    expect(respondToPrompt('session-1', prompt.id, {
      action: 'answer', answers: [{ questionId: 'secret-question', text: 'sk-live-never-log-this' }],
    })).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    child.emit('exit', 1);
    await expect(pending).rejects.toThrow('exited with code 1');

    const entries = log.mock.calls.map((args) => JSON.stringify(args));
    const output = entries.join('\n');
    expect(output).toContain('Codex App Server user-input request received');
    expect(output).toContain('Interactive prompt settled');
    expect(output).not.toContain('What is the secret?');
    expect(output).not.toContain('sk-live-never-log-this');
  });

  it('invalidates a provider-resolved request without writing a second JSON-RPC response', async () => {
    const child = createAppServerChild();
    const generator = execute(child);
    const pending = generator.next();
    await new Promise((resolve) => setImmediate(resolve));
    child.emitMessage({
      id: 'provider-request-7', method: 'item/tool/requestUserInput', params: {
        threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1',
        questions: [{ id: 'database', question: 'Database?', options: [{ label: 'PostgreSQL', description: 'Relational' }] }],
      },
    });
    await new Promise((resolve) => setImmediate(resolve));
    const prompt = getPrompt('session-1');
    expect(prompt).toMatchObject({ provider: 'codex', externalRequestId: 'provider-request-7' });

    child.emitMessage({ method: 'serverRequest/resolved', params: { requestId: 'provider-request-7' } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(getPrompt('session-1')).toBeNull();
    expect(respondToPrompt('session-1', prompt.id, { action: 'cancel' })).toBe(false);
    expect(child.requests.filter((request) => request.id === 'provider-request-7')).toEqual([]);

    child.emit('exit', 1);
    await expect(pending).rejects.toThrow('exited with code 1');
  });

  it('deduplicates a repeated provider request and writes one response after the browser answers', async () => {
    const child = createAppServerChild();
    const generator = execute(child);
    const pending = generator.next();
    await new Promise((resolve) => setImmediate(resolve));
    const request = {
      id: 'provider-request-race', method: 'item/tool/requestUserInput', params: {
        threadId: 'thread-1', turnId: 'turn-1', itemId: 'item-1',
        questions: [{ id: 'database', question: 'Database?', options: [{ label: 'PostgreSQL', description: 'Relational' }] }],
      },
    };

    child.emitMessage(request);
    child.emitMessage(request);
    await new Promise((resolve) => setImmediate(resolve));

    expect(getPromptQueue('session-1')).toHaveLength(1);
    const prompt = getPrompt('session-1');
    expect(respondToPrompt('session-1', prompt.id, {
      action: 'answer', answers: [{ questionId: 'database', selectedOptionIds: ['option-0'] }],
    })).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(child.requests.filter((item) => item.id === 'provider-request-race')).toHaveLength(1);

    child.emit('exit', 1);
    await expect(pending).rejects.toThrow('exited with code 1');
  });

  it('fails compatibility before starting a thread or turn', async () => {
    const child = createAppServerChild({});
    const generator = execute(child);

    await expect(nextWithDeadline(generator)).rejects.toThrow('Codex App Server is incompatible: initialize response does not match the supported protocol');
    expect(child.requests.map((request) => request.method)).toEqual(['initialize']);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it.each([
    ['child exit', (child) => child.emit('exit', 1), /exited with code 1/],
    ['malformed JSON-RPC', (child) => child.stdout.push('not json\n'), /invalid JSON-RPC/],
    ['turn failure', (child) => child.emitMessage({ method: 'turn/failed', params: { error: { message: 'turn exploded' } } }), /turn exploded/],
    ['protocol error', (child) => child.emitMessage({ method: 'error', params: { message: 'protocol exploded' } }), /protocol exploded/],
  ])('rejects and reaps the child on %s', async (_name, trigger, expected) => {
    const child = createAppServerChild();
    const generator = execute(child);
    const pending = nextWithDeadline(generator);
    await new Promise((resolve) => setImmediate(resolve));
    trigger(child);

    await expect(pending).rejects.toThrow(expected);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('rejects and reaps the child when aborted', async () => {
    const child = createAppServerChild();
    const controller = new AbortController();
    const generator = execute(child, controller);
    const pending = nextWithDeadline(generator);
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort(new Error('session stopped'));

    await expect(pending).rejects.toThrow('session stopped');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('makes a stopped blocked interaction non-actionable without forwarding a late answer', async () => {
    const child = createAppServerChild();
    const controller = new AbortController();
    const generator = execute(child, controller);
    const pending = generator.next();
    await new Promise((resolve) => setImmediate(resolve));
    requestUserInput(child, 'provider-request-stop');
    await new Promise((resolve) => setImmediate(resolve));
    const prompt = getPrompt('session-1');

    controller.abort(new Error('session stopped'));

    await expect(pending).rejects.toThrow('session stopped');
    expect(getPrompt('session-1')).toBeNull();
    expect(respondToPrompt('session-1', prompt.id, { action: 'cancel' })).toBe(false);
    expect(child.requests.filter((request) => request.id === 'provider-request-stop')).toEqual([]);
  });

  it('expires a blocked interaction using the configured timeout', async () => {
    const child = createAppServerChild();
    const generator = execute(child, new AbortController(), { interactionTimeoutMs: 1 });
    const pending = generator.next();
    await new Promise((resolve) => setImmediate(resolve));
    requestUserInput(child, 'provider-request-timeout');

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(getPrompt('session-1')).toBeNull();
    expect(child.requests.filter((request) => request.id === 'provider-request-timeout')).toEqual([
      expect.objectContaining({ error: expect.objectContaining({ code: -32602 }) }),
    ]);

    child.emit('exit', 1);
    await expect(pending).rejects.toThrow('exited with code 1');
  });

  it('cleans up multiple blocked interactions when the App Server exits', async () => {
    const child = createAppServerChild();
    const generator = execute(child);
    const pending = generator.next();
    await new Promise((resolve) => setImmediate(resolve));
    requestUserInput(child, 'provider-request-first');
    requestUserInput(child, 'provider-request-second');
    await new Promise((resolve) => setImmediate(resolve));

    expect(getPromptQueue('session-1')).toHaveLength(2);
    child.emit('exit', 1);

    await expect(pending).rejects.toThrow('exited with code 1');
    expect(getPromptQueue('session-1')).toEqual([]);
    expect(child.requests.filter((request) => String(request.id).startsWith('provider-request-'))).toEqual([]);
  });

  it('drains stderr so App Server diagnostics cannot block the child', async () => {
    const child = createAppServerChild();
    const generator = execute(child);
    const pending = generator.next();
    await new Promise((resolve) => setImmediate(resolve));
    expect(child.stderr.listenerCount('data')).toBeGreaterThan(0);
    child.emit('exit', 1);
    await expect(pending).rejects.toThrow('exited with code 1');
  });
});
