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

function seedSessionRolloutFile(home, sessionId, content, { mtimeMs, day = '19' } = {}) {
  const dayRoot = path.join(home, '.codex', 'sessions', '2026', '09', day);
  fs.mkdirSync(dayRoot, { recursive: true });
  const file = path.join(dayRoot, `rollout-${sessionId}.jsonl`);
  fs.writeFileSync(file, content);
  if (mtimeMs !== undefined) fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}

function tokenCountLine(usedPercent) {
  return `${JSON.stringify({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      rate_limits: { primary: { used_percent: usedPercent, resets_at: 1_789_959_005 } },
    },
  })}\n`;
}

async function pollTimes(watcher, times = 1) {
  for (let i = 0; i < times; i += 1) await watcher.poll();
}

describe('findActiveRolloutFile', () => {
  let home;

  beforeEach(() => {
    home = makeTempHome();
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('selects the newest rollout file modified after the session start', async () => {
    const startedAfterMs = 1_789_850_000_000;
    seedRolloutFile(home, '{}\n', { mtimeMs: startedAfterMs - 1_000 });
    const newest = seedRolloutFile(home, '{}\n', { mtimeMs: startedAfterMs + 5_000 });

    await expect(findActiveRolloutFile({
      sessionsRoot: path.join(home, '.codex', 'sessions'),
      startedAfterMs,
    })).resolves.toBe(newest);
  });

  it('returns null when no file is newer than the session start or the day root is missing', async () => {
    seedRolloutFile(home, '{}\n', { mtimeMs: 1 });

    await expect(findActiveRolloutFile({
      sessionsRoot: path.join(home, '.codex', 'sessions'),
      startedAfterMs: Date.now(),
    })).resolves.toBeNull();
    await expect(findActiveRolloutFile({
      sessionsRoot: path.join(home, '.codex', 'sessions', '1999'),
      startedAfterMs: 0,
    })).resolves.toBeNull();
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

  it('extracts token_count rate limits from the fixture rollout and observes the candidate', async () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer);
    watcher.rolloutFile = seedRolloutFile(home, fs.readFileSync(fixturePath, 'utf8'));

    await pollTimes(watcher);

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

  it('buffers partial trailing lines until they complete across polls', async () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer);
    const complete = fs.readFileSync(fixturePath, 'utf8');
    const rateLimitsLine = complete.split('\n').find((line) => line.includes('"rate_limits"'));
    const file = seedRolloutFile(home, '');

    watcher.rolloutFile = file;
    // First poll sees a truncated line: nothing decoded yet.
    fs.appendFileSync(file, rateLimitsLine.slice(0, Math.floor(rateLimitsLine.length / 2)));
    await pollTimes(watcher);
    expect(observer).not.toHaveBeenCalled();

    // The appended remainder completes the line, which is decoded exactly once.
    fs.appendFileSync(file, `${rateLimitsLine.slice(Math.floor(rateLimitsLine.length / 2))}\n`);
    await pollTimes(watcher);
    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('resumes from the byte offset without re-reading old content', async () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer);
    // The fixture ends with a truncated line; complete it the way the CLI
    // would (appending the remainder), so the buffered partial is decoded
    // exactly once across the two polls.
    const fixtureContent = fs.readFileSync(fixturePath, 'utf8');
    const file = seedRolloutFile(home, fixtureContent);
    watcher.rolloutFile = file;
    await pollTimes(watcher);

    fs.appendFileSync(file, 'o":null}\n');
    fs.appendFileSync(file, '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":50,"resets_at":1789959005}}}}\n');
    await pollTimes(watcher);

    expect(observer).toHaveBeenCalledTimes(2);
    expect(observer.mock.calls[1][0].allowances.map((row) => row.key)).toEqual(['five_hour']);
  });

  it('restarts scanning when the file is truncated below the offset', async () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer);
    const file = seedRolloutFile(home, fs.readFileSync(fixturePath, 'utf8'));
    watcher.rolloutFile = file;
    await pollTimes(watcher);

    fs.writeFileSync(file, '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"primary":{"used_percent":25,"resets_at":1789959005}}}}\n');
    await pollTimes(watcher);

    expect(observer).toHaveBeenCalledTimes(2);
    expect(observer.mock.calls[1][0].allowances[0]).toMatchObject({ key: 'five_hour', remainingPercent: 75 });
  });

  it('pins before locating so a newer rollout belonging to another session is never observed', async () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer, { startedAfterMs: clock.now() - 5_000 });
    const sessionA = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';
    const sessionB = 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0';
    seedSessionRolloutFile(home, sessionA, tokenCountLine(20), { mtimeMs: clock.now() + 1 });
    seedSessionRolloutFile(home, sessionB, tokenCountLine(70), { mtimeMs: clock.now() + 2 });

    watcher.pin(sessionA);
    await pollTimes(watcher, 2);

    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      allowances: [expect.objectContaining({ remainingPercent: 80 })],
    }));
  });

  it('resets its cursor and rescans the pinned session file after initially tailing a newer rollout', async () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer, { startedAfterMs: clock.now() - 5_000 });
    const sessionA = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
    const sessionB = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
    seedSessionRolloutFile(home, sessionA, tokenCountLine(20), { mtimeMs: clock.now() + 1 });
    seedSessionRolloutFile(home, sessionB, tokenCountLine(70), { mtimeMs: clock.now() + 2 });

    await pollTimes(watcher, 2);
    watcher.pin(sessionA);
    await pollTimes(watcher, 2);

    expect(observer.mock.calls.map(([candidate]) => candidate.allowances[0].remainingPercent)).toEqual([30, 80]);
  });

  it('keeps the newest-file heuristic when no session pin arrives', async () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer, { startedAfterMs: clock.now() - 5_000 });
    seedSessionRolloutFile(home, 'a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2', tokenCountLine(20), { mtimeMs: clock.now() + 1 });
    seedSessionRolloutFile(home, 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', tokenCountLine(70), { mtimeMs: clock.now() + 2 });

    await pollTimes(watcher, 2);

    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      allowances: [expect.objectContaining({ remainingPercent: 30 })],
    }));
  });

  it('finds a pinned rollout in the adjacent day directory across midnight', async () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer, { startedAfterMs: clock.now() - 5_000 });
    const sessionId = 'c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2';
    seedSessionRolloutFile(home, sessionId, tokenCountLine(20), { day: '20' });

    watcher.pin(sessionId);
    await pollTimes(watcher, 2);

    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      allowances: [expect.objectContaining({ remainingPercent: 80 })],
    }));
  });

  it('logs observer failures as observer-error, not as read errors, and keeps polling', async () => {
    const observer = vi.fn(() => { throw new Error('observer exploded'); });
    const watcher = makeWatcher(observer);
    const file = seedRolloutFile(home, tokenCountLine(20));
    watcher.rolloutFile = file;
    const outcomes = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((tag, entry) => {
      if (tag === '[CodexRolloutWatcher]') outcomes.push(JSON.parse(entry).outcome);
    });

    await pollTimes(watcher);
    fs.appendFileSync(file, tokenCountLine(40));
    await pollTimes(watcher);

    expect(observer).toHaveBeenCalledTimes(2);
    expect(outcomes).toEqual(['observer-error', 'observer-error']);
    logSpy.mockRestore();
  });

  it('skips polls that overlap an in-flight poll instead of double-reading bytes', async () => {
    const observer = vi.fn();
    const watcher = makeWatcher(observer);
    watcher.rolloutFile = seedRolloutFile(home, tokenCountLine(20));

    // Two polls racing on the same appended bytes: whichever interleaving
    // wins, each byte range must be consumed exactly once.
    await Promise.all([watcher.poll(), watcher.poll()]);

    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('stops quietly and clears its timer', async () => {
    const watcher = makeWatcher(vi.fn());
    watcher.start();
    await watcher.stop();

    expect(watcher.stopped).toBe(true);
    expect(watcher.timer).toBeNull();
    watcher.poll(); // no-op after stop
  });

  it('stops locating after the grace window expires without a rollout file', async () => {
    const observer = vi.fn();
    let now = 1_000_000;
    const watcher = makeWatcher(observer, {
      startedAfterMs: now,
      fileGraceMs: 5_000,
      clock: { now: () => now },
    });
    watcher.start();

    now += 6_000;
    await watcher.poll();

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
