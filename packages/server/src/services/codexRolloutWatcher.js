import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mapCodexRateLimits } from '../agents/adapters/codexRolloutAllowanceExtractor.js';

/**
 * Tails the active Codex CLI rollout file (`~/.codex/sessions/<y>/<m>/<d>/
 * rollout-*.jsonl`) for `token_count` events carrying ChatGPT-plan rate
 * limits, and feeds them to the provider allowance observer.
 *
 * Only `type === 'token_count'` events are decoded; conversation content in
 * the file is never read into memory beyond line scanning and never logged
 * (FR-8). All failures are contained: a broken watcher can only leave its
 * provider's allowance unknown or stale (FR-7).
 */

const DEFAULT_POLL_INTERVAL_MS = 1_000;
// The CLI creates the rollout file shortly after spawn; stop trying after
// this window so a mis-detected session cannot leave timers behind.
const DEFAULT_FILE_GRACE_MS = 30_000;
// Polling by byte offset is more robust than fs.watch across platforms and
// survives appends of partial (in-flight) JSONL lines.

export function findActiveRolloutFile({ sessionsRoot, startedAfterMs } = {}) {
  // The CLI files a session under the day it started, so the search root is
  // derived from the session start, not the current wall clock (a watcher
  // spanning midnight must still find the file it was born to tail).
  const dayRoot = path.join(sessionsRoot, ...rolloutDateParts(startedAfterMs));
  if (!isDirectory(dayRoot)) return null;

  let newest = { file: null, mtimeMs: startedAfterMs };
  newest = scanDirectoryForNewestRollout(dayRoot, newest);
  return newest.file;
}

function findPinnedRolloutFile({ sessionsRoot, startedAfterMs, sessionId } = {}) {
  let match = null;
  for (const dayRoot of rolloutDayRoots(sessionsRoot, startedAfterMs)) {
    match ??= findSessionRolloutFile(dayRoot, sessionId);
  }
  return match;
}

function findSessionRolloutFile(directory, sessionId) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findSessionRolloutFile(full, sessionId);
      if (nested) return nested;
      continue;
    }
    if (entry.isFile() && isSessionRolloutFileName(entry.name, sessionId)) return full;
  }
  return null;
}

// Keep the UUID-to-filename contract isolated: a watcher may start near
// midnight, so pin lookup checks the start day and its immediate neighbours.
function isSessionRolloutFileName(fileName, sessionId) {
  return fileName.startsWith(`rollout-${sessionId}`) && fileName.endsWith('.jsonl');
}

function scanDirectoryForNewestRollout(directory, current) {
  let entries;
  let newest = current;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      newest = scanDirectoryForNewestRollout(full, newest);
      continue;
    }
    newest = considerRolloutFile(full, entry, newest);
  }
  return newest;
}

function considerRolloutFile(full, entry, current) {
  if (!entry.isFile() || !entry.name.startsWith('rollout-') || !entry.name.endsWith('.jsonl')) return current;
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return current;
  }
  if (stat.mtimeMs <= current.mtimeMs) return current;
  return { file: full, mtimeMs: stat.mtimeMs };
}

export class CodexRolloutWatcher {
  /**
   * @param {Object} options
   * @param {string} options.providerId - Provider the observations belong to.
   * @param {Function} options.allowanceObserver - Bound observe() consumer.
   * @param {Object} [options.env] - Spawn env of the Codex CLI (honors CODEX_HOME).
   * @param {number} [options.startedAfterMs] - Wall clock at session start.
   * @param {Object} [options.clock] - Clock DI ({ now }).
   * @param {number} [options.pollIntervalMs]
   * @param {number} [options.fileGraceMs]
   * @param {string} [options.homeDirectory] - Home DI for tests.
   * @param {Function} [options.streamStaleMsProvider] - Freshness window provider.
   */
  constructor({
    providerId,
    allowanceObserver,
    env = null,
    startedAfterMs = Date.now(),
    clock = Date,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    fileGraceMs = DEFAULT_FILE_GRACE_MS,
    homeDirectory = null,
    streamStaleMsProvider = null,
  }) {
    this.providerId = providerId;
    this.allowanceObserver = allowanceObserver;
    this.startedAfterMs = startedAfterMs;
    this.clock = clock;
    this.pollIntervalMs = pollIntervalMs;
    this.fileGraceMs = fileGraceMs;
    this.streamStaleMsProvider = streamStaleMsProvider;
    this.rolloutFile = null;
    this.sessionId = null;
    this.offset = 0;
    this.partialLine = '';
    this.timer = null;
    this.stopped = false;
    this.homeDirectory = homeDirectory ?? resolveCodexHomeDirectory(env);
  }

  start() {
    if (this.stopped) return;
    this.locate();
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  pin(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId === this.sessionId) return;
    this.sessionId = sessionId;
    this.rolloutFile = null;
    this.resetCursor();
  }

