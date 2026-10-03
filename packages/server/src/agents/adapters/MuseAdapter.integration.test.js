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
 * shell PATH (`muse auth` configured). Two real turns are executed through
 * the SDK + CLI: a fresh session followed by a resumed session. Each run is
 * spawn → `system(init)` → at least one item → terminal `result` → host
 * close. Asserts event *shapes*, never timings. CI may
 * skip this suite wherever the CLI is absent; it is the standing rehearsal
 * for the FRD §6 acceptance runs.
 */
const integrationEnabled = process.env.MUSE_INTEGRATION === '1';

describe.skipIf(!integrationEnabled)('MuseAdapter integration (real SDK + CLI)', () => {
  async function runTurn(options) {
    const adapter = new MuseAdapter();
    const events = [];
    for await (const event of adapter.execute({
      prompt: options.prompt,
      options: {
        cwd: process.cwd(),
        env: { ...process.env },
        approvalMode: 'allowAll',
        ...(options.resume ? { resume: options.resume } : {}),
      },
    })) {
      events.push(event);
    }

    return events;
  }

  function expectCompletedTurn(events) {

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
  }

  it('runs fresh and resumed turns through the local 1.4.2 CLI', async () => {
    const firstEvents = await runTurn({
      prompt: 'Reply with exactly: integration-ok. Do not use any tools.',
    });
    expectCompletedTurn(firstEvents);

    const sessionId = firstEvents[0].session_id;
    const resumedEvents = await runTurn({
      prompt: 'Reply with exactly: integration-resumed. Do not use any tools.',
      resume: sessionId,
    });
    expectCompletedTurn(resumedEvents);
    expect(resumedEvents[0].session_id).toBe(sessionId);
  }, 300_000);
});
