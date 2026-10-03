import { describe, it, expect } from 'vitest';
import { MuseAdapter } from './MuseAdapter.js';

/**
 * Real-SDK integration smoke test (review finding #4).
 *
 * Skipped unless `MUSE_INTEGRATION=1`:
 *
 *   MUSE_INTEGRATION=1 yarn workspace @circuschief/server test \
 *     src/agents/adapters/MuseAdapter.integration.test.js
 *
 * Requires the `@muse-code/sdk` package and a real `muse` CLI on the login
 * shell PATH (`muse auth` configured). One real turn is executed through
 * the SDK + CLI: spawn → `system(init)` → at least one item → terminal
 * `result` → host close. Asserts event *shapes*, never timings. CI may
 * skip this suite wherever the CLI is absent; it is the standing rehearsal
 * for the FRD §6 acceptance runs.
 */
const integrationEnabled = process.env.MUSE_INTEGRATION === '1';

describe.skipIf(!integrationEnabled)('MuseAdapter integration (real SDK + CLI)', () => {
  it('runs one real turn: spawn → system(init) → at least one item → terminal result → close', async () => {
    const adapter = new MuseAdapter();
    const events = [];
    for await (const event of adapter.execute({
      prompt: 'Reply with exactly: integration-ok. Do not use any tools.',
      options: {
        cwd: process.cwd(),
        env: { ...process.env },
        approvalMode: 'allowAll',
      },
    })) {
      events.push(event);
    }

    // Shape: the first event is the MSP system init carrying a session id.
    expect(events[0]).toMatchObject({ type: 'system', subtype: 'init' });
    expect(typeof events[0].session_id).toBe('string');
    expect(events[0].session_id.length).toBeGreaterThan(0);

    // Shape: at least one turn item was folded into the stream.
    const itemEvents = events.slice(1, -1);
    expect(itemEvents.length).toBeGreaterThan(0);

    // Shape: a terminal result closes the turn.
    const result = events.at(-1);
    expect(result).toMatchObject({ type: 'result' });
    expect(['success', 'error']).toContain(result.subtype);
    if (result.subtype === 'success') {
      expect(result.usage).toBeDefined();
    }
  }, 180_000);
});
