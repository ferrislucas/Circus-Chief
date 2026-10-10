import { describe, it, expect } from 'vitest';
import { formatFailoverModelLabel } from './failoverLabels.js';

const resolveName = (id) => ({ 'uuid-1': 'OpenAI' }[id] ?? id);

describe('formatFailoverModelLabel', () => {
  it('resolves provider ids through the name resolver', () => {
    expect(formatFailoverModelLabel(
      { providerId: 'uuid-1', modelId: 'gpt-5.5' },
      resolveName,
    )).toBe('OpenAI/gpt-5.5');
  });

  it('falls back to the raw id when the provider is unknown', () => {
    expect(formatFailoverModelLabel(
      { providerId: 'uuid-gone', modelId: 'gpt-5.5' },
      resolveName,
    )).toBe('uuid-gone/gpt-5.5');
  });

  it('renders tier refs as tier names instead of raw sentinels', () => {
    expect(formatFailoverModelLabel(
      { providerId: null, modelId: 'tier::abc123', tierName: 'High' },
      resolveName,
    )).toBe('Tier: High');
  });

  it('falls back to a generic tier name when the entry has none', () => {
    expect(formatFailoverModelLabel({ modelId: 'tier::abc123' }, resolveName))
      .toBe('Tier: Model tier');
  });

  it('keeps the legacy single-value fallbacks', () => {
    expect(formatFailoverModelLabel({ modelId: 'gpt-5.5' }, resolveName)).toBe('gpt-5.5');
    expect(formatFailoverModelLabel({ providerId: 'uuid-1' }, resolveName)).toBe('OpenAI');
    expect(formatFailoverModelLabel({}, resolveName)).toBe('Unknown model');
  });
});
