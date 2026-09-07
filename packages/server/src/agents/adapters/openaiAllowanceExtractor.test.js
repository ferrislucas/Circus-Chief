import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractOpenAIAllowance } from './openaiAllowanceExtractor.js';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'tests', 'fixtures', 'openai', 'allowance-headers.json',
);
const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const observedAt = 1_700_000_000_000;

describe('extractOpenAIAllowance', () => {
  it('parses the documented OpenAI rate-limit headers without retaining raw metadata', () => {
    expect(extractOpenAIAllowance(fixtures.complete, { observedAt })).toEqual({
      providerKind: 'openai',
      source: 'observed-header',
      updatedAt: observedAt,
      staleAfterMs: 12_000,
      allowances: [
        { key: 'requests', label: 'Requests', remaining: 75, limit: 100, unit: 'requests', resetsAt: observedAt + 12_000 },
        { key: 'tokens', label: 'Tokens', remaining: 75_000, limit: 100_000, unit: 'tokens', resetsAt: observedAt + 120_000 },
      ],
    });
  });

  it.each(['percentageOnly', 'missingFields', 'malformed'])('rejects %s headers instead of inventing an allowance', (fixtureName) => {
    expect(extractOpenAIAllowance(fixtures[fixtureName], { observedAt })).toBeNull();
  });

  it('accepts a Headers object but never surfaces credentials or other raw header values', () => {
    const candidate = extractOpenAIAllowance(new Headers(fixtures.complete), { observedAt });

    expect(JSON.stringify(candidate)).not.toContain('redacted');
    expect(JSON.stringify(candidate)).not.toContain('req_sanitized');
  });
});
