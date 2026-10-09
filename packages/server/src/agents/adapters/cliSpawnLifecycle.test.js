import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { awaitCliSpawn, mapPreSpawnError, confirmCliSpawn } from './cliSpawnLifecycle.js';

describe('awaitCliSpawn', () => {
  it('resolves with the child on spawn', async () => {
    const child = new EventEmitter();
    const waited = awaitCliSpawn(child);
    child.emit('spawn');
    await expect(waited).resolves.toBe(child);
  });

  it('rejects with the error when error fires before spawn', async () => {
    const child = new EventEmitter();
    const waited = awaitCliSpawn(child);
    const failure = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });
    child.emit('error', failure);
    await expect(waited).rejects.toBe(failure);
  });

  it('ignores a late spawn after a pre-spawn error', async () => {
    const child = new EventEmitter();
    const waited = awaitCliSpawn(child);
    child.emit('error', new Error('spawn ENOENT'));
    child.emit('spawn');
    await expect(waited).rejects.toThrow('spawn ENOENT');
    expect(child.listenerCount('spawn')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
  });

  it('ignores post-spawn errors and removes its listeners', async () => {
    const child = new EventEmitter();
    const waited = awaitCliSpawn(child);
    child.emit('spawn');
    await waited;
    expect(child.listenerCount('spawn')).toBe(0);
    expect(child.listenerCount('error')).toBe(0);
    // A post-spawn error belongs to the stream lifecycle, not the waiter.
    // With no listener installed by the waiter, the runner owns it.
    child.on('error', () => {});
    expect(() => child.emit('error', new Error('late EPIPE'))).not.toThrow();
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const child = new EventEmitter();
    const controller = new AbortController();
    controller.abort(new Error('user stopped'));
    await expect(awaitCliSpawn(child, { signal: controller.signal })).rejects.toThrow('user stopped');
    expect(child.listenerCount('spawn')).toBe(0);
  });

  it('rejects when the signal aborts during the wait', async () => {
    const child = new EventEmitter();
    child.kill = () => true;
    const controller = new AbortController();
    const waited = awaitCliSpawn(child, { signal: controller.signal });
    controller.abort(new Error('stop before start'));
    await expect(waited).rejects.toThrow('stop before start');
  });

  it('reaps an aborted pre-start child with SIGTERM then SIGKILL', async () => {
    const child = new EventEmitter();
    child.kill = vi.fn();
    const controller = new AbortController();
    const waited = awaitCliSpawn(child, { signal: controller.signal, killGraceMs: 20 });
    controller.abort(new Error('stop before start'));
    await expect(waited).rejects.toThrow('stop before start');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('resolves immediately for a non-emitter child', async () => {
    await expect(awaitCliSpawn({ pid: 123 })).resolves.toEqual({ pid: 123 });
    await expect(awaitCliSpawn(null)).resolves.toBeNull();
  });
});

describe('mapPreSpawnError', () => {
  it('maps ENOENT to the stable not-found error and marks unavailable', () => {
    let marked = false;
    const mapped = mapPreSpawnError(Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }), {
      notFoundCode: 'X_CLI_NOT_FOUND',
      notFoundMessage: 'X CLI not found',
      markUnavailable: () => { marked = true; },
    });
    expect(mapped.code).toBe('X_CLI_NOT_FOUND');
    expect(mapped.message).toBe('X CLI not found');
    expect(marked).toBe(true);
  });

  it('passes non-ENOENT errors through unchanged', () => {
    const original = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
    expect(mapPreSpawnError(original, { notFoundCode: 'X', notFoundMessage: 'y' })).toBe(original);
  });
});

describe('confirmCliSpawn', () => {
  const mapping = { notFoundCode: 'X_CLI_NOT_FOUND', notFoundMessage: 'X CLI not found' };

  it('resolves the confirmed child on spawn', async () => {
    const child = new EventEmitter();
    const waited = confirmCliSpawn(child, { signal: undefined, ...mapping });
    child.emit('spawn');
    await expect(waited).resolves.toBe(child);
  });

  it('maps a pre-spawn ENOENT to the stable not-found error', async () => {
    const child = new EventEmitter();
    let marked = false;
    const waited = confirmCliSpawn(child, { ...mapping, markUnavailable: () => { marked = true; } });
    child.emit('error', Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }));
    await expect(waited).rejects.toMatchObject({ code: 'X_CLI_NOT_FOUND' });
    expect(marked).toBe(true);
  });

  it('passes non-ENOENT pre-spawn errors through unchanged', async () => {
    const child = new EventEmitter();
    const waited = confirmCliSpawn(child, { signal: undefined, ...mapping });
    const original = Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
    child.emit('error', original);
    await expect(waited).rejects.toBe(original);
  });
});
