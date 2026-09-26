import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as providerAllowances from './providerAllowances.js';

const EXPECTED_FLAGS = [
  'PROVIDER_ALLOWANCES_ENABLED',
  'PROVIDER_ALLOWANCES_CLAUDE',
  'PROVIDER_ALLOWANCES_CODEX',
  'PROVIDER_ALLOWANCES_CODEX_APPSERVER',
  'PROVIDER_ALLOWANCES_ZAI',
  'PROVIDER_ALLOWANCE_STREAM_STALE_MS',
];

describe('provider allowances documentation', () => {
  it('documents every configured flag and each allowance acquisition source', () => {
    const documentation = readFileSync(new URL('../../../../docs/provider-allowances.md', import.meta.url), 'utf8');

    expect(providerAllowances.PROVIDER_ALLOWANCE_FLAGS).toEqual(EXPECTED_FLAGS);
    for (const flag of providerAllowances.PROVIDER_ALLOWANCE_FLAGS) {
      expect(documentation).toContain(flag);
    }

    expect(documentation).toContain('Claude in-stream');
    expect(documentation).toContain('Codex rollout tail');
    expect(documentation).toContain('Codex app-server');
    expect(documentation).toContain('z.ai poll');
    expect(documentation).toContain('OpenAI headers');
  });
});
