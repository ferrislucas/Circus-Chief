import { mkdtemp, mkdir, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTerminalUsage, readMuseSessionUsage, snapshotMuseJournalState } from './museSessionUsage.js';

const SESSION_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

function tokenUsageLine(overrides = {}) {
  return JSON.stringify({
    method: 'session/tokenUsage',
    params: {
      usage: { inputTokens: 23602, outputTokens: 15, reasoningTokens: 4, cacheReadTokens: 10, cacheWriteTokens: 20, cachedTokens: 0 },
      cumulative: { outputTokens: 15, promptTokens: 23602, totalTokens: 23617 },
      promptTokens: 23602,
      totalTokens: 23617,
      modelId: 'muse-spark-1.3-contributor',
      turnId: 'turn-1',
      ...overrides.params,
    },
  });
}

async function fixtureSessions(journals, catalogRows = []) {
  const root = await mkdtemp(join(tmpdir(), 'muse-usage-'));
  const sessionsDir = join(root, 'sessions');
  await mkdir(join(sessionsDir, SESSION_ID), { recursive: true });
  for (const [index, lines] of journals.entries()) {
    await writeFile(join(sessionsDir, SESSION_ID, `journal-${String(index).padStart(8, '0')}.bin`), lines.join('\n'));
  }
  const catalogDir = join(root, 'catalog');
  await mkdir(catalogDir, { recursive: true });
  await writeFile(join(catalogDir, 'catalog.json'), JSON.stringify({ rows: catalogRows }));
  return { sessionsDir, catalogDir };
}

const catalogRow = { model_id: 'muse-spark-1.3-contributor', context_limit: 1007997 };

