import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CodexRolloutWatcher, findActiveRolloutFile, createCodexRolloutWatcher } from './codexRolloutWatcher.js';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', 'tests', 'fixtures', 'codex', 'rollout-token-count.jsonl',
);

function makeTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-rollout-'));
}

function seedRolloutFile(home, content, { mtimeMs } = {}) {
  const dayRoot = path.join(home, '.codex', 'sessions', '2026', '09', '19');
  fs.mkdirSync(dayRoot, { recursive: true });
  const file = path.join(dayRoot, 'rollout-2026-09-19T21-00-00-redacted.jsonl');
  fs.writeFileSync(file, content);
  if (mtimeMs !== undefined) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}

function syncPoll(watcher, times = 1) {
  for (let i = 0; i < times; i += 1) watcher.poll();
}

describe('findActiveRolloutFile', () => {
  let home;

  beforeEach(() => {
    home = makeTempHome();
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('selects the newest rollout file modified after the session start', () => {
    const startedAfterMs = 1_789_850_000_000;
    seedRolloutFile(home, '{}\n', { mtimeMs: startedAfterMs - 1_000 });
    const newest = seedRolloutFile(home, '{}\n', { mtimeMs: startedAfterMs + 5_000 });

    expect(findActiveRolloutFile({
      sessionsRoot: path.join(home, '.codex', 'sessions'),
      startedAfterMs,
    })).toBe(newest);
  });

  it('returns null when no file is newer than the session start or the day root is missing', () => {
    seedRolloutFile(home, '{}\n', { mtimeMs: 1 });

    expect(findActiveRolloutFile({
      sessionsRoot: path.join(home, '.codex', 'sessions'),
      startedAfterMs: Date.now(),
    })).toBeNull();
    expect(findActiveRolloutFile({
      sessionsRoot: path.join(home, '.codex', 'sessions', '1999'),
      startedAfterMs: 0,
    })).toBeNull();
  });
});

describe('CodexRolloutWatcher', () => {
  let home;
  let clock;

  beforeEach(() => {
    home = makeTempHome();
    clock = { now: () => 1_789_855_000_000 };
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  function makeWatcher(observer, overrides = {}) {
    return new CodexRolloutWatcher({
      providerId: 'openai-default',
      allowanceObserver: observer,
      homeDirectory: home,
      clock,
      pollIntervalMs: 1,
      ...overrides,
    });
  }

  it('extracts token_count rate limits from the fixture rollout and observes the candidate', () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer);
    watcher.rolloutFile = seedRolloutFile(home, fs.readFileSync(fixturePath, 'utf8'));

    syncPoll(watcher);

    expect(observer).toHaveBeenCalledExactlyOnceWith({
      providerKind: 'openai',
      source: 'provider',
      updatedAt: clock.now(),
      staleAfterMs: 15 * 60_000,
      providerId: 'openai-default',
      allowances: [
        expect.objectContaining({ key: 'five_hour', remainingPercent: 83 }),
        expect.objectContaining({ key: 'weekly', remainingPercent: 17 }),
      ],
    });
  });

  it('buffers partial trailing lines until they complete across polls', () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer);
    const complete = fs.readFileSync(fixturePath, 'utf8');
    const tokenCountLine = complete.split('\n').find((line) => line.includes('"rate_limits"'));
    const file = seedRolloutFile(home, '');

    watcher.rolloutFile = file;
    // First poll sees a truncated line: nothing decoded yet.
    fs.appendFileSync(file, tokenCountLine.slice(0, Math.floor(tokenCountLine.length / 2)));
    syncPoll(watcher);
    expect(observer).not.toHaveBeenCalled();

    // The appended remainder completes the line, which is decoded exactly once.
    fs.appendFileSync(file, `${tokenCountLine.slice(Math.floor(tokenCountLine.length / 2))}\n`);
    syncPoll(watcher);
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('resumes from the byte offset without re-reading old content', () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer);
    // The fixture ends with a truncated line; complete it the way the CLI
    // would (appending the remainder), so the buffered partial is decoded
    // exactly once across the two polls.
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');
    const file = seedRolloutFile(home, fixtureContent);
    watcher.rolloutFile = file;
    syncPoll(watcher);

    fs.appendFileSync(file, 'o":null}\n');
    fs.appendFileSync(file, '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":50,"resets_at":1789959005}}}}\n');
    syncPoll(watcher);

    expect(observer).toHaveBeenCalledTimes(2);
    expect(observer.mock.calls[1][0].allowances.map((row) => row.key)).toEqual(['five_hour']);
  });

  it('restarts scanning when the file is truncated below the offset', () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer);
    const file = seedRolloutFile(home, fs.readFileSync(fixturePath, 'utf8'));
    watcher.rolloutFile = file;
    syncPoll(watcher);

    fs.writeFileSync(file, '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":25,"resets_at":1789959005}}}}\n');
    syncPoll(watcher);

    expect(observer).toHaveBeenCalledTimes(2);
    expect(observer.mock.calls[1][0].allowances[0]).toMatchObject({ key: 'five_hour', remainingPercent: 75 });
  });

  it('stops quietly and clears its timer', async () => {
    const watcher = makeWatcher(vi.fn());
    watcher.start();
    await watcher.stop();

    expect(watcher.stopped).toBe(true);
    expect(watcher.timer).toBeNull();
    watcher.poll(); // no-op after stop
  });

  it('stops locating after the grace window expires without a rollout file', () => {
    const observer = vi.fn();
    let now = 1_000_000;
    const watcher = makeWatcher(observer, {
      startedAfterMs: now,
      fileGraceMs: 5_000,
      clock: { now: () => now },
    });
    watcher.start();

    now += 6_000;
    watcher.poll();

    expect(watcher.stopped).toBe(true);
  });
});

describe('createCodexRolloutWatcher', () => {
  it.each([
    ['without a providerId', { allowanceObserver: vi.fn() }],
    ['without an observer', { providerId: 'openai-default' }],
    ['for API-key spawns', { providerId: 'openai-default', allowanceObserver: vi.fn(), env: { OPENAI_API_KEY: 'sk-test' } }],
  ])('returns null %s', (_name, args) => {
    expect(createCodexRolloutWatcher(args)).toBeNull();
  });

  it('creates a watcher for ChatGPT-plan spawns (no API key in env)', () => {
    const watcher = createCodexRolloutWatcher({ providerId: 'openai-default', allowanceObserver: vi.fn(), env: {} });

    expect(watcher).toBeInstanceOf(CodexRolloutWatcher);
  });
});
