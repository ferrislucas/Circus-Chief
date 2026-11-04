import { spawn } from 'child_process';
import { normalizeModelIds } from '../agents/adapters/grokAcpEventMapper.js';

export const XAI_PROVIDER_ID = 'xai-default';
const NEGATIVE_TTL_MS = 60_000;
let negativeUntil = 0;

/**
 * Parse `grok models` output. Accepts a JSON array or object with a models
 * list, otherwise non-empty lines whose first token looks like a model id.
 * Nothing here is a hardcoded catalog.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function parseGrokModelsOutput(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed.models || parsed.availableModels || parsed.data || []);
    return normalizeModelIds(list);
  } catch {
    const ids = [];
    // Real CLI output (grok 1.0.70) is prose banners plus model rows that
    // contain ONLY the id, an optional bullet, and an optional "(default)"
    // marker:
    //   You are logged in with grok.com.
    //   Default model: grok-4.7
    //   Available models:
    //     * grok-4.7 (default)
    //     - grok-4.7-build-fast
    // Accepting the first token of every line ingests the banners ("You",
    // "Default") and drops the real rows behind their bullets, so match the
    // row shape instead of skipping known header words.
    for (const line of trimmed.split('\n')) {
      const match = line.match(/^[\s>*·•-]*\s*([A-Za-z0-9][A-Za-z0-9._:-]{0,80})\s*(?:\(\s*default\s*\))?\s*$/);
      if (match) ids.push(match[1]);
    }
    return normalizeModelIds(ids);
  }
}

/**
 * @param {Object} [opts]
 * @returns {Promise<{ available: boolean, models: string[], reason?: string }>}
 */
export function probeGrokModels({ spawnImpl = spawn, command = 'grok', timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, ['models'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve({ available: false, models: [], reason: error?.code === 'ENOENT' ? 'not-found' : 'spawn-failed' });
      return;
    }
    let stdout = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ available: false, models: [], reason: 'timeout' });
    }, timeoutMs);
    timer.unref?.();
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.on('error', (error) => {
      finish({ available: false, models: [], reason: error?.code === 'ENOENT' ? 'not-found' : 'spawn-failed' });
    });
    child.on('exit', (code) => {
      const models = code === 0 ? parseGrokModelsOutput(stdout) : [];
      finish({ available: code === 0, models, reason: code === 0 ? null : 'exit' });
    });
  });
}

/**
 * Insert model ids reported by the local CLI. Existing rows are left alone.
 * Failures are swallowed: discovery must not break provider listing.
 *
 * @param {string[]} modelIds
 */
export async function rememberGrokModels(modelIds) {
  const ids = normalizeModelIds(modelIds);
  if (!ids.length) return [];
  try {
    const { modelProviders } = await import('../database.js');
    return upsertGrokModels(modelProviders, ids);
  } catch {
    return [];
  }
}

export function upsertGrokModels(modelProviders, modelIds) {
  const provider = modelProviders.getById?.(XAI_PROVIDER_ID);
  if (!provider || typeof modelProviders.addModel !== 'function') return [];
  const existing = new Set((provider.models || []).map((model) => model.modelId));
  const added = [];
  for (const modelId of modelIds) {
    if (existing.has(modelId)) continue;
    try {
      modelProviders.addModel(XAI_PROVIDER_ID, {
        modelId,
        displayName: modelId,
        description: 'Reported by the local Grok Build CLI',
        tier: 'custom',
      });
      existing.add(modelId);
      added.push(modelId);
    } catch {
      /* a concurrent insert of the same id is fine */
    }
  }
  return added;
}

/**
 * Fill an empty xAI catalog from `grok models`. No-ops when models already
 * exist or a recent probe found nothing.
 */
export async function refreshGrokCatalogIfEmpty({ spawnImpl, modelProviders, now = Date.now() } = {}) {
  const providers = modelProviders || (await import('../database.js')).modelProviders;
  const provider = providers.getById?.(XAI_PROVIDER_ID);
  if (!provider) return { skipped: true };
  if (provider.models?.length) return { skipped: true, reason: 'catalog-present' };
  if (now < negativeUntil) return { skipped: true, reason: 'cached-negative' };
  const probe = await probeGrokModels({ spawnImpl });
  if (!probe.models.length) {
    negativeUntil = Date.now() + NEGATIVE_TTL_MS;
    return probe;
  }
  negativeUntil = 0;
  upsertGrokModels(providers, probe.models);
  return probe;
}

export function _resetGrokDiscoveryCacheForTests() {
  negativeUntil = 0;
}
