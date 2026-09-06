import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import { executeCodexAppServer } from './codexAppServerRunner.js';

function createAppServerChild(initializeResult = { capabilities: { experimentalApi: true } }) {
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

function execute(child, controller = new AbortController()) {
  return executeCodexAppServer(child, { prompt: 'hello' }, {
    cwd: process.cwd(), model: 'gpt-5-codex', abortController: controller,
  }, { sessionId: 'session-1', conversationId: 'conversation-1' });
}

describe('executeCodexAppServer lifecycle failures', () => {
  it('fails compatibility before starting a thread or turn', async () => {
    const child = createAppServerChild({ capabilities: { experimentalApi: false } });
    const generator = execute(child);

    await expect(nextWithDeadline(generator)).rejects.toThrow('Codex App Server is incompatible: experimentalApi capability is required');
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
