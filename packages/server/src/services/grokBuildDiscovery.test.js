import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import {
  _resetGrokDiscoveryCacheForTests,
  parseGrokModelsOutput,
  probeGrokModels,
  refreshGrokCatalogIfEmpty,
  upsertGrokModels,
  XAI_PROVIDER_ID,
} from './grokBuildDiscovery.js';

describe('grok model discovery', () => {
  it('parses JSON and plain model lists and drops junk', () => {
    expect(parseGrokModelsOutput('{"models":[{"id":"grok-build"},{"id":"not an id"}]}')).toEqual(['grok-build']);
    expect(parseGrokModelsOutput('MODEL\ngrok-build\n')).toEqual(['grok-build']);
    expect(parseGrokModelsOutput('')).toEqual([]);
  });

  it('upserts only new ids onto the built-in provider', () => {
    const added = [];
    const providers = {
      getById: () => ({ id: XAI_PROVIDER_ID, models: [{ modelId: 'grok-build' }] }),
      addModel: (_id, data) => added.push(data.modelId),
    };
    expect(upsertGrokModels(providers, ['grok-build', 'grok-4'])).toEqual(['grok-4']);
    expect(added).toEqual(['grok-4']);
  });
});

describe('grok model probe', () => {
  it('reads a successful grok models process', async () => {
    const result = await probeGrokModels({
      spawnImpl: () => scriptedChild((child) => {
        child.stdout.emit('data', 'grok-4\n');
        child.emit('exit', 0);
      }),
    });
    expect(result).toEqual({ available: true, models: ['grok-4'], reason: null });
  });

  it('reports a missing binary, a failed exit, and a timeout', async () => {
    const missing = await probeGrokModels({
      spawnImpl: () => {
        const error = new Error('spawn grok ENOENT');
        error.code = 'ENOENT';
        throw error;
      },
    });
    expect(missing).toEqual({ available: false, models: [], reason: 'not-found' });

    const failed = await probeGrokModels({
      spawnImpl: () => scriptedChild((child) => {
        child.stdout.emit('data', 'grok-4\n');
        child.emit('error', Object.assign(new Error('spawn grok ENOENT'), { code: 'ENOENT' }));
      }),
    });
    expect(failed.reason).toBe('not-found');

    const exited = await probeGrokModels({
      spawnImpl: () => scriptedChild((child) => child.emit('exit', 2)),
    });
    expect(exited).toEqual({ available: false, models: [], reason: 'exit' });

    const hung = scriptedChild(() => {});
    const timedOut = await probeGrokModels({ spawnImpl: () => hung, timeoutMs: 15 });
    expect(timedOut.reason).toBe('timeout');
    expect(hung.killed).toBe('SIGKILL');
  });

  it('fills an empty catalog once and remembers a miss', async () => {
    _resetGrokDiscoveryCacheForTests();
    const present = await refreshGrokCatalogIfEmpty({
      modelProviders: { getById: () => ({ id: XAI_PROVIDER_ID, models: [{ modelId: 'grok-4' }] }) },
      spawnImpl: () => { throw new Error('should not probe'); },
    });
    expect(present).toEqual({ skipped: true, reason: 'catalog-present' });

    const added = [];
    const empty = {
      getById: () => ({ id: XAI_PROVIDER_ID, models: [] }),
      addModel: (_id, data) => added.push(data.modelId),
    };
    let probes = 0;
    const failing = () => {
      probes += 1;
      return scriptedChild((child) => child.emit('exit', 1));
    };
    const missed = await refreshGrokCatalogIfEmpty({ modelProviders: empty, spawnImpl: failing });
    expect(missed.reason).toBe('exit');
    expect(probes).toBe(1);
    const cached = await refreshGrokCatalogIfEmpty({ modelProviders: empty, spawnImpl: failing });
    expect(cached).toEqual({ skipped: true, reason: 'cached-negative' });
    expect(probes).toBe(1);

    _resetGrokDiscoveryCacheForTests();
    const filled = await refreshGrokCatalogIfEmpty({
      modelProviders: empty,
      spawnImpl: () => scriptedChild((child) => {
        child.stdout.emit('data', '{"models":[{"id":"grok-4"}]}\n');
        child.emit('exit', 0);
      }),
    });
    expect(filled.models).toEqual(['grok-4']);
    expect(added).toEqual(['grok-4']);
    expect(await refreshGrokCatalogIfEmpty({ modelProviders: { getById: () => null } })).toEqual({ skipped: true });
  });
});

function scriptedChild(script) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (signal) => { child.killed = signal; };
  queueMicrotask(() => script(child));
  return child;
}
