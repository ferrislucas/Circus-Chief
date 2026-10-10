import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ACQUISITION_SOURCES = [
  'Claude in-stream',
  'Codex rollout tail',
  'Codex app-server',
  'z.ai poll',
  'Muse usage probe',
  'OpenAI headers',
];

describe('provider allowances documentation', () => {
  it('documents each allowance acquisition source and the always-on posture', () => {
    const documentation = readFileSync(new URL('../../../../docs/provider-allowances.md', import.meta.url), 'utf8');

    for (const source of ACQUISITION_SOURCES) {
      expect(documentation).toContain(source);
    }
    expect(documentation).not.toContain('PROVIDER_ALLOWANCES_ENABLED');
    expect(documentation).toContain('PROVIDER_ALLOWANCE_STREAM_STALE_MS');
  });
});
