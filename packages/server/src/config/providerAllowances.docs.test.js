import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as providerAllowances from './providerAllowances.js';

const EXPECTED_FLAGS = [
  'PROVIDER_ALLOWANCES_ENABLED',
  'PROVIDER_ALLOWANCES_CLAUDE',
  'PROVIDER_ALLOWANCES_CODEX',
  'PROVIDER_ALLOWANCES_CODEX_APPSERVER',
  'PROVIDER_ALLOWANCES_ZAI',
  'PROVIDER_ALLOWANCES_OPENAI',
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

  it('advertises every acquisition source with its own sub-flag, and all three agree', () => {
    const documentation = readFileSync(new URL('../../../../docs/provider-allowances.md', import.meta.url), 'utf8');
    const sources = providerAllowances.getProviderAllowanceSources();

    // One advertised source per sub-flag, keyed identically in code.
    expect(Object.keys(sources).sort()).toEqual(
      Object.keys(providerAllowances.PROVIDER_ALLOWANCE_SOURCE_FLAGS).sort(),
    );
    for (const [source, flag] of Object.entries(providerAllowances.PROVIDER_ALLOWANCE_SOURCE_FLAGS)) {
      // The flag is a real member of the inventory, is documented, and backs
      // the advertised source key — a new source cannot appear in only one
      // of the three places.
      expect(providerAllowances.PROVIDER_ALLOWANCE_FLAGS).toContain(flag);
      expect(documentation).toContain(flag);
      expect(sources).toHaveProperty(source, expect.any(Boolean));
    }
  });
});
