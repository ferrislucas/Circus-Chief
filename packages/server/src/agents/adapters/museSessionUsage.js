import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Reads real token usage for a Muse turn from the CLI's on-disk session
 * journal. The `muse exec --json` stdout stream carries no usage fields (the
 * terminal record is only outcome/text/reason), but the CLI persists a
 * `session/tokenUsage` entry per turn under its session view directory, keyed
 * by the `--session-id` the adapter already passes. Returns null when the
 * journal is unavailable so callers can fall back to estimates or zeros.
 */

/** Journal method carrying per-turn token counts in the CLI session view. */
const TOKEN_USAGE_METHOD = 'session/tokenUsage';

/** Journal files rotate; only these hold the tokenUsage entries. */
const JOURNAL_PREFIX = 'journal-';

/** Bounded wait for the CLI to flush its journal after the turn ends. */
const JOURNAL_RETRIES = 6;
const JOURNAL_RETRY_MS = 100;

function defaultSessionsDir() {
  return process.env.MUSE_SESSION_VIEWS_DIR
    || join(homedir(), '.local', 'share', 'muse', 'sessions', '.msp-view-v1');
}

function defaultCatalogDir() {
  return process.env.MUSE_MODEL_CATALOG_DIR
    || join(homedir(), '.local', 'share', 'muse', 'model-catalog');
}

function toCount(value) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

/**
 * Parse one journal line into tokenUsage params, or null when the line is
 * not JSON or not a tokenUsage entry. Malformed lines are skipped so a
 * future CLI format change degrades to null rather than a crash.
 */
function parseTokenUsageLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const entry = JSON.parse(trimmed);
    return entry?.method === TOKEN_USAGE_METHOD && entry.params && typeof entry.params === 'object'
      ? entry.params
      : null;
  } catch {
    return null;
  }
}

/** Collect the last session/tokenUsage params across every journal file. */
function findLastTokenUsage(journalTexts) {
  let found = null;
  for (const text of journalTexts) {
    for (const line of text.split('\n')) {
      found = parseTokenUsageLine(line) ?? found;
    }
  }
  return found;
}

/** Read one model row from a catalog file, or null when unreadable. */
async function readCatalogRow(catalogDir, file, model) {
  try {
    const catalog = JSON.parse(await readFile(join(catalogDir, file), 'utf8'));
    return (catalog.rows || []).find((candidate) => candidate?.model_id === model) || null;
  } catch {
    return null;
  }
}

/** Best-effort context window for a model id from the CLI model catalog. */
async function lookupContextWindow(model, catalogDir = defaultCatalogDir()) {
  if (!model) return undefined;
  try {
    const files = (await readdir(catalogDir)).filter((name) => name.endsWith('.json')).sort();
    for (const file of files) {
      const row = await readCatalogRow(catalogDir, file, model);
      if (Number.isFinite(row?.context_limit) && row.context_limit > 0) return row.context_limit;
    }
  } catch {
    // No catalog available — the caller falls back to its own default.
  }
  return undefined;
}

/** Read every journal file for a session, or null when none exist yet. */
async function readJournalTexts(dir) {
  const files = (await readdir(dir)).filter((name) => name.startsWith(JOURNAL_PREFIX)).sort();
  if (files.length === 0) return null;
  return Promise.all(files.map((file) => readFile(join(dir, file), 'utf8')));
}

/** Shape journal params into the normalized reading. */
function toReading(params, contextWindow) {
  const usage = params.usage && typeof params.usage === 'object' ? params.usage : {};
  const model = typeof params.modelId === 'string' && params.modelId ? params.modelId : null;
  return {
    inputTokens: toCount(usage.inputTokens),
    outputTokens: toCount(usage.outputTokens),
    thinkingTokens: toCount(usage.reasoningTokens),
    cacheReadInputTokens: toCount(usage.cacheReadTokens),
    cacheCreationInputTokens: toCount(usage.cacheWriteTokens),
    model,
    contextWindow,
  };
}

/**
 * Read one turn's usage from the CLI session journal.
 * @param {string} sessionId - The --session-id passed to this turn.
 * @returns {Promise<{inputTokens:number,outputTokens:number,thinkingTokens:number,cacheReadInputTokens:number,cacheCreationInputTokens:number,model:string|null,contextWindow:number|undefined}|null>}
 */
export async function readMuseSessionUsage(sessionId, { sessionsDir = defaultSessionsDir(), catalogDir } = {}) {
  if (typeof sessionId !== 'string' || !sessionId || sessionId.includes('/') || sessionId.includes('\\')) return null;
  const dir = join(sessionsDir, sessionId);
  for (let attempt = 0; attempt < JOURNAL_RETRIES; attempt += 1) {
    try {
      const texts = await readJournalTexts(dir);
      if (!texts) return null;
      const params = findLastTokenUsage(texts);
      if (!params) return null;
      const model = typeof params.modelId === 'string' && params.modelId ? params.modelId : null;
      return toReading(params, await lookupContextWindow(model, catalogDir));
    } catch {
      // Journal not flushed yet (or unreadable) — retry briefly, then give up.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, JOURNAL_RETRY_MS); });
    }
  }
  return null;
}

/**
 * Shape a journal reading as the SDK-style terminal fields the stream usage
 * handler already understands (snake_case `usage`, camelCase `modelUsage`).
 */
export function buildTerminalUsage(reading) {
  if (!reading) return {};
  const { inputTokens, outputTokens, thinkingTokens, cacheReadInputTokens, cacheCreationInputTokens, model, contextWindow } = reading;
  const entry = {
    inputTokens,
    outputTokens,
    thinkingTokens,
    cacheReadInputTokens,
    cacheCreationInputTokens,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  };
  return {
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    modelUsage: { [model || 'muse']: entry },
  };
}