  locate() {
    if (this.rolloutFile) return;
    const sessionsRoot = path.join(this.homeDirectory, '.codex', 'sessions');
    this.rolloutFile = this.sessionId
      ? findPinnedRolloutFile({ sessionsRoot, startedAfterMs: this.startedAfterMs, sessionId: this.sessionId })
      // Until the CLI emits a session_id, retain the legacy newest-file heuristic.
      : findActiveRolloutFile({ sessionsRoot, startedAfterMs: this.startedAfterMs });
    if (!this.rolloutFile && this.clock.now() - this.startedAfterMs > this.fileGraceMs) {
      // No rollout file appeared within the grace window; give up quietly.
      this.stopped = true;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      logOutcome({ providerId: this.providerId, source: 'codex-rollout', outcome: 'no-rollout-file' });
    }
  }

  poll() {
    if (this.stopped) return;
    try {
      if (!this.rolloutFile) {
        this.locate();
        return;
      }
      const bytes = this.readNewBytes();
      if (bytes) this.consume(bytes);
    } catch (error) {
      logOutcome({ providerId: this.providerId, source: 'codex-rollout', outcome: 'read-error' });
      if (error?.code === 'ENOENT') {
        this.rolloutFile = null;
        this.resetCursor();
      }
    }
  }

  readNewBytes() {
    const size = fs.statSync(this.rolloutFile).size;
    if (size < this.offset) {
      // The file shrank below our cursor: it was truncated or replaced, so
      // restart the scan from the beginning.
      this.resetCursor();
    }
    if (size === this.offset) return '';
    const buffer = Buffer.alloc(size - this.offset);
    const fd = fs.openSync(this.rolloutFile, 'r');
    try {
      fs.readSync(fd, buffer, 0, buffer.length, this.offset);
    } finally {
      fs.closeSync(fd);
    }
    this.offset = size;
    return buffer.toString('utf8');
  }

  consume(bytes) {
    this.partialLine += bytes;
    const lines = this.partialLine.split('\n');
    // The final chunk may be an in-flight JSONL line; only complete lines are
    // decoded, and the remainder stays buffered for the next poll.
    this.partialLine = lines.pop() ?? '';
    for (const line of lines) this.handleLine(line);
  }

  resetCursor() {
    this.offset = 0;
    this.partialLine = '';
  }

  handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    // Rollout files wrap CLI events in an envelope
    // ({ timestamp, type: 'event_msg', payload: { type: 'token_count', … } });
    // a bare token_count line is accepted defensively.
    const event = isPlainObject(parsed?.payload) ? parsed.payload : parsed;
    if (event?.type !== 'token_count') return;
    const candidate = mapCodexRateLimits(event.rate_limits, {
      observedAt: this.clock.now(),
      ...(this.streamStaleMsProvider ? { streamStaleMs: this.streamStaleMsProvider() } : {}),
    });
    if (!candidate) {
      logOutcome({ providerId: this.providerId, source: 'codex-rollout', outcome: 'no-data' });
      return;
    }
    this.allowanceObserver({ ...candidate, providerId: this.providerId });
    logOutcome({ providerId: this.providerId, source: 'codex-rollout', outcome: 'ok' });
  }
}

/**
 * Create a watcher for a Codex CLI execution, or null when the session does
 * not qualify: the observer is bound only when the master gate is on, and
 * ChatGPT-plan sessions are exactly those whose spawn env carries no API key.
 */
export function createCodexRolloutWatcher({
  providerId, allowanceObserver, env = null, clock = null, streamStaleMsProvider = null,
} = {}) {
  if (!providerId || typeof allowanceObserver !== 'function') return null;
  if (env?.OPENAI_API_KEY) return null;
  return new CodexRolloutWatcher({
    providerId,
    allowanceObserver,
    env,
    ...(clock ? { clock } : {}),
    streamStaleMsProvider: streamStaleMsProvider ?? undefined,
  });
}

function resolveCodexHomeDirectory(env) {
  const codeHome = env?.CODEX_HOME;
  if (typeof codeHome === 'string' && codeHome.length > 0) return codeHome;
  return os.homedir();
}

function rolloutDateParts(nowMs) {
  const date = new Date(nowMs);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return [String(date.getFullYear()), month, day];
}

function rolloutDayRoots(sessionsRoot, startedAfterMs) {
  const start = new Date(startedAfterMs);
  return [-1, 0, 1].map((offset) => {
    const date = new Date(start);
    date.setDate(date.getDate() + offset);
    return path.join(sessionsRoot, ...rolloutDateParts(date.getTime()));
  });
}

function isDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Structured, credential-free diagnostics (plan §9.4).
function logOutcome(entry) {
  console.log('[CodexRolloutWatcher]', JSON.stringify(entry));
}