describe('readMuseSessionUsage', () => {
  it('returns mapped turn usage with model and context window', async () => {
    const { sessionsDir, catalogDir } = await fixtureSessions(
      [[tokenUsageLine(), JSON.stringify({ method: 'turn/completed', params: {} })]],
      [catalogRow],
    );
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir })).resolves.toEqual({
      inputTokens: 23602,
      outputTokens: 15,
      thinkingTokens: 4,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 20,
      model: 'muse-spark-1.3-contributor',
      contextWindow: 1007997,
    });
  });

  it('takes the last tokenUsage entry across rotated journal files', async () => {
    const { sessionsDir, catalogDir } = await fixtureSessions([
      [tokenUsageLine()],
      [tokenUsageLine({ params: { usage: { inputTokens: 5, outputTokens: 6 }, modelId: 'other-model', turnId: 'turn-2' } })],
    ]);
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir })).resolves.toMatchObject({
      inputTokens: 5,
      outputTokens: 6,
      model: 'other-model',
      contextWindow: undefined,
    });
  });

  it('returns null when the session journal is missing or has no usage', async () => {
    const { sessionsDir, catalogDir } = await fixtureSessions([[JSON.stringify({ method: 'turn/completed', params: {} })]]);
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir })).resolves.toBeNull();
    await expect(readMuseSessionUsage('missing-session', { sessionsDir, catalogDir })).resolves.toBeNull();
  });

  it('rejects session ids that could escape the journal directory', async () => {
    const { sessionsDir, catalogDir } = await fixtureSessions([[tokenUsageLine()]]);
    await expect(readMuseSessionUsage('../escape', { sessionsDir, catalogDir })).resolves.toBeNull();
    await expect(readMuseSessionUsage('', { sessionsDir, catalogDir })).resolves.toBeNull();
  });

  // Finding #6: bare dot segments resolve inside the sessions dir itself —
  // `..` escapes it via join. Both must return null even when a journal
  // file sits at that level (planted here so the test can tell).
  it('rejects bare dot segments as session ids', async () => {
    const { sessionsDir, catalogDir } = await fixtureSessions([[tokenUsageLine()]]);
    await writeFile(join(sessionsDir, 'journal-00000000.bin'), tokenUsageLine());
    await expect(readMuseSessionUsage('..', { sessionsDir, catalogDir })).resolves.toBeNull();
    await expect(readMuseSessionUsage('.', { sessionsDir, catalogDir })).resolves.toBeNull();
  });

  // Finding #4: a previous turn's usage must never be misattributed to
  // the current turn. The journal state is fingerprinted at turn start
  // (file sizes here) and entries predating it resolve to null.
  it('ignores pre-turn entries covered by the baseline snapshot', async () => {
    const { sessionsDir, catalogDir } = await fixtureSessions([[tokenUsageLine()]]);
    const baseline = await snapshotMuseJournalState(SESSION_ID, { sessionsDir });
    expect(baseline).toEqual({ 'journal-00000000.bin': expect.any(Number) });
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir, baseline })).resolves.toBeNull();
  });

  it('reads entries appended after the baseline snapshot', async () => {
    const { sessionsDir, catalogDir } = await fixtureSessions([[tokenUsageLine()]]);
    const baseline = await snapshotMuseJournalState(SESSION_ID, { sessionsDir });
    await appendFile(
      join(sessionsDir, SESSION_ID, 'journal-00000000.bin'),
      `\n${tokenUsageLine({ params: { usage: { inputTokens: 7, outputTokens: 8 }, modelId: 'fresh-model', turnId: 'turn-2' } })}`,
    );
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir, baseline })).resolves.toMatchObject({
      inputTokens: 7,
      outputTokens: 8,
      model: 'fresh-model',
    });
  });

  it('treats a rotated (shrunk) journal file as fully fresh', async () => {
    const { sessionsDir, catalogDir } = await fixtureSessions([[tokenUsageLine()]]);
    const baseline = await snapshotMuseJournalState(SESSION_ID, { sessionsDir });
    await writeFile(
      join(sessionsDir, SESSION_ID, 'journal-00000000.bin'),
      tokenUsageLine({ params: { usage: { inputTokens: 9, outputTokens: 10 }, modelId: 'rotated-model', turnId: 'turn-3' } }),
    );
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir, baseline })).resolves.toMatchObject({
      inputTokens: 9,
      model: 'rotated-model',
    });
  });

  it('coerces malformed counts to zero and skips non-JSON lines', async () => {
    const { sessionsDir, catalogDir } = await fixtureSessions([[
      'not json at all',
      tokenUsageLine({ params: { usage: { inputTokens: -3, outputTokens: 'many', reasoningTokens: null }, modelId: null } }),
    ]]);
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir })).resolves.toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      model: null,
    });
  });

  // Finding #4: the journal flush lands after the turn ends — a fresh entry
  // that arrives after the first read must resolve to that entry, not null.
  it('waits for a fresh entry that flushes after the first read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-usage-'));
    const sessionsDir = join(root, 'sessions');
    await mkdir(join(sessionsDir, SESSION_ID), { recursive: true });
    const catalogDir = join(root, 'catalog');
    await mkdir(catalogDir, { recursive: true });
    await writeFile(join(catalogDir, 'catalog.json'), JSON.stringify({ rows: [] }));
    const baseline = await snapshotMuseJournalState(SESSION_ID, { sessionsDir });
    const pending = readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir, baseline });
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    await writeFile(
      join(sessionsDir, SESSION_ID, 'journal-00000000.bin'),
      tokenUsageLine({ params: { usage: { inputTokens: 7, outputTokens: 8 }, modelId: 'fresh-model', turnId: 'turn-2' } }),
    );
    await expect(pending).resolves.toMatchObject({
      inputTokens: 7,
      outputTokens: 8,
      model: 'fresh-model',
    });
  });

  // Finding #4: the wait stays bounded — a journal that never flushes a
  // fresh entry still resolves null instead of hanging.
  it('resolves null within the bounded budget when the journal stays empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'muse-usage-'));
    const sessionsDir = join(root, 'sessions');
    await mkdir(join(sessionsDir, SESSION_ID), { recursive: true });
    const catalogDir = join(root, 'catalog');
    await mkdir(catalogDir, { recursive: true });
    await writeFile(join(catalogDir, 'catalog.json'), JSON.stringify({ rows: [] }));
    const baseline = await snapshotMuseJournalState(SESSION_ID, { sessionsDir });
    const started = Date.now();
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir, baseline })).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('binary-framed journals', () => {
  // Real CLI journals are binary transport framing around compact JSON
  // records with no newline separation — never the JSONL the reader was
  // first written against. These fixtures reproduce that shape with
  // synthetic framing bytes so the regression cannot reoccur unnoticed.
  const FRAME_HEAD = Buffer.from([0x98, 0x00, 0x00, 0x00, 0x01, 0xde, 0xad, 0xbe, 0xef, 0x0a]);
  const FRAME_TAIL = Buffer.from([0x00, 0xff, 0xfe, 0x0a, 0x1b]);

  function framed(jsonString) {
    return Buffer.concat([FRAME_HEAD, Buffer.from(jsonString, 'utf8'), FRAME_TAIL]);
  }

  async function fixtureFramed(chunks) {
    const root = await mkdtemp(join(tmpdir(), 'muse-framed-'));
    const sessionsDir = join(root, 'sessions');
    await mkdir(join(sessionsDir, SESSION_ID), { recursive: true });
    await writeFile(
      join(sessionsDir, SESSION_ID, 'journal-00000000.bin'),
      Buffer.concat(chunks.map((chunk) => (typeof chunk === 'string' ? framed(chunk) : chunk))),
    );
    const catalogDir = join(root, 'catalog');
    await mkdir(catalogDir, { recursive: true });
    await writeFile(join(catalogDir, 'catalog.json'), JSON.stringify({ rows: [] }));
    return { sessionsDir, catalogDir };
  }

  it('reads tokenUsage embedded in binary framing without newlines', async () => {
    const { sessionsDir, catalogDir } = await fixtureFramed([tokenUsageLine()]);
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir })).resolves.toMatchObject({
      inputTokens: 23602,
      outputTokens: 15,
      model: 'muse-spark-1.3-contributor',
    });
  });

  it('takes the last tokenUsage across framed records', async () => {
    const { sessionsDir, catalogDir } = await fixtureFramed([
      tokenUsageLine(),
      JSON.stringify({ method: 'turn/completed', params: {} }),
      tokenUsageLine({ params: { usage: { inputTokens: 7, outputTokens: 8 }, modelId: 'fresh-model', turnId: 'turn-2' } }),
    ]);
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir })).resolves.toMatchObject({
      inputTokens: 7,
      outputTokens: 8,
      model: 'fresh-model',
    });
  });

  it('reads records appended after the baseline despite framing', async () => {
    const { sessionsDir, catalogDir } = await fixtureFramed([tokenUsageLine()]);
    const baseline = await snapshotMuseJournalState(SESSION_ID, { sessionsDir });
    await appendFile(
      join(sessionsDir, SESSION_ID, 'journal-00000000.bin'),
      Buffer.concat([FRAME_HEAD, Buffer.from(tokenUsageLine({
        params: { usage: { inputTokens: 9, outputTokens: 10 }, modelId: 'appended-model', turnId: 'turn-3' },
      }), 'utf8'), FRAME_TAIL]),
    );
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir, baseline })).resolves.toMatchObject({
      inputTokens: 9,
      model: 'appended-model',
    });
  });

  it('ignores method markers quoted inside message text', async () => {
    const decoy = JSON.stringify({
      method: 'item/completed',
      params: { item: { kind: 'assistantMessage', text: 'saw {"method":"session/tokenUsage"} in the docs' } },
    });
    const { sessionsDir, catalogDir } = await fixtureFramed([decoy, tokenUsageLine()]);
    await expect(readMuseSessionUsage(SESSION_ID, { sessionsDir, catalogDir })).resolves.toMatchObject({
      inputTokens: 23602,
      model: 'muse-spark-1.3-contributor',
    });
  });
});

describe('buildTerminalUsage', () => {
  it('shapes a reading as SDK-style usage and modelUsage', () => {
    expect(buildTerminalUsage({
      inputTokens: 100, outputTokens: 20, thinkingTokens: 5,
      cacheReadInputTokens: 10, cacheCreationInputTokens: 30,
      model: 'muse-spark-1.3-contributor', contextWindow: 1007997,
    })).toEqual({
      usage: { input_tokens: 100, output_tokens: 20 },
      modelUsage: {
        'muse-spark-1.3-contributor': {
          inputTokens: 100, outputTokens: 20, thinkingTokens: 5,
          cacheReadInputTokens: 10, cacheCreationInputTokens: 30, contextWindow: 1007997,
        },
      },
    });
  });

  it('returns no usage fields when the journal had nothing', () => {
    expect(buildTerminalUsage(null)).toEqual({});
  });
});
