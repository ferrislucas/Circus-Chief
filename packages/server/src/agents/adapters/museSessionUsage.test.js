import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTerminalUsage, readMuseSessionUsage } from './museSessionUsage.js';

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
